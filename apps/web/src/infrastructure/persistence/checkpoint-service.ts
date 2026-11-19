import type { CheckpointCreationReview, CheckpointRestoreReview } from "@cancha/core/application/services/save-checkpoints";
import type { SaveCheckpoint } from "@cancha/core/domain/entities/save-checkpoint";

/**
 * Lo que el centro de guardado (`SaveCheckpointPanel`) usa de los puntos de guardado.
 *
 * Implementaciones:
 * - `SaveCheckpoints` de core sobre IndexedDB: modo sin sesión (por defecto).
 * - `ServerCheckpointService`: puntos de la cuenta en el servidor (fase 5H).
 */
export interface CheckpointService {
  list(): Promise<unknown[]>;
  verify(id: string): Promise<SaveCheckpoint>;
  reviewCreation(name: string, description?: string): Promise<CheckpointCreationReview>;
  confirmCreation(review: CheckpointCreationReview, confirmed: boolean): Promise<SaveCheckpoint>;
  download(id: string): Promise<{ name: string; content: string }>;
  edit(id: string, expected: unknown, name: string, description: string): Promise<SaveCheckpoint>;
  delete(id: string, expected: unknown, confirmed: boolean): Promise<void>;
  reviewRestoration(id: string): Promise<CheckpointRestoreReview>;
  confirmRestoration(review: CheckpointRestoreReview, confirmed: boolean): Promise<{ added: number; skipped: number }>;
  downloadCurrent(): { name: string; content: string };

  /** "server" para los puntos de la cuenta; ausente = este navegador (IndexedDB). */
  readonly location?: "server";
  /** false si no se pueden editar nombre y descripción (ausente = sí). */
  readonly canEdit?: boolean;
}
