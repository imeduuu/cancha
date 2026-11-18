import { isRejectionEvent } from "@cancha/core/application/services/activity-log";
import { validateLibraryChanges } from "@cancha/core/application/validation/library-changes";
import type { ClientSession } from "mongodb";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  hasLibraryChanges,
  InMemoryTournamentRepository,
  type LibraryChanges,
} from "@cancha/core/application/services/in-memory-library";
import {
  LibraryVersionConflictError,
  TournamentVersionConflictError,
  type LibrarySnapshot,
} from "../infrastructure/persistence/mongo-tournament-repository.js";
import {
  TOURNAMENT_REPOSITORY_FACTORY,
  type TournamentRepositoryFactory,
} from "../infrastructure/persistence/tournament-persistence.module.js";

/** Un recurso pedido por la API no existe (se traduce a NOT_FOUND). */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Versiones de la biblioteca vistas por el trabajo: las leídas y, tras el flush, las nuevas. */
export interface LibraryView {
  versionOf(id: string): number | undefined;
  readonly libraryVersion: number;
}

export interface UnitOfWorkOptions {
  /** Versión que el cliente editó, por torneo: si ya no es la vigente, CONFLICT sin ejecutar nada. */
  readonly expectedVersions?: Readonly<Record<string, number>>;
  /**
   * Versión de la biblioteca que el cliente revisó (p. ej. en la vista previa de
   * una restauración): si ya no es la vigente, CONFLICT sin ejecutar nada y sin
   * reintentos. Ata una revisión a su confirmación entre dos peticiones.
   */
  readonly expectedLibraryVersion?: number;
  /** Verificación adicional dentro de la transacción del commit (ver LibraryCommitOptions). */
  readonly beforeCommit?: (session: ClientSession) => Promise<void>;
}

export interface UnitOfWorkResult<T> extends LibraryView {
  readonly result: T;
  /** true si hubo flush. */
  readonly committed: boolean;
}

/** Resultado de `commitChanges`: versión de la biblioteca y de cada torneo tras el envío. */
export interface LibraryChangesCommit {
  /** false si el envío no cambiaba nada (no hubo escritura). */
  readonly committed: boolean;
  readonly libraryVersion: number;
  readonly versions: ReadonlyMap<string, number>;
}

/** Intentos ante un conflicto sólo de biblioteca (la versión del torneo que esperaba el cliente sigue vigente). */
export const libraryConflictAttempts = 3;

function view(versions: ReadonlyMap<string, number>, libraryVersion: number): LibraryView {
  return { versionOf: id => versions.get(id), libraryVersion };
}

function isThenable(value: unknown): boolean {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

/**
 * Unidad de trabajo del servidor (opción A de la fase 3): carga la biblioteca de
 * Mongo en un repositorio en memoria, ejecuta un caso de uso de core SIN cambios
 * y escribe todo lo que cambió en una sola transacción con verificación de
 * versión por torneo y de biblioteca. Si el caso de uso lanza, no se escribe
 * nada, salvo los eventos de rechazo (`outcome: "rejected"`), como en la web.
 */
@Injectable()
export class LibraryUnitOfWork {
  private readonly logger = new Logger("LibraryUnitOfWork");

  constructor(
    @Inject(TOURNAMENT_REPOSITORY_FACTORY) private readonly createRepository: TournamentRepositoryFactory,
  ) {}

  /**
   * Sólo lectura sobre la biblioteca de `userId`: carga y ejecuta, sin flush (lo
   * que el trabajo cambie se descarta).
   */
  async read<T>(
    userId: string,
    work: (repository: InMemoryTournamentRepository, view: LibraryView) => T,
  ): Promise<UnitOfWorkResult<T>> {
    const snapshot = await this.createRepository(userId).loadLibrary();
    const result = this.execute(work, new InMemoryTournamentRepository(this.stateOf(snapshot)), snapshot);
    return { result, committed: false, ...view(snapshot.versions, snapshot.libraryVersion) };
  }

  /**
   * Ejecuta `work` sobre la biblioteca de `userId` y escribe sus cambios. El
   * userId sale siempre de la sesión, nunca de un argumento del cliente: lo de
   * otro usuario no está en la biblioteca cargada, así que responde NOT_FOUND.
   */
  async run<T>(
    userId: string,
    work: (repository: InMemoryTournamentRepository, view: LibraryView) => T,
    options: UnitOfWorkOptions = {},
  ): Promise<UnitOfWorkResult<T>> {
    for (let attempt = 1; ; attempt++) {
      const store = this.createRepository(userId);
      const snapshot = await store.loadLibrary();
      this.assertExpectedVersions(snapshot, options.expectedVersions);
      if (options.expectedLibraryVersion !== undefined && snapshot.libraryVersion !== options.expectedLibraryVersion) {
        throw new LibraryVersionConflictError(options.expectedLibraryVersion, snapshot.libraryVersion);
      }
      const repository = new InMemoryTournamentRepository(this.stateOf(snapshot));
      let result: T;
      try {
        result = this.execute(work, repository, snapshot);
      } catch (error) {
        await this.persistRejections(userId, repository.changes());
        throw error;
      }
      const changes = repository.changes();
      if (!hasLibraryChanges(changes)) {
        return { result, committed: false, ...view(snapshot.versions, snapshot.libraryVersion) };
      }
      try {
        const committed = await store.commit(changes, snapshot, { beforeWrite: options.beforeCommit });
        const versions = new Map(snapshot.versions);
        for (const id of changes.deleted) versions.delete(id);
        if (changes.replaceLibrary) {
          const kept = new Set(changes.saved.map(({ id }) => id));
          for (const id of versions.keys()) if (!kept.has(id)) versions.delete(id);
        }
        for (const [id, version] of committed.versions) versions.set(id, version);
        return { result, committed: true, ...view(versions, committed.libraryVersion) };
      } catch (error) {
        if (error instanceof LibraryVersionConflictError && attempt < libraryConflictAttempts) continue;
        throw error;
      }
    }
  }

  /**
   * Confirma un conjunto de cambios calculado por un cliente (fase 5, C3) sobre la
   * biblioteca de `userId`: carga, exige que la biblioteca siga en
   * `expectedLibraryVersion` (sin reintentos: el cliente decidió leyendo esa
   * versión), valida todo lo que llega con `validateLibraryChanges` y escribe en
   * una transacción. Cualquier rechazo deja la biblioteca intacta.
   */
  async commitChanges(userId: string, changes: unknown, expectedLibraryVersion: number): Promise<LibraryChangesCommit> {
    const store = this.createRepository(userId);
    const snapshot = await store.loadLibrary();
    if (snapshot.libraryVersion !== expectedLibraryVersion) {
      throw new LibraryVersionConflictError(expectedLibraryVersion, snapshot.libraryVersion);
    }
    const normalized = validateLibraryChanges(changes, {
      tournaments: snapshot.tournaments,
      activity: snapshot.activity,
      universes: snapshot.universes,
    });
    if (!hasLibraryChanges(normalized)) {
      return { committed: false, libraryVersion: snapshot.libraryVersion, versions: snapshot.versions };
    }
    const committed = await store.commit(normalized, snapshot);
    const versions = new Map(snapshot.versions);
    for (const id of normalized.deleted) versions.delete(id);
    for (const [id, version] of committed.versions) versions.set(id, version);
    return { committed: true, libraryVersion: committed.libraryVersion, versions };
  }

  private execute<T>(
    work: (repository: InMemoryTournamentRepository, view: LibraryView) => T,
    repository: InMemoryTournamentRepository,
    snapshot: LibrarySnapshot,
  ): T {
    const result = work(repository, view(snapshot.versions, snapshot.libraryVersion));
    if (isThenable(result)) {
      throw new TypeError("La unidad de trabajo sólo ejecuta casos de uso síncronos.");
    }
    return result;
  }

  private stateOf(snapshot: LibrarySnapshot) {
    return {
      tournaments: [...snapshot.tournaments],
      activity: [...snapshot.activity],
      activeTournamentId: snapshot.activeTournamentId,
      universes: snapshot.universes,
    };
  }

  private assertExpectedVersions(snapshot: LibrarySnapshot, expected: UnitOfWorkOptions["expectedVersions"]): void {
    for (const [id, version] of Object.entries(expected ?? {})) {
      const actual = snapshot.versions.get(id);
      if (actual === undefined) throw new NotFoundError(`No se encontró el campeonato "${id}".`);
      if (actual !== version) {
        const name = snapshot.tournaments.find(tournament => tournament.id === id)?.name ?? id;
        throw new TournamentVersionConflictError(id, version, actual, name);
      }
    }
  }

  /** El caso de uso falló: sólo se conservan sus eventos de rechazo (p. ej. tournament-import-rejected). */
  private async persistRejections(userId: string, changes: LibraryChanges): Promise<void> {
    const rejected = changes.events.filter(isRejectionEvent);
    if (rejected.length === 0) return;
    try {
      const store = this.createRepository(userId);
      for (const event of rejected) await store.recordActivity(event);
    } catch (error) {
      this.logger.warn(`No se pudo registrar el rechazo: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
