import type { SaveCheckpoint } from "@cancha/core/domain/entities/save-checkpoint";
import type { SaveCheckpointSummary } from "@cancha/core/application/ports/async-save-checkpoint-store";
import {
  compareCheckpointLibrary,
  createSaveCheckpoint,
  verifySaveCheckpoint,
  type CheckpointComparison,
} from "@cancha/core/application/services/save-checkpoints";
import { parseTournamentBackupWithActivity } from "@cancha/core/application/services/tournament-archive";
import { restoreTournamentBackup } from "@cancha/core/application/use-cases/restore-tournament-backup";
import type { LibraryRestoreResult } from "@cancha/core/application/services/library-restore";
import { Inject, Injectable } from "@nestjs/common";
import { LibraryUnitOfWork, NotFoundError } from "../library/library-unit-of-work.js";
import { SAVE_CHECKPOINT_STORE_FACTORY, type SaveCheckpointStoreFactory } from "./save-checkpoint-persistence.js";

export interface SaveCheckpointPreview {
  readonly checkpoint: SaveCheckpointSummary;
  readonly comparison: CheckpointComparison;
  /** Versión de la biblioteca comparada: envíala como expectedLibraryVersion al restaurar. */
  readonly libraryVersion: number;
}

function summaryOf(record: SaveCheckpoint, version: number): SaveCheckpointSummary {
  const { content, ...metadata } = record;
  void content;
  return { ...metadata, version };
}

/**
 * Puntos de guardado por usuario. Toda la lógica (formato, huella, verificación,
 * comparación, restauración) es de core; aquí sólo se orquesta sobre Mongo:
 *
 * - crear: lee la biblioteca en una transacción snapshot (unidad de trabajo) y
 *   guarda el punto;
 * - vista previa → restaurar: la vista previa devuelve la versión del punto y la
 *   de la biblioteca; restaurar exige ambas y reemplaza la biblioteca en UNA
 *   transacción que también hace compare-and-set sobre el punto. Esto ata la
 *   revisión a la confirmación entre dos peticiones, sin estado en memoria.
 */
@Injectable()
export class SaveCheckpointsService {
  constructor(
    @Inject(SAVE_CHECKPOINT_STORE_FACTORY) private readonly createStore: SaveCheckpointStoreFactory,
    @Inject(LibraryUnitOfWork) private readonly unitOfWork: LibraryUnitOfWork,
  ) {}

  list(userId: string): Promise<SaveCheckpointSummary[]> {
    return this.createStore(userId).list();
  }

  async create(userId: string, name: string, description = ""): Promise<SaveCheckpointSummary> {
    const read = await this.unitOfWork.read(userId, repository => ({
      tournaments: repository.findAll(),
      activity: repository.findActivity(),
      universes: repository.getSportsUniverseLibrary(),
    }));
    const checkpoint = await createSaveCheckpoint(read.result, name, description);
    const version = await this.createStore(userId).add(checkpoint);
    return summaryOf(checkpoint, version);
  }

  async preview(userId: string, id: string): Promise<SaveCheckpointPreview> {
    const { record, version } = await this.verified(userId, id);
    const point = parseTournamentBackupWithActivity(record.content);
    const run = await this.unitOfWork.read(userId, repository => compareCheckpointLibrary(point, {
      tournaments: repository.findAll(),
      activity: repository.findActivity?.() ?? [],
      universes: repository.getSportsUniverseLibrary(),
    }));
    return { checkpoint: summaryOf(record, version), comparison: run.result, libraryVersion: run.libraryVersion };
  }

  /** El respaldo `cancha-backup` del punto, verificado (para descargarlo). */
  async content(userId: string, id: string): Promise<unknown> {
    const { record } = await this.verified(userId, id);
    return JSON.parse(record.content) as unknown;
  }

  async restore(
    userId: string,
    id: string,
    expectedVersion: number,
    expectedLibraryVersion: number,
  ): Promise<LibraryRestoreResult & { libraryVersion: number }> {
    const store = this.createStore(userId);
    const stored = await store.getExpected(id, expectedVersion);
    const record = await verifySaveCheckpoint(stored.record);
    const run = await this.unitOfWork.run(userId, repository => restoreTournamentBackup(record.content, "replace", repository), {
      expectedLibraryVersion,
      beforeCommit: session => store.assertVersion(id, expectedVersion, session),
    });
    return { ...run.result, libraryVersion: run.libraryVersion };
  }

  delete(userId: string, id: string, expectedVersion: number): Promise<void> {
    return this.createStore(userId).delete(id, expectedVersion);
  }

  private async verified(userId: string, id: string): Promise<{ record: SaveCheckpoint; version: number }> {
    const stored = await this.createStore(userId).get(id);
    if (!stored) throw new NotFoundError(`No se encontró el punto de guardado "${id}".`);
    return { record: await verifySaveCheckpoint(stored.record), version: stored.version };
  }
}
