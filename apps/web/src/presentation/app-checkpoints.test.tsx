import { renderApplication } from "../test-utils/render-application";
import { installTestWebLocks } from "../test-utils/web-locks";
// @vitest-environment jsdom
import { randomUUID, webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { App } from "./app";
import { LocalStorageTournamentRepository } from "../infrastructure/persistence/local-storage-tournament-repository";
import { checkpointLibrary } from "@cancha/core/test-utils/save-checkpoint-fixtures";
import type { SaveCheckpoint } from "@cancha/core/domain/entities/save-checkpoint";

const storage = vi.hoisted(() => ({records: new Map<string, unknown>(), failure: "", readGate: null as Promise<void> | null, reads: 0}));
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
vi.mock("../infrastructure/persistence/indexed-db-save-checkpoint-store", async () => {
  const {MemoryCheckpointStore} = await import("@cancha/core/test-utils/save-checkpoint-fixtures");
  return {IndexedDbSaveCheckpointStore: class extends MemoryCheckpointStore {
    override readonly records = storage.records;
    override async exclusive<T>(action: (lease?: import("@cancha/core/application/ports/library-write-lease").LibraryWriteLease) => Promise<T>): Promise<T> {
      const {withLibraryWriteLock} = await import("../infrastructure/persistence/library-write-lock");
      return withLibraryWriteLock(action);
    }
    override async add(record: SaveCheckpoint) { if (storage.failure) throw new Error(storage.failure);await super.add(record); }
    override async list() { storage.reads += 1;if (storage.readGate) await storage.readGate;return super.list(); }
  }};
});

beforeEach(() => {
  installTestWebLocks();
  localStorage.clear();storage.records.clear();storage.failure = "";storage.readGate = null;storage.reads = 0;
  vi.stubGlobal("crypto", {subtle: webcrypto.subtle, randomUUID});vi.stubGlobal("TextEncoder", TextEncoder);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {configurable: true, value: function (this: HTMLDialogElement) {this.setAttribute("open", "");}});
  Object.defineProperty(HTMLDialogElement.prototype, "close", {configurable: true, value: function (this: HTMLDialogElement) {this.removeAttribute("open");}});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.stubGlobal("URL", class extends URL {static createObjectURL = vi.fn(() => "blob:checkpoint");static revokeObjectURL = vi.fn();});
});
afterEach(() => {
  cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

function rawLibrary() { return JSON.stringify(Array.from({length: localStorage.length}, (_,i) => localStorage.key(i)!).sort().map(key => [key, localStorage.getItem(key)])); }
async function start(pending = false) {
  const library = checkpointLibrary();
  if (pending) library.tournaments = library.tournaments.map((t,i) => i ? t : {...t,
    competitionRules: {season: 2026, verification: {standings: "verified", placements: "verified"}},
    matchdays: t.matchdays.map(d => ({...d, fixtures: d.fixtures.map(f => ({...f, result: undefined}))})),
  });
  const repo = new LocalStorageTournamentRepository(false);repo.importTournaments(library.tournaments, "replace", library.activity, false, library.universes);
  await renderApplication(<App/>);await screen.findByRole("heading", {name: "Liga one"});return repo;
}
async function openCenter() {
  fireEvent.click(screen.getByRole("button", {name: "Biblioteca"}));
  fireEvent.click(await screen.findByRole("button", {name: "Centro de guardado y recuperación"}));
  return screen.findByRole("region", {name: "Puntos de control manuales"});
}
async function createPoint(panel: HTMLElement, name = "Antes de avanzar") {
  fireEvent.change(within(panel).getByLabelText("Nombre del punto"), {target: {value: name}});
  await waitFor(() => expect(within(panel).getByRole("button", {name: "Revisar punto de control"})).toBeEnabled());
  fireEvent.click(within(panel).getByRole("button", {name: "Revisar punto de control"}));
  await within(panel).findByRole("region", {name: "Vista previa del punto de control"});
  expect(storage.records.size).toBe(0);
  fireEvent.click(within(panel).getByRole("button", {name: "Confirmar creación del punto"}));
  await within(panel).findByText(/guardado y verificado/);
  return within(panel).getByRole("article", {name: `Punto: ${name}`});
}

it("Biblioteca → crear, descargar, editar y eliminar conserva toda la partida y sus universos", async () => {
  await start();const before = rawLibrary();const panel = await openCenter();const row = await createPoint(panel);
  expect(within(row).getByText(/3 torneos · 2 universos/)).toBeInTheDocument();expect(rawLibrary()).toBe(before);
  const record = [...storage.records.values()][0] as SaveCheckpoint;
  expect(JSON.parse(record.content).extensions.sportsUniverses.assignments).toEqual({one: "u-one", two: "u-two"});
  fireEvent.click(within(row).getByRole("button", {name: "Descargar JSON del punto"}));
  await within(panel).findByText(/Se descargó el respaldo JSON v7/);expect(URL.createObjectURL).toHaveBeenCalledOnce();
  fireEvent.click(within(row).getByRole("button", {name: "Editar nombre y descripción"}));
  fireEvent.change(within(panel).getByLabelText("Nuevo nombre"), {target: {value: "Después de las ligas"}});
  fireEvent.click(within(panel).getByRole("button", {name: "Guardar metadatos"}));
  const edited = await within(panel).findByRole("article", {name: "Punto: Después de las ligas"});
  expect((storage.records.get(record.id) as SaveCheckpoint).content).toBe(record.content);
  fireEvent.click(within(edited).getByRole("button", {name: "Eliminar punto"}));
  let dialog = screen.getByRole("dialog", {name: "Eliminar punto de control"});fireEvent.click(within(dialog).getByRole("button", {name: "Cancelar"}));
  expect(storage.records.size).toBe(1);expect(rawLibrary()).toBe(before);
  fireEvent.click(within(edited).getByRole("button", {name: "Eliminar punto"}));dialog = screen.getByRole("dialog", {name: "Eliminar punto de control"});
  fireEvent.click(within(dialog).getByRole("button", {name: "Confirmar eliminación"}));await within(panel).findByText(/Punto eliminado/);
  expect(storage.records.size).toBe(0);expect(rawLibrary()).toBe(before);
});

it("Simulación → crear punto → volver conserva alcance y revisión sin simular ni escribir actividad", async () => {
  const repo = await start(true);const before = rawLibrary();
  fireEvent.click(screen.getByRole("button", {name: "Centro de simulación"}));
  let simulation = screen.getByRole("region", {name: "Centro de simulación de temporadas"});
  fireEvent.change(within(simulation).getByRole("combobox", {name: "Alcance"}), {target: {value: "0"}});
  fireEvent.click(within(simulation).getByRole("button", {name: "Revisar simulación"}));
  expect(within(simulation).getByRole("button", {name: "Confirmar simulación local"})).toBeEnabled();
  fireEvent.click(within(simulation).getByRole("button", {name: "Crear punto de control antes de simular"}));
  const panel = await screen.findByRole("region", {name: "Puntos de control manuales"});
  expect(within(panel).getByLabelText("Nombre del punto")).toHaveValue("Antes de simular — Liga one 2026");
  await createPoint(panel);expect(rawLibrary()).toBe(before);
  fireEvent.click(within(panel).getByRole("button", {name: "Volver al contexto de origen"}));
  simulation = screen.getByRole("region", {name: "Centro de simulación de temporadas"});
  expect(within(simulation).getByRole("combobox", {name: "Alcance"})).toHaveValue("0");
  fireEvent.click(within(simulation).getByRole("button", {name: "Confirmar simulación local"}));
  await within(simulation).findByText(/Se simularon localmente 1 partidos/);
  expect(repo.findAll().find(t => t.id === "one")!.matchdays[0].fixtures[0].result).toBeDefined();
  expect(JSON.parse(([...storage.records.values()][0] as SaveCheckpoint).content).tournaments.find((t: {id: string}) => t.id === "one").matchdays[0].fixtures[0].result).toBeUndefined();
});

it("restaurar compara, cancela sin cambios y después reemplaza por el flujo existente actualizando navegación", async () => {
  const repo = await start();fireEvent.change(screen.getByRole("combobox", {name: "Partidos con resultado"}), {target: {value: "overwrite"}});
  const panel = await openCenter();const row = await createPoint(panel);
  const original = repo.findAll();repo.save({...original[0], name: "Progreso posterior"});repo.save({...original[0], id: "future", name: "Temporada futura", season: 2028});
  const current = rawLibrary();
  fireEvent.click(within(row).getByRole("button", {name: "Revisar restauración"}));
  let dialog = await screen.findByRole("dialog", {name: "Restaurar punto de control"});expect(within(dialog).getByText(/Exclusivos actuales.*future/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", {name: "Cancelar"}));expect(rawLibrary()).toBe(current);
  fireEvent.click(within(row).getByRole("button", {name: "Revisar restauración"}));dialog = await screen.findByRole("dialog", {name: "Restaurar punto de control"});
  fireEvent.click(within(dialog).getByRole("button", {name: "Confirmar reemplazo por el punto"}));
  await screen.findByRole("heading", {name: "Liga one"});
  await waitFor(() => expect(repo.findAll()).toEqual(original));expect(repo.getSportsUniverseLibrary().activeUniverseId).toBe("u-one");
  expect(repo.findActivity().at(-1)?.action).toBe("library-restored");expect(repo.getActiveTournamentId()).toBe("one");
  expect(screen.getByRole("combobox", {name: "Partidos con resultado"})).toHaveValue("pendingOnly");
  expect(screen.queryByRole("region", {name: "Centro de simulación de temporadas"})).not.toBeInTheDocument();
});

it("rechaza una revisión de creación si la biblioteca cambió y nunca informa éxito falso", async () => {
  const repo = await start();const panel = await openCenter();
  fireEvent.change(within(panel).getByLabelText("Nombre del punto"), {target: {value: "Obsoleto"}});
  await waitFor(() => expect(within(panel).getByRole("button", {name: "Revisar punto de control"})).toBeEnabled());
  fireEvent.click(within(panel).getByRole("button", {name: "Revisar punto de control"}));await within(panel).findByRole("region", {name: "Vista previa del punto de control"});
  repo.save({...repo.findAll()[0], name: "Cambio externo"});
  fireEvent.click(within(panel).getByRole("button", {name: "Confirmar creación del punto"}));
  expect(await within(panel).findByRole("alert")).toHaveTextContent(/obsoleta/);expect(storage.records.size).toBe(0);
});

it("rechaza restauración cuando el punto fue editado en otra pestaña", async () => {
  await start();const panel = await openCenter();const row = await createPoint(panel);const before = rawLibrary();
  fireEvent.click(within(row).getByRole("button", {name: "Revisar restauración"}));
  const dialog = await screen.findByRole("dialog", {name: "Restaurar punto de control"});
  const record = [...storage.records.values()][0] as SaveCheckpoint;storage.records.set(record.id, {...record, name: "Editado", revision: 2});
  fireEvent.click(within(dialog).getByRole("button", {name: "Confirmar reemplazo por el punto"}));
  expect(await within(panel).findByRole("alert")).toHaveTextContent(/punto cambió/);expect(rawLibrary()).toBe(before);
});

it("expone el fallo de guardado sin marcar el punto como disponible", async () => {
  await start();const panel = await openCenter();const before = rawLibrary();
  fireEvent.change(within(panel).getByLabelText("Nombre del punto"), {target: {value: "Sin espacio"}});
  await waitFor(() => expect(within(panel).getByRole("button", {name: "Revisar punto de control"})).toBeEnabled());
  fireEvent.click(within(panel).getByRole("button", {name: "Revisar punto de control"}));await within(panel).findByRole("region", {name: "Vista previa del punto de control"});
  storage.failure = "El almacenamiento está lleno";fireEvent.click(within(panel).getByRole("button", {name: "Confirmar creación del punto"}));
  expect(await within(panel).findByRole("alert")).toHaveTextContent(/lleno/);expect(storage.records.size).toBe(0);expect(rawLibrary()).toBe(before);
});

it("el dashboard abre el Centro y cambiar de universo mantiene visibles los puntos de la biblioteca completa", async () => {
  const repo = await start();fireEvent.click(screen.getByRole("button", {name: "Biblioteca"}));
  fireEvent.click(screen.getByText("Más herramientas de biblioteca"));
  fireEvent.click(screen.getByRole("button", {name: "Panel principal del universo"}));
  const dashboard = await screen.findByRole("region", {name: "Panel del universo deportivo"});
  fireEvent.click(within(dashboard).getByRole("button", {name: "Centro de guardado y recuperación"}));
  let panel = await screen.findByRole("region", {name: "Puntos de control manuales"});await createPoint(panel);
  fireEvent.change(screen.getByRole("combobox", {name: "Universo activo"}), {target: {value: "u-two"}});
  await waitFor(() => expect(repo.getSportsUniverseLibrary().activeUniverseId).toBe("u-two"));
  fireEvent.click(screen.getByRole("button", {name: "Centro de guardado y recuperación"}));
  panel = await screen.findByRole("region", {name: "Puntos de control manuales"});
  const row = await within(panel).findByRole("article", {name: "Punto: Antes de avanzar"});expect(within(row).getByText(/3 torneos · 2 universos/)).toBeInTheDocument();
});

it("mantiene visible el diagnóstico inválido después de actualizar un registro corrupto", async () => {
  await start();const panel = await openCenter();const row = await createPoint(panel);const before = rawLibrary();
  const record = [...storage.records.values()][0] as SaveCheckpoint;storage.records.set(record.id, {...record, content: record.content + " "});
  fireEvent.click(within(row).getByRole("button", {name: "Verificar integridad"}));
  expect(await within(panel).findByRole("alert")).toHaveTextContent(/SHA-256/);
  await waitFor(() => expect(within(row).getByText("Inválido")).toBeInTheDocument());
  await waitFor(() => expect(within(panel).getByRole("button", {name: "Actualizar puntos"})).toBeEnabled());
  fireEvent.click(within(panel).getByRole("button", {name: "Actualizar puntos"}));
  await waitFor(() => expect(within(panel).getByRole("button", {name: "Actualizar puntos"})).toBeEnabled());
  expect(within(row).getByText("Inválido")).toBeInTheDocument();expect(rawLibrary()).toBe(before);
});

it("si se restringen las notificaciones entre pestañas, informa la limitación y verifica el guardado igualmente", async () => {
  await start();const before = rawLibrary();
  vi.stubGlobal("BroadcastChannel", class {constructor() {throw new DOMException("Disabled", "SecurityError");}});
  const panel = await openCenter();expect(await within(panel).findByText(/No se pudo activar la actualización entre pestañas/)).toBeInTheDocument();
  const row = await createPoint(panel);expect(within(row).getByText("Disponible")).toBeInTheDocument();expect(rawLibrary()).toBe(before);
});

it("una lectura de fondo no inserta un aviso que desplace la confirmación de creación", async () => {
  await start();const panel = await openCenter();await createPoint(panel);
  await waitFor(() => expect(within(panel).getByRole("button", {name: "Revisar punto de control"})).toBeEnabled());
  fireEvent.click(within(panel).getByRole("button", {name: "Revisar punto de control"}));
  await within(panel).findByRole("region", {name: "Vista previa del punto de control"});
  let release!: () => void;storage.readGate = new Promise<void>(resolve => {release = resolve;});const reads = storage.reads;
  try {
    fireEvent(window, new Event("focus"));expect(storage.reads).toBe(reads + 1);
    expect(within(panel).queryByText("Leyendo puntos guardados…")).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", {name: "Confirmar creación del punto"})).toBeEnabled();
  } finally {storage.readGate = null;release();}
  await waitFor(() => expect(within(panel).getByRole("button", {name: "Revisar punto de control"})).toBeEnabled());
});
