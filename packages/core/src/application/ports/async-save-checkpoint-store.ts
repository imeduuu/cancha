import type { SaveCheckpoint } from "../../domain/entities/save-checkpoint";

/** Metadatos de un punto (sin su contenido) y su versión para compare-and-set. */
export type SaveCheckpointSummary = Omit<SaveCheckpoint, "content"> & { readonly version: number };

/** Registro tal como está guardado (se verifica con `verifySaveCheckpoint`) y su versión. */
export interface StoredSaveCheckpoint {
  readonly record: unknown;
  readonly version: number;
}

/**
 * Almacén asíncrono de puntos de guardado para adaptadores de servidor.
 *
 * A diferencia de `SaveCheckpointStore` (web), no tiene `exclusive(action(lease))`:
 * ese método serializa pestañas con Web Locks y emite un `LibraryWriteLease`
 * para escribir en localStorage. En un servidor no hay un bloqueo compartido
 * entre instancias que pueda sostenerse durante un `await`; la coordinación la
 * dan las transacciones y las versiones (`version` de cada punto para
 * compare-and-set, y la versión de la biblioteca al restaurar).
 */
export interface AsyncSaveCheckpointStore {
  /** Lo más reciente primero. */
  list(): Promise<SaveCheckpointSummary[]>;
  get(id: string): Promise<StoredSaveCheckpoint | undefined>;
  /** Devuelve la versión inicial (1). */
  add(checkpoint: SaveCheckpoint): Promise<number>;
  /** Compare-and-set: sólo elimina si la versión guardada sigue siendo `expectedVersion`. */
  delete(id: string, expectedVersion: number): Promise<void>;
}
