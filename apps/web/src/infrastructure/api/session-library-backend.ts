import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import type { SportsUniverseLibrary } from "@cancha/core/domain/entities/sports-universe";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import {
  hasLibraryChanges,
  InMemoryTournamentRepository,
  type InMemoryLibraryState,
  type LibraryChanges,
} from "@cancha/core/application/services/in-memory-library";
import { emptySportsUniverseLibrary } from "@cancha/core/application/services/sports-universes";
import { createTournamentBackup } from "@cancha/core/application/services/tournament-archive";
import type { CheckpointService } from "../persistence/checkpoint-service";
import type { LibraryBackend } from "../persistence/library-backend";
import { operations } from "./operations";
import { ServerCheckpointService } from "./server-checkpoint-service";
import {
  ApiConflictError,
  ApiNetworkError,
  ApiUnauthenticatedError,
  type GraphqlVariables,
} from "./graphql-client";

/** Lo que el backend necesita de la sesión: peticiones autenticadas (AuthSession lo cumple). */
export interface LibraryApi {
  request<T>(query: string, variables?: GraphqlVariables): Promise<T>;
}

interface ServerLibrary {
  readonly tournaments: Tournament[];
  readonly activity: ActivityEvent[];
  readonly activeTournamentId: string | null;
  readonly universes?: SportsUniverseLibrary;
  readonly libraryVersion: number;
}

interface ConfirmedLibrary {
  readonly state: InMemoryLibraryState;
  readonly libraryVersion: number;
}

interface RecordedRestore {
  readonly tournaments: readonly Tournament[];
  readonly mode: "merge" | "replace";
  readonly activity: readonly ActivityEvent[];
  readonly universes?: SportsUniverseLibrary;
}

export const libraryChangedRemotelyMessage =
  "La biblioteca cambió en otra pestaña o dispositivo. Conservamos tus borradores. Actualiza la vista y revisa nuevamente antes de guardar.";
const coordinatedWriteMessage = "Esta operación requiere una escritura coordinada. Actualiza la vista y vuelve a intentarlo.";

const snapshotQuery = operations.librarySnapshot;
const versionQuery = operations.libraryVersion;
const commitMutation = operations.commitLibraryChanges;
const restoreMutation = operations.restoreBackup;

function toConfirmed(library: ServerLibrary): ConfirmedLibrary {
  if (!Array.isArray(library?.tournaments) || !Array.isArray(library.activity) || !Number.isSafeInteger(library.libraryVersion)) {
    throw new Error("El servidor devolvió una biblioteca con un formato inesperado.");
  }
  return {
    libraryVersion: library.libraryVersion,
    state: {
      tournaments: library.tournaments,
      activity: library.activity,
      activeTournamentId: library.activeTournamentId ?? null,
      universes: library.universes ?? emptySportsUniverseLibrary(),
    },
  };
}

/** Lo que el cliente envía: sin `activityUniverseIds`, que deriva el servidor. */
function outgoing(changes: LibraryChanges): Omit<LibraryChanges, "activityUniverseIds" | "replaceLibrary" | "replaceActivity"> {
  const { saved, deleted, events, activeTournament, universes } = changes;
  return {
    saved,
    deleted,
    events,
    ...(activeTournament ? { activeTournament } : {}),
    ...(universes ? { universes } : {}),
  };
}

/** Réplica en memoria que además recuerda si la acción restauró un respaldo. */
class DraftLibrary extends InMemoryTournamentRepository {
  restore: RecordedRestore | null = null;

  override importTournaments(
    tournaments: readonly Tournament[],
    mode: "merge" | "replace",
    activity: readonly ActivityEvent[] = [],
    skipRecoveryCopy?: boolean,
    universes?: SportsUniverseLibrary,
  ) {
    const result = super.importTournaments(tournaments, mode, activity, skipRecoveryCopy, universes);
    this.restore = { tournaments, mode, activity, universes };
    return result;
  }
}

/**
 * Biblioteca de un usuario con sesión (fase 5G, C3). Es una réplica en memoria de
 * la biblioteca del servidor: las lecturas son síncronas, como con localStorage, y
 * cada `coordinate` ejecuta la acción síncrona sobre un borrador y envía sus
 * `changes()` con `commitLibraryChanges`, atado a la versión de biblioteca leída.
 * Las restauraciones (MERGE o REPLACE) van siempre por `restoreBackup`.
 *
 * Si el servidor responde CONFLICT, la réplica se recarga y `snapshot()` cambia:
 * la vista muestra el aviso de cambio externo, igual que con otra pestaña.
 */
export class SessionLibraryBackend implements LibraryBackend {
  readonly origin = "server" as const;
  private confirmed: ConfirmedLibrary;
  private confirmedView: InMemoryTournamentRepository;
  private draft: DraftLibrary | null = null;
  private writing = false;
  private readonly listeners = new Set<() => void>();
  private readonly channel: BroadcastChannel | null;
  private readonly onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") void this.checkForRemoteChanges();
  };

  private constructor(private readonly api: LibraryApi, library: ServerLibrary, channelName?: string) {
    this.confirmed = toConfirmed(library);
    this.confirmedView = new InMemoryTournamentRepository(this.confirmed.state);
    this.channel = channelName && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(channelName) : null;
    this.channel?.addEventListener("message", event => {
      const version = (event as MessageEvent<{ libraryVersion?: unknown }>).data?.libraryVersion;
      if (typeof version === "number" && version > this.confirmed.libraryVersion) void this.checkForRemoteChanges();
    });
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisibility);
  }

  /** Descarga la biblioteca del usuario. `userId` aísla el canal entre pestañas por cuenta. */
  static async load(api: LibraryApi, userId?: string): Promise<SessionLibraryBackend> {
    const { librarySnapshot } = await api.request<{ librarySnapshot: ServerLibrary }>(snapshotQuery);
    return new SessionLibraryBackend(api, librarySnapshot, userId ? `cancha.session-library.${userId}` : undefined);
  }

  /** Deja de escuchar otras pestañas y la visibilidad (al cerrar sesión o desmontar). */
  dispose(): void {
    this.channel?.close();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
    this.listeners.clear();
  }

  /** Puntos de guardado de la cuenta; `onRestored` se llama con la réplica ya recargada. */
  createCheckpointService(onRestored: () => void): CheckpointService {
    return new ServerCheckpointService(this.api, this, onRestored);
  }

  /** Vuelve a descargar la biblioteca (p. ej. tras restaurar un punto en el servidor). */
  async reloadFromServer(): Promise<void> {
    await this.reload();
    this.channel?.postMessage({ libraryVersion: this.confirmed.libraryVersion });
  }

  /** Avisa cuando la réplica cambió por otra pestaña o dispositivo. */
  subscribeExternalChanges(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Recarga desde el servidor si su biblioteca es más nueva que la réplica. */
  async checkForRemoteChanges(): Promise<boolean> {
    if (this.writing) return false;
    try {
      const { library } = await this.api.request<{ library: { libraryVersion: number } }>(versionQuery);
      if (library.libraryVersion === this.confirmed.libraryVersion || this.writing) return false;
      await this.reload();
      return true;
    } catch {
      return false;
    }
  }

  // ---------- Coordinación ----------

  /**
   * Huella de la biblioteca. Durante una escritura anticipa la versión que dejará
   * el commit (+1 si hay cambios): `runWrite` la lee dentro de la acción, antes de
   * que el servidor confirme.
   */
  snapshot(): string {
    const version = this.draft && hasLibraryChanges(this.draft.changes())
      ? this.confirmed.libraryVersion + 1
      : this.confirmed.libraryVersion;
    return `servidor:v${version}`;
  }

  async coordinate<T>(expected: string, action: () => T): Promise<T> {
    if (this.writing) throw new Error("Ya hay una escritura en curso.");
    if (this.snapshot() !== expected) throw new Error(libraryChangedRemotelyMessage);
    this.writing = true;
    const base = this.confirmed;
    const draftState: InMemoryLibraryState = { ...base.state };
    const draft = new DraftLibrary(draftState);
    let result: T;
    try {
      this.draft = draft;
      try {
        result = action();
        if (result instanceof Promise) {
          void result.catch(() => {});
          throw new Error("La escritura deportiva debe terminar sincrónicamente dentro del bloqueo.");
        }
      } finally {
        this.draft = null;
      }
      const changes = draft.changes();
      if (draft.restore) {
        await this.restore(draft.restore, base.libraryVersion);
      } else if (hasLibraryChanges(changes)) {
        const { commitLibraryChanges } = await this.api.request<{ commitLibraryChanges: { committed: boolean; libraryVersion: number } }>(
          commitMutation,
          { changes: outgoing(changes), expectedLibraryVersion: base.libraryVersion },
        );
        this.adopt({ state: draftState, libraryVersion: commitLibraryChanges.libraryVersion });
        if (commitLibraryChanges.libraryVersion !== base.libraryVersion + 1) this.notify();
        this.channel?.postMessage({ libraryVersion: commitLibraryChanges.libraryVersion });
      }
      return result;
    } catch (error) {
      throw await this.explain(error);
    } finally {
      this.writing = false;
    }
  }

  commitUnderLibraryLock<T>(): T {
    throw new Error("Con sesión, la biblioteca se restaura desde los puntos de guardado de tu cuenta.");
  }

  // ---------- Lecturas (borrador durante una escritura; si no, lo confirmado) ----------

  findAll(): Tournament[] { return this.view().findAll(); }
  findActivity(): ActivityEvent[] { return this.view().findActivity(); }
  getActiveTournamentId(): string | null { return this.view().getActiveTournamentId(); }
  getSportsUniverseLibrary(): SportsUniverseLibrary { return this.view().getSportsUniverseLibrary(); }
  findAllWithRecoveryReport(): { tournaments: Tournament[]; warnings: string[] } {
    return { tournaments: this.findAll(), warnings: [] };
  }

  // ---------- Escrituras: sólo dentro de coordinate ----------

  save(tournament: Tournament): void { this.writable().save(tournament); }
  saveWithActivity(tournament: Tournament, event: ActivityEvent): void { this.writable().saveWithActivity(tournament, event); }
  saveManyWithActivity(tournaments: readonly Tournament[], event: ActivityEvent): void {
    this.writable().saveManyWithActivity(tournaments, event);
  }
  recordActivity(event: ActivityEvent): void { this.writable().recordActivity(event); }
  deleteById(id: string): void { this.writable().deleteById(id); }
  setSportsUniverseLibrary(library: SportsUniverseLibrary): void { this.writable().setSportsUniverseLibrary(library); }
  importTournaments(
    tournaments: readonly Tournament[],
    mode: "merge" | "replace",
    activity?: readonly ActivityEvent[],
    skipRecoveryCopy?: boolean,
    universes?: SportsUniverseLibrary,
  ): { added: number; skipped: number } {
    return this.writable().importTournaments(tournaments, mode, activity, skipRecoveryCopy, universes);
  }

  /**
   * Como en localStorage, elegir el torneo activo no exige una escritura coordinada:
   * fuera de una escritura es una preferencia de esta vista (no se envía); dentro,
   * viaja con los demás cambios.
   */
  setActiveTournamentId(id: string | null): void {
    if (this.draft) this.draft.setActiveTournamentId(id);
    else this.confirmed.state.activeTournamentId = id;
  }

  // ---------- Recuperación local: no aplica con sesión ----------

  getRecoverySnapshotStatus(): { available: boolean; warning?: string } {
    return { available: false };
  }
  restoreRecoverySnapshot(): { added: number; skipped: number } {
    throw new Error("Con sesión no hay copia de recuperación local: usa los puntos de guardado de tu cuenta.");
  }
  readRawTournamentDataForRecovery(): string {
    const view = this.confirmedView;
    return JSON.stringify(createTournamentBackup(view.findAll(), undefined, view.findActivity(), view.getSportsUniverseLibrary()), null, 2);
  }

  // ---------- Internos ----------

  private view(): InMemoryTournamentRepository {
    return this.draft ?? this.confirmedView;
  }

  private writable(): DraftLibrary {
    if (!this.draft) throw new Error(coordinatedWriteMessage);
    return this.draft;
  }

  private adopt(confirmed: ConfirmedLibrary): void {
    this.confirmed = confirmed;
    this.confirmedView = new InMemoryTournamentRepository(confirmed.state);
  }

  private async reload(): Promise<void> {
    const { librarySnapshot } = await this.api.request<{ librarySnapshot: ServerLibrary }>(snapshotQuery);
    this.adopt(toConfirmed(librarySnapshot));
    this.notify();
  }

  private async restore(restore: RecordedRestore, expectedLibraryVersion: number): Promise<void> {
    const backup = createTournamentBackup(restore.tournaments, undefined, restore.activity, restore.universes);
    const { restoreBackup } = await this.api.request<{ restoreBackup: { libraryVersion: number } }>(restoreMutation, {
      backup: JSON.stringify(backup),
      mode: restore.mode === "replace" ? "REPLACE" : "MERGE",
      expectedLibraryVersion,
    });
    // El servidor rehace el plan (ids y fechas propias del evento library-restored): se adopta lo suyo.
    const { librarySnapshot } = await this.api.request<{ librarySnapshot: ServerLibrary }>(snapshotQuery);
    this.adopt(toConfirmed(librarySnapshot));
    if (librarySnapshot.libraryVersion !== expectedLibraryVersion + 1 || restoreBackup.libraryVersion !== expectedLibraryVersion + 1) {
      this.notify();
    }
    this.channel?.postMessage({ libraryVersion: librarySnapshot.libraryVersion });
  }

  /** Traduce errores de la API; ante CONFLICT recarga la réplica para que la vista lo muestre. */
  private async explain(error: unknown): Promise<unknown> {
    if (error instanceof ApiConflictError) {
      try { await this.reload(); } catch { /* el aviso igual se muestra con el error */ }
      return new Error(libraryChangedRemotelyMessage);
    }
    if (error instanceof ApiUnauthenticatedError) {
      return new Error("Tu sesión terminó. Vuelve a ingresar; los cambios no se guardaron.");
    }
    if (error instanceof ApiNetworkError) {
      return new Error(`${error.message} Los cambios no se guardaron.`);
    }
    return error;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
