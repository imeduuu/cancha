import {
  CheckpointValidationError,
  createSaveCheckpoint,
  type CheckpointComparison,
  type CheckpointCreationReview,
  type CheckpointRestoreReview,
} from "@cancha/core/application/services/save-checkpoints";
import type { SaveCheckpoint } from "@cancha/core/domain/entities/save-checkpoint";
import type { CheckpointService } from "../persistence/checkpoint-service";
import { ApiConflictError, ApiNotFoundError, ApiValidationError } from "./graphql-client";
import { operations } from "./operations";
import type { LibraryApi, SessionLibraryBackend } from "./session-library-backend";

interface ServerCheckpoint {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly tournamentCount: number;
  readonly universeCount: number;
  readonly activityCount: number;
  readonly sizeBytes: number;
  readonly version: number;
  readonly revision: number;
  readonly backupVersion: number;
  readonly digest: string;
}

/** Fila con la forma de `SaveCheckpoint` (sin contenido: el servidor lo guarda) más su versión de compare-and-set. */
export type ServerCheckpointRow = SaveCheckpoint & { readonly version: number };

function toRow(checkpoint: ServerCheckpoint): ServerCheckpointRow {
  return {
    storageVersion: 1,
    id: checkpoint.id,
    name: checkpoint.name,
    description: checkpoint.description,
    createdAt: checkpoint.createdAt,
    updatedAt: checkpoint.updatedAt,
    revision: checkpoint.revision,
    backupFormat: "cancha-backup",
    backupVersion: checkpoint.backupVersion as 7,
    tournamentCount: checkpoint.tournamentCount,
    universeCount: checkpoint.universeCount,
    activityCount: checkpoint.activityCount,
    sizeBytes: checkpoint.sizeBytes,
    integrity: { algorithm: "SHA-256", digest: checkpoint.digest },
    content: "",
    version: checkpoint.version,
  };
}

function versionOf(expected: unknown): number {
  const version = (expected as { version?: unknown } | null)?.version;
  if (typeof version !== "number") throw new Error("El punto no tiene versión. Actualiza la lista antes de continuar.");
  return version;
}

/**
 * Puntos de guardado de la cuenta (fase 5H), con la misma interfaz que el centro de
 * guardado usa sin sesión. Revisar → confirmar sin estado en el servidor: la vista
 * previa trae la versión del punto y la de la biblioteca, y restaurar exige ambas
 * (el servidor reemplaza la biblioteca y verifica el punto en una transacción).
 * Sin edición de nombre o descripción: el servidor todavía no la ofrece.
 */
export class ServerCheckpointService implements CheckpointService {
  readonly location = "server" as const;
  readonly canEdit = false;
  private readonly creations = new WeakSet<CheckpointCreationReview>();
  private readonly restores = new WeakMap<CheckpointRestoreReview, { version: number; libraryVersion: number }>();

  constructor(
    private readonly api: LibraryApi,
    private readonly library: SessionLibraryBackend,
    private readonly onRestored: () => void,
  ) {}

  async list(): Promise<unknown[]> {
    const { saveCheckpoints } = await this.api.request<{ saveCheckpoints: ServerCheckpoint[] }>(operations.saveCheckpoints);
    return saveCheckpoints.map(toRow);
  }

  /** El servidor verifica la huella y la coherencia del respaldo al leer su contenido. */
  async verify(id: string): Promise<SaveCheckpoint> {
    const row = (await this.list() as ServerCheckpointRow[]).find(item => item.id === id);
    if (!row) throw new CheckpointValidationError("El punto fue eliminado.", "Error de lectura");
    try {
      await this.content(id);
    } catch (error) {
      if (error instanceof ApiValidationError) throw new CheckpointValidationError(error.message, "Inválido", row);
      throw error;
    }
    return row;
  }

  async reviewCreation(name: string, description = ""): Promise<CheckpointCreationReview> {
    const checkpoint = await createSaveCheckpoint({
      tournaments: this.library.findAll(),
      activity: this.library.findActivity(),
      universes: this.library.getSportsUniverseLibrary(),
    }, name, description);
    const review = { checkpoint, libraryToken: this.library.snapshot() };
    this.creations.add(review);
    return review;
  }

  async confirmCreation(review: CheckpointCreationReview, confirmed: boolean): Promise<SaveCheckpoint> {
    if (!confirmed) throw new Error("Se requiere confirmar la creación del punto.");
    if (!this.creations.has(review) || this.library.snapshot() !== review.libraryToken) {
      throw new Error("La revisión del punto está obsoleta. La biblioteca cambió; revisa nuevamente.");
    }
    const { createSaveCheckpoint: created } = await this.api.request<{ createSaveCheckpoint: ServerCheckpoint }>(
      operations.createSaveCheckpoint,
      { name: review.checkpoint.name, description: review.checkpoint.description },
    );
    this.creations.delete(review);
    return toRow(created);
  }

  async download(id: string): Promise<{ name: string; content: string }> {
    return { name: `cancha-punto-${id}.json`, content: JSON.stringify(await this.content(id), null, 2) };
  }

  async edit(): Promise<SaveCheckpoint> {
    throw new Error("Con sesión todavía no se pueden editar el nombre ni la descripción de un punto.");
  }

  async delete(id: string, expected: unknown, confirmed: boolean): Promise<void> {
    if (!confirmed) throw new Error("Se requiere confirmar la eliminación del punto.");
    try {
      await this.api.request(operations.deleteSaveCheckpoint,
        { id, version: versionOf(expected) });
    } catch (error) {
      if (error instanceof ApiConflictError) throw new Error("El punto cambió. Actualiza la lista antes de eliminarlo.");
      if (error instanceof ApiNotFoundError) throw new Error("El punto ya no existe. Actualiza la lista.");
      throw error;
    }
  }

  async reviewRestoration(id: string): Promise<CheckpointRestoreReview> {
    const { saveCheckpointPreview: preview } = await this.api.request<{
      saveCheckpointPreview: { checkpoint: ServerCheckpoint; comparison: CheckpointComparison; libraryVersion: number };
    }>(operations.saveCheckpointPreview, { id });
    const review = { checkpoint: toRow(preview.checkpoint), libraryToken: `servidor:v${preview.libraryVersion}`, comparison: preview.comparison };
    this.restores.set(review, { version: preview.checkpoint.version, libraryVersion: preview.libraryVersion });
    return review;
  }

  async confirmRestoration(review: CheckpointRestoreReview, confirmed: boolean): Promise<{ added: number; skipped: number }> {
    if (!confirmed) throw new Error("Se requiere confirmación explícita para reemplazar la biblioteca.");
    const expected = this.restores.get(review);
    if (!expected) throw new Error("La revisión de restauración está obsoleta o ya fue utilizada.");
    let restored: { added: number; skipped: number };
    try {
      ({ restoreSaveCheckpoint: restored } = await this.api.request<{ restoreSaveCheckpoint: { added: number; skipped: number } }>(
        operations.restoreSaveCheckpoint,
        { id: review.checkpoint.id, version: expected.version, libraryVersion: expected.libraryVersion },
      ));
    } catch (error) {
      if (error instanceof ApiConflictError) {
        throw new Error("La biblioteca o el punto cambiaron desde la revisión. Revisa nuevamente la restauración.");
      }
      if (error instanceof ApiNotFoundError) throw new Error("El punto fue eliminado. Revisa nuevamente la restauración.");
      throw error;
    }
    this.restores.delete(review);
    await this.library.reloadFromServer();
    this.onRestored();
    return { added: restored.added, skipped: restored.skipped };
  }

  downloadCurrent(): { name: string; content: string } {
    return { name: "cancha-respaldo-actual.json", content: this.library.readRawTournamentDataForRecovery() };
  }

  private async content(id: string): Promise<unknown> {
    const { saveCheckpointContent } = await this.api.request<{ saveCheckpointContent: unknown }>(
      operations.saveCheckpointContent, { id },
    );
    return saveCheckpointContent;
  }
}
