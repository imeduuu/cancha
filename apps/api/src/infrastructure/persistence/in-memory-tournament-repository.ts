import { isActivityEvent, type ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import type { TournamentLibraryRepository } from "@cancha/core/application/ports/tournament-repository";
import { createActivityEvent } from "@cancha/core/application/services/activity-log";
import { getTournamentStorageIssue } from "@cancha/core/application/validation/tournament-storage";

/** Estado de una biblioteca en memoria. Varias instancias pueden compartirlo (p. ej. `reopen` del contrato). */
export interface InMemoryLibraryState {
  /** Lo último guardado primero, igual que localStorage y Mongo. */
  tournaments: Tournament[];
  /** En orden de registro. */
  activity: ActivityEvent[];
  activeTournamentId: string | null;
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
}

export function hasLibraryChanges(changes: LibraryChanges): boolean {
  return changes.saved.length > 0
    || changes.deleted.length > 0
    || changes.events.length > 0
    || changes.activeTournament !== undefined
    || changes.replaceLibrary === true
    || changes.replaceActivity === true;
}

export function emptyInMemoryLibrary(): InMemoryLibraryState {
  return { tournaments: [], activity: [], activeTournamentId: null };
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
 */
export class InMemoryTournamentRepository implements TournamentLibraryRepository {
  private readonly initialIds: ReadonlySet<string>;
  private readonly initialActiveId: string | null;
  /** id → orden del último guardado/eliminación en esta instancia. */
  private readonly touched = new Map<string, true>();
  private readonly newEvents: ActivityEvent[] = [];

  constructor(private readonly state: InMemoryLibraryState = emptyInMemoryLibrary()) {
    this.initialIds = new Set(state.tournaments.map(({ id }) => id));
    this.initialActiveId = state.activeTournamentId;
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
    const event = createActivityEvent(tournament, {
      action: "tournament-deleted",
      entityType: "tournament",
      summary: `Se eliminó la competición "${tournament.name}".`,
      before: { archived: tournament.archived ?? false },
    });
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

  /** Cambios de esta instancia respecto del estado inicial. */
  changes(): LibraryChanges {
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
      ...(this.state.activeTournamentId !== this.initialActiveId
        ? { activeTournament: { id: this.state.activeTournamentId } }
        : {}),
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
