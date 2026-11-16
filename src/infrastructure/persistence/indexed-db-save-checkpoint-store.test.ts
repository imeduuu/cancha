import { afterEach, describe, expect, it, vi } from "vitest";
import { IndexedDbSaveCheckpointStore } from "./indexed-db-save-checkpoint-store";
import type { SaveCheckpoint } from "../../domain/entities/save-checkpoint";

/** Controlled IDB events verify transaction semantics; actual persistence is covered in Playwright. */
function driver() {
  const read = {result: undefined as unknown, onsuccess: null as (() => void) | null};
  const open = {result: undefined as unknown, error: null as DOMException | null, onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null, onblocked: null as (() => void) | null, onupgradeneeded: null as ((event: {oldVersion: number}) => void) | null};
  const tx = {error: null as DOMException | null, oncomplete: null as (() => void) | null,
    onabort: null as (() => void) | null, onerror: null as (() => void) | null,
    abort: vi.fn(() => queueMicrotask(() => tx.onabort?.())), objectStore: vi.fn(() => store)};
  const store = {keyPath: "id", autoIncrement: false, getAll: vi.fn(() => read), get: vi.fn(() => read), add: vi.fn(), put: vi.fn(), delete: vi.fn(), transaction: tx};
  const db = {objectStoreNames: {contains: vi.fn(() => true)}, close: vi.fn(), transaction: vi.fn(() => tx),
    createObjectStore: vi.fn(), onversionchange: null as (() => void) | null};
  open.result = db;
  const factory = {open: vi.fn(() => {queueMicrotask(() => open.onsuccess?.());return open;})};
  const repo = new IndexedDbSaveCheckpointStore(() => factory as unknown as IDBFactory);
  return {read, open, tx, store, db, factory, repo};
}
const record = {id: "point", name: "Nombre"} as SaveCheckpoint;
afterEach(() => vi.unstubAllGlobals());

describe("IndexedDB de puntos de control", () => {
  it("informa indisponibilidad y restricciones sin sustituirlo por LocalStorage", async () => {
    await expect(new IndexedDbSaveCheckpointStore(() => undefined).list()).rejects.toThrow(/IndexedDB no está disponible/);
    const d = driver();d.factory.open.mockImplementation(() => {throw new DOMException("denied", "SecurityError");});
    await expect(d.repo.list()).rejects.toThrow(/bloqueó/);
  });
  it("solo crea el almacén al inicializar la base y cierra al cambiar su versión", async () => {
    const d = driver();const pending = d.repo.list();await vi.waitFor(() => expect(d.db.transaction).toHaveBeenCalled());
    d.open.onupgradeneeded?.({oldVersion: 0});expect(d.db.createObjectStore).toHaveBeenCalledWith("checkpoints", {keyPath: "id"});
    d.read.result = [];d.read.onsuccess?.();d.tx.oncomplete?.();await pending;
    d.db.onversionchange?.();expect(d.db.close).toHaveBeenCalled();
  });
  it("no resuelve una escritura hasta que la transacción completa, aunque la solicitud ya haya sido aceptada", async () => {
    const d = driver();let resolved = false;const pending = d.repo.add(record).then(() => {resolved = true;});
    await vi.waitFor(() => expect(d.store.add).toHaveBeenCalledWith(record));
    await Promise.resolve();expect(resolved).toBe(false);d.tx.oncomplete?.();await pending;expect(resolved).toBe(true);expect(d.db.close).toHaveBeenCalledOnce();
  });
  it.each(["QuotaExceededError", "AbortError", "ConstraintError"])("rechaza la transacción %s sin confirmar éxito", async name => {
    const d = driver();const pending = d.repo.add(record);
    await vi.waitFor(() => expect(d.store.add).toHaveBeenCalled());
    d.tx.error = new DOMException("fault", name);d.tx.onerror?.();d.tx.onabort?.();
    await expect(pending).rejects.toThrow(name === "QuotaExceededError" ? /lleno/ : name === "AbortError" ? /abortada/ : /identificador/);
    expect(d.db.close).toHaveBeenCalled();
  });
  it("maneja aborto explícito después de aceptar una escritura", async () => {
    const d = driver();const pending = d.repo.add(record);await vi.waitFor(() => expect(d.store.add).toHaveBeenCalled());
    d.tx.onabort?.();await expect(pending).rejects.toThrow(/abortada/);
  });
  it("espera también el resultado final de las lecturas", async () => {
    const d = driver();const pending = d.repo.get("point");await vi.waitFor(() => expect(d.store.get).toHaveBeenCalledWith("point"));
    d.read.result = record;d.read.onsuccess?.();d.tx.oncomplete?.();expect(await pending).toBe(record);
  });
  it("conserva errores de lectura y rechaza bases de versión incompatible", async () => {
    const d = driver();d.factory.open.mockImplementation(() => {queueMicrotask(() => {d.open.error = new DOMException("new version", "VersionError");d.open.onerror?.();});return d.open;});
    await expect(d.repo.list()).rejects.toThrow(/incompatible/);
    const missing = driver();missing.db.objectStoreNames.contains.mockReturnValue(false);await expect(missing.repo.list()).rejects.toThrow(/incompleto/);
    const schema = driver();schema.store.keyPath = "other";await expect(schema.repo.list()).rejects.toThrow(/esquema.*incompatible/);expect(schema.store.getAll).not.toHaveBeenCalled();
    const readError = driver();const pending = readError.repo.list();await vi.waitFor(() => expect(readError.store.getAll).toHaveBeenCalled());
    readError.tx.error = new DOMException("closed", "InvalidStateError");readError.tx.onabort?.();await expect(pending).rejects.toThrow(/no está disponible/);
  });
  it("informa bloqueo por otra pestaña y cierra una apertura tardía", async () => {
    const d = driver();d.factory.open.mockImplementation(() => {queueMicrotask(() => d.open.onblocked?.());return d.open;});
    await expect(d.repo.list()).rejects.toThrow(/otra pestaña/);d.open.onsuccess?.();expect(d.db.close).toHaveBeenCalled();expect(d.db.transaction).not.toHaveBeenCalled();
  });
  it.each(["edit", "delete"])("compara el registro dentro de la transacción antes de %s", async kind => {
    const d = driver();const pending = kind === "edit" ? d.repo.replace("point", record, {...record, name: "Nuevo"}) : d.repo.delete("point", record);
    await vi.waitFor(() => expect(d.store.get).toHaveBeenCalled());d.read.result = {...record, name: "Cambio concurrente"};d.read.onsuccess?.();
    await expect(pending).rejects.toThrow(/cambió/);expect(d.store.put).not.toHaveBeenCalled();expect(d.store.delete).not.toHaveBeenCalled();
  });
  it("edita y elimina por comparación exacta, sin recrear registros desaparecidos", async () => {
    const identity = driver();await expect(identity.repo.replace("point", record, {...record, id: "other"})).rejects.toThrow(/identidad/);
    expect(identity.factory.open).not.toHaveBeenCalled();
    const d = driver();const next = {...record, name: "Nuevo"};const edit = d.repo.replace("point", record, next);
    await vi.waitFor(() => expect(d.store.get).toHaveBeenCalled());d.read.result = record;d.read.onsuccess?.();expect(d.store.put).toHaveBeenCalledWith(next);d.tx.oncomplete?.();await edit;
    const missing = driver();const removal = missing.repo.delete("point", record);await vi.waitFor(() => expect(missing.store.get).toHaveBeenCalled());
    missing.read.result = undefined;missing.read.onsuccess?.();await expect(removal).rejects.toThrow(/eliminado/);
  });
  it("coordina restauraciones entre pestañas y bloquea la operación si no existe Web Locks", async () => {
    const repo = new IndexedDbSaveCheckpointStore();const action = vi.fn(async () => "done");
    vi.stubGlobal("navigator", {});await expect(repo.exclusive(action, true)).rejects.toThrow(/coordinar/);expect(action).not.toHaveBeenCalled();
    expect(await repo.exclusive(action)).toBe("done");
    const request = vi.fn(async (_name: string, _options: unknown, fn: () => Promise<string>) => fn());
    vi.stubGlobal("navigator", {locks: {request}});expect(await repo.exclusive(action, true)).toBe("done");
    expect(request).toHaveBeenCalledWith("cancha.save-checkpoints", {mode: "exclusive"}, expect.any(Function));
    expect(action).toHaveBeenLastCalledWith(expect.any(Object));
  });
});
