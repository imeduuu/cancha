import type { Tournament } from "../../domain/entities/tournament";
import type { ActivityEvent } from "../../domain/entities/activity-event";

/**
 * Versión asíncrona de TournamentRepository para adaptadores de servidor (MongoDB).
 * Mismos métodos y semántica que el puerto síncrono, pero las escrituras con
 * historial son obligatorias: un servidor siempre debe garantizar que el torneo
 * y su ActivityEvent se guardan juntos o no se guarda nada.
 *
 * Los casos de uso siguen usando el puerto síncrono; ver "Pendiente: fase 3"
 * en CLAUDE.md para cómo se conectarán.
 */
export interface AsyncTournamentRepository {
  save(tournament: Tournament): Promise<void>;
  findAll(): Promise<Tournament[]>;
  saveWithActivity(tournament: Tournament, event: ActivityEvent): Promise<void>;
  saveManyWithActivity(tournaments: readonly Tournament[], event: ActivityEvent): Promise<void>;
  recordActivity(event: ActivityEvent): Promise<void>;
  findActivity(): Promise<ActivityEvent[]>;
}

export interface AsyncTournamentLibraryRepository extends AsyncTournamentRepository {
  deleteById(id: string): Promise<void>;
  getActiveTournamentId(): Promise<string | null>;
  setActiveTournamentId(id: string | null): Promise<void>;
}
