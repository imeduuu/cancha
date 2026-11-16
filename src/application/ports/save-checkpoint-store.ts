import type { SaveCheckpoint } from "../../domain/entities/save-checkpoint";
import type { LibraryWriteLease } from "./library-write-lease";

export interface SaveCheckpointStore {
  list(): Promise<unknown[]>;
  get(id: string): Promise<unknown>;
  add(checkpoint: SaveCheckpoint): Promise<void>;
  /** Compare-and-set within one transaction; never recreate a deleted record. */
  replace(id: string, expected: unknown, checkpoint: SaveCheckpoint): Promise<void>;
  delete(id: string, expected: unknown): Promise<void>;
  /** Cross-tab exclusion with all mutations. Unsupported browsers must reject restoration. */
  exclusive<T>(action: (lease?: LibraryWriteLease) => Promise<T>, requireCoordination?: boolean): Promise<T>;
}
