import type { LibraryWriteLease } from "@cancha/core/application/ports/library-write-lease";
import { withLibraryWriteLock } from "./library-write-lock";
import type { SaveCheckpointStore } from "@cancha/core/application/ports/save-checkpoint-store";
import type { SaveCheckpoint } from "@cancha/core/domain/entities/save-checkpoint";

export const checkpointDatabaseName = "cancha.save-checkpoints";
const storeName = "checkpoints";

export function checkpointStorageError(error: unknown): Error {
  const name = error && typeof error === "object" && "name" in error ? error.name : "";
  if (name === "QuotaExceededError") return new Error("No se guardó el punto: el almacenamiento del navegador está lleno. Descarga un respaldo JSON.");
  if (name === "VersionError") return new Error("La versión del almacenamiento de puntos es incompatible con esta aplicación.");
  if (name === "AbortError") return new Error("La transacción de puntos de control fue abortada; no se confirmó la operación.");
  if (name === "ConstraintError") return new Error("Ya existe un punto con ese identificador. Revisa nuevamente antes de guardar.");
  if (name === "SecurityError" || name === "NotAllowedError") return new Error("El navegador bloqueó el acceso a IndexedDB. Revisa sus permisos o descarga un respaldo JSON.");
  if (name === "InvalidStateError") return new Error("El almacenamiento de puntos no está disponible o se cerró. Actualiza la lista antes de continuar.");
  if (error instanceof Error && error.message) return new Error(error.message);
  return new Error("No se pudo acceder al almacenamiento de puntos de control.");
}

export class IndexedDbSaveCheckpointStore implements SaveCheckpointStore {
  constructor(private readonly factory: () => IDBFactory | undefined = () => globalThis.indexedDB) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        const factory = this.factory();
        if (!factory) throw new Error("IndexedDB no está disponible. Puedes seguir descargando respaldos JSON desde este Centro.");
        request = factory.open(checkpointDatabaseName, 1);
      } catch (error) { reject(checkpointStorageError(error)); return; }
      let abandoned = false;
      request.onupgradeneeded = event => {
        if (event.oldVersion === 0) request.result.createObjectStore(storeName, {keyPath: "id"});
      };
      request.onblocked = () => {
        abandoned = true;
        reject(new Error("El almacenamiento está bloqueado por otra pestaña. Ciérrala y vuelve a abrir el Centro."));
      };
      request.onerror = () => reject(checkpointStorageError(request.error));
      request.onsuccess = () => {
        const db = request.result;
        if (abandoned) { db.close(); return; }
        db.onversionchange = () => db.close();
        if (!db.objectStoreNames.contains(storeName)) {
          db.close(); reject(new Error("El almacenamiento de puntos es incompatible o está incompleto.")); return;
        }
        resolve(db);
      };
    });
  }

  private async transaction<T>(mode: IDBTransactionMode, prepare: (store: IDBObjectStore, result: (value: T) => void, abort: (error: Error) => void) => void): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      let value: T;
      let preparationError: unknown;
      try { tx = db.transaction(storeName, mode); }
      catch (error) { db.close(); reject(checkpointStorageError(error)); return; }
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onabort = () => { db.close(); reject(checkpointStorageError(preparationError ?? tx.error ?? new DOMException("Transacción abortada", "AbortError"))); };
      tx.onerror = () => { /* onabort reports the transaction's final outcome, not a request's provisional success. */ };
      try {
        const store = tx.objectStore(storeName);
        if (store.keyPath !== "id" || store.autoIncrement) {
          preparationError = new Error("El esquema del almacenamiento de puntos es incompatible. No se modificaron sus registros.");tx.abort();return;
        }
        prepare(store, next => { value = next; }, error => { preparationError = error; tx.abort(); });
      }
      catch (error) { preparationError = error; tx.abort(); }
    });
  }

  list(): Promise<unknown[]> {
    return this.transaction("readonly", (store, result) => { const request = store.getAll(); request.onsuccess = () => result(request.result); });
  }
  get(id: string): Promise<unknown> {
    return this.transaction("readonly", (store, result) => { const request = store.get(id); request.onsuccess = () => result(request.result); });
  }
  add(checkpoint: SaveCheckpoint): Promise<void> {
    return this.transaction("readwrite", store => { store.add(checkpoint); });
  }
  replace(id: string, expected: unknown, checkpoint: SaveCheckpoint): Promise<void> {
    if (checkpoint.id !== id) return Promise.reject(new Error("No se puede cambiar la identidad de un punto al editar sus metadatos."));
    return this.change(id, expected, store => { store.put(checkpoint); });
  }
  delete(id: string, expected: unknown): Promise<void> {
    return this.change(id, expected, store => { store.delete(id); });
  }
  private change(id: string, expected: unknown, mutate: (store: IDBObjectStore) => void): Promise<void> {
    return this.transaction("readwrite", (store, _result, abort) => {
      const request = store.get(id);
      request.onsuccess = () => {
        if (request.result === undefined || JSON.stringify(request.result) !== JSON.stringify(expected)) {
          // Abort with an observable error; a concurrent edit/delete must never be overwritten.
          abort(new Error("El punto cambió o fue eliminado en otra pestaña. Actualiza la lista y revisa nuevamente."));
          return;
        }
        mutate(store);
      };
    });
  }

  async exclusive<T>(action: (lease?: LibraryWriteLease) => Promise<T>, requireCoordination = false): Promise<T> {
    const locks = globalThis.navigator?.locks;
    if (locks) return withLibraryWriteLock(action);
    if (requireCoordination) throw new Error("Este navegador no permite coordinar una restauración entre pestañas. Puedes descargar el punto como JSON; restaurar también requiere Web Locks.");
    return action();
  }
}
