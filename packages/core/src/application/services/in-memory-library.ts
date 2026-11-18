import { isActivityEvent, type ActivityEvent } from "../../domain/entities/activity-event";
import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentLibraryRepository } from "../ports/tournament-repository";
import { createActivityEvent } from "./activity-log";
import {
  planLibraryRestore,
  validateLibraryRestore,
  type LibraryRestoreMode,
  type LibraryRestoreResult,
} from "./library-restore";
import { getTournamentStorageIssue } from "../validation/tournament-storage";
import type { SportsUniverseLibrary } from "../../domain/entities/sports-universe";
import {
  activityUniverseChanges,
  emptySportsUniverseLibrary,
  reattributeActivityToUniverses,
  restoredSportsUniverses,
  tournamentsInUniverse,
  validateSportsUniverseRelations,
} from "./sports-universes";

/** Estado de una biblioteca en memoria. Varias instancias pueden compartirlo (p. ej. `reopen` del contrato). */
export interface InMemoryLibraryState {
  /** Lo último guardado primero, igual que localStorage y Mongo. */
  tournaments: Tournament[];
  /** En orden de registro. */
  activity: ActivityEvent[];
  activeTournamentId: string | null;
  /** Universos deportivos; ausente equivale a ninguno. */
  universes?: SportsUniverseLibrary;
}

/**
 * Lo que cambió una instancia respecto del estado con el que se creó: es lo que
 * la unidad de trabajo escribe en Mongo en una sola transacción.
 */
export interface LibraryChanges {
  /** Estado final de cada torneo guardado, en orden de guardado (el último, al final). */
  readonly saved: readonly Tournament[];
  /** Torneos que existían al empezar y ya no existen. */
  readonly deleted: readonly string[];
  /** Eventos nuevos, en orden de registro. */
  readonly events: readonly ActivityEvent[];
  /** Presente sólo si cambió el torneo activo. */
  readonly activeTournament?: { readonly id: string | null };
  /** La biblioteca completa se reemplazó (restauración de respaldo en modo reemplazar). */
  readonly replaceLibrary?: boolean;
  /** El historial completo se reemplazó por `events`. */
  readonly replaceActivity?: boolean;
  /** Presente sólo si cambiaron (o si se reemplazó la biblioteca). */
  readonly universes?: SportsUniverseLibrary;
  /**
   * Nuevo `universeId` (null = sin universo) de eventos que YA existían, derivado
   * con `reattributeActivityToUniverses` al cambiar los universos. Lo calcula quien
   * confirma (la unidad de trabajo del servidor); un cliente no puede enviarlo.
   */
  readonly activityUniverseIds?: Readonly<Record<string, string | null>>;
}

export function hasLibraryChanges(changes: LibraryChanges): boolean {
  return changes.saved.length > 0
    || changes.deleted.length > 0
    || changes.events.length > 0
    || changes.activeTournament !== undefined
    || changes.replaceLibrary === true
    || changes.replaceActivity === true
    || changes.universes !== undefined
    || Object.keys(changes.activityUniverseIds ?? {}).length > 0;
}

export function emptyInMemoryLibrary(): InMemoryLibraryState {
  return { tournaments: [], activity: [], activeTournamentId: null, universes: emptySportsUniverseLibrary() };
}

/** Igual que los adaptadores persistentes: se guarda exactamente la forma JSON. */
function toPlainJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function storageIssue(tournament: Tournament): string | undefined {
  try {
    return getTournamentStorageIssue(tournament);
  } catch {
    return "El formato de los datos no es válido.";
  }
}

/**
 * Biblioteca síncrona en memoria con el mismo contrato que localStorage y Mongo.
 * La usa la unidad de trabajo del servidor: se carga desde Mongo, los casos de uso
 * de core se ejecutan sin cambios sobre ella y después se escriben sus `changes()`.
 * La web con sesión hace lo mismo sobre la biblioteca descargada del servidor (fase 5).
 */
export class InMemoryTournamentRepository implements TournamentLibraryRepository {
  private readonly initialIds: ReadonlySet<string>;
  private readonly initialActiveId: string | null;
  /** id → orden del último guardado/eliminación en esta instancia. */
  private readonly touched = new Map<string, true>();
  private readonly newEvents: ActivityEvent[] = [];
  /** Se restauró un respaldo en modo reemplazar: la biblioteca y el historial se escriben completos. */
  private replaced = false;
  private readonly initialUniverses: string;
  /** Eventos que ya existían al crear la instancia y cuyo universeId cambió en ella. */
  private readonly reattributed: Record<string, string | null> = {};

  constructor(private readonly state: InMemoryLibraryState = emptyInMemoryLibrary()) {
    this.initialIds = new Set(state.tournaments.map(({ id }) => id));
    this.initialActiveId = state.activeTournamentId;
    this.initialUniverses = JSON.stringify(this.getSportsUniverseLibrary());
  }

  getSportsUniverseLibrary(): SportsUniverseLibrary {
    return this.state.universes ?? emptySportsUniverseLibrary();
  }

  /** Igual que localStorage: valida las relaciones y reatribuye el historial con la regla de core. */
  setSportsUniverseLibrary(library: SportsUniverseLibrary): void {
    const validated = validateSportsUniverseRelations(library, this.state.tournaments, this.state.activity);
    const before = this.state.activity;
    const after = reattributeActivityToUniverses(this.getSportsUniverseLibrary(), validated, before);
    const fresh = new Set(this.newEvents.map(({ id }) => id));
    for (const [id, universeId] of Object.entries(activityUniverseChanges(before, after))) {
      if (!fresh.has(id)) this.reattributed[id] = universeId;
    }
    this.state.activity = after;
    // Los eventos nuevos se envían ya reatribuidos.
    const byId = new Map(after.map(event => [event.id, event]));
    this.newEvents.splice(0, this.newEvents.length, ...this.newEvents.map(event => byId.get(event.id) ?? event));
    this.state.universes = toPlainJson(validated);
  }

  findAll(): Tournament[] {
    return [...this.state.tournaments];
  }

  save(tournament: Tournament): void {
    this.assertStorable(tournament);
    this.write(tournament);
  }

  saveWithActivity(tournament: Tournament, event: ActivityEvent): void {
    this.saveManyWithActivity([tournament], event);
  }

  saveManyWithActivity(tournaments: readonly Tournament[], event: ActivityEvent): void {
    if (tournaments.length === 0) {
      throw new Error("No se guardaron los cambios: no hay torneos para actualizar.");
    }
    if (new Set(tournaments.map(({ id }) => id)).size !== tournaments.length) {
      throw new Error("No se guardaron los cambios: la selección contiene torneos duplicados.");
    }
    tournaments.forEach(tournament => this.assertStorable(tournament));
    this.assertActivityEvent(event);
    tournaments.forEach(tournament => this.write(tournament));
    this.append(event);
  }

  recordActivity(event: ActivityEvent): void {
    this.assertActivityEvent(event);
    this.append(event);
  }

  findActivity(): ActivityEvent[] {
    return [...this.state.activity];
  }

  deleteById(id: string): void {
    const tournament = this.state.tournaments.find(item => item.id === id);
    if (!tournament) throw new Error("No se encontró el campeonato que quieres eliminar.");
    // Igual que localStorage: el evento conserva el universo y la asignación se retira.
    const library = this.getSportsUniverseLibrary();
    const universeId = library.assignments[id];
    const event: ActivityEvent = {
      ...createActivityEvent(tournament, {
        action: "tournament-deleted",
        entityType: "tournament",
        summary: `Se eliminó la competición "${tournament.name}".`,
        before: { archived: tournament.archived ?? false },
      }),
      ...(universeId ? { universeId } : {}),
    };
    if (universeId) {
      const assignments = { ...library.assignments };
      delete assignments[id];
      this.state.universes = { ...library, assignments };
    }
    this.state.tournaments = this.state.tournaments.filter(item => item.id !== id);
    this.touch(id);
    this.append(event);
  }

  getActiveTournamentId(): string | null {
    return this.state.activeTournamentId;
  }

  setActiveTournamentId(id: string | null): void {
    this.state.activeTournamentId = id;
  }

  /**
   * Restaura un respaldo con el mismo plan y los mismos universos que localStorage
   * (sin copia de recuperación: `_skipRecoveryCopy` sólo conserva la firma).
   */
  importTournaments(
    tournaments: readonly Tournament[],
    mode: LibraryRestoreMode,
    activity: readonly ActivityEvent[] = [],
    _skipRecoveryCopy?: boolean,
    restoredUniverses?: SportsUniverseLibrary,
  ): LibraryRestoreResult {
    void _skipRecoveryCopy;
    validateLibraryRestore(tournaments, activity);
    let nextUniverses = emptySportsUniverseLibrary();
    const plan = planLibraryRestore({
      // El torneo activo debe quedar dentro del universo deportivo resultante.
      selectable: (nextTournaments, nextActivity, imported) => {
        nextUniverses = restoredSportsUniverses({
          mode,
          current: this.getSportsUniverseLibrary(),
          restored: restoredUniverses,
          importedTournamentIds: new Set(imported.map(({ id }) => id)),
          tournaments: nextTournaments,
          activity: nextActivity,
        });
        return tournamentsInUniverse(nextTournaments, nextUniverses);
      },
      mode,
      incoming: tournaments,
      incomingActivity: activity,
      existing: this.state.tournaments,
      existingActivity: this.state.activity,
      activeTournamentId: this.state.activeTournamentId,
    });
    if (mode === "replace") {
      this.replaced = true;
      this.state.tournaments = plan.tournaments.map(toPlainJson);
      this.state.activity = plan.activity.map(toPlainJson);
    } else {
      this.state.tournaments = plan.tournaments.map(toPlainJson);
      // El primero restaurado debe quedar como el último guardado (primero en findAll).
      for (const tournament of [...plan.imported].reverse()) this.touch(tournament.id);
      for (const event of plan.activity) this.append(event);
    }
    this.state.activeTournamentId = plan.activeTournamentId;
    this.state.universes = toPlainJson(nextUniverses);
    return { added: plan.added, skipped: plan.skipped };
  }

  /** Cambios de esta instancia respecto del estado inicial. */
  changes(): LibraryChanges {
    const activeTournament = this.state.activeTournamentId !== this.initialActiveId
      ? { activeTournament: { id: this.state.activeTournamentId } }
      : {};
    const universes = this.replaced || JSON.stringify(this.getSportsUniverseLibrary()) !== this.initialUniverses
      ? { universes: this.getSportsUniverseLibrary() }
      : {};
    if (this.replaced) {
      return {
        // findAll devuelve primero lo último guardado: se escriben en orden inverso.
        saved: [...this.state.tournaments].reverse(),
        deleted: [],
        events: [...this.state.activity],
        ...activeTournament,
        ...universes,
        replaceLibrary: true,
        replaceActivity: true,
      };
    }
    const saved: Tournament[] = [];
    const deleted: string[] = [];
    for (const id of this.touched.keys()) {
      const current = this.state.tournaments.find(item => item.id === id);
      if (current) saved.push(current);
      else if (this.initialIds.has(id)) deleted.push(id);
    }
    return {
      saved,
      deleted,
      events: [...this.newEvents],
      ...activeTournament,
      ...universes,
      ...(Object.keys(this.reattributed).length > 0 ? { activityUniverseIds: { ...this.reattributed } } : {}),
    };
  }

  private write(tournament: Tournament): void {
    const stored = toPlainJson(tournament);
    this.state.tournaments = [stored, ...this.state.tournaments.filter(item => item.id !== tournament.id)];
    this.touch(tournament.id);
  }

  private touch(id: string): void {
    this.touched.delete(id);
    this.touched.set(id, true);
  }

  private append(event: ActivityEvent): void {
    if (this.state.activity.some(({ id }) => id === event.id)) return;
    const stored = toPlainJson(event);
    this.state.activity = [...this.state.activity, stored];
    this.newEvents.push(stored);
  }

  private assertStorable(tournament: Tournament): void {
    const issue = storageIssue(tournament);
    if (issue) throw new Error(`No se guardó "${tournament.name || tournament.id}": ${issue}`);
  }

  private assertActivityEvent(event: ActivityEvent): void {
    if (!isActivityEvent(event)) throw new Error("No se pudo guardar un evento de actividad inválido.");
  }
}
