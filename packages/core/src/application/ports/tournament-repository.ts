import type { Tournament } from "../../domain/entities/tournament";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { SportsUniverseLibrary } from "../../domain/entities/sports-universe";

export interface TournamentRepository {
  save(tournament: Tournament): void;
  findAll(): Tournament[];
  saveWithActivity?(tournament: Tournament, event: ActivityEvent): void;
  saveManyWithActivity?(tournaments: readonly Tournament[], event: ActivityEvent): void;
  recordActivity?(event: ActivityEvent): void;
  findActivity?(): ActivityEvent[];
}

export interface TournamentLibraryRepository extends TournamentRepository {
  deleteById(id: string): void;
  getActiveTournamentId(): string | null;
  setActiveTournamentId(id: string | null): void;
  /**
   * Restaura un respaldo (ver application/services/library-restore.ts): todo o
   * nada, registra library-restored y ajusta el torneo activo.
   */
  importTournaments?(
    tournaments: readonly Tournament[],
    mode: "merge" | "replace",
    activity?: readonly ActivityEvent[],
    /** Sólo localStorage: no guardar la copia de recuperación antes de reemplazar. */
    skipRecoveryCopy?: boolean,
    /** Universos del respaldo: reemplazar los toma; agregar los fusiona con los actuales. */
    universes?: SportsUniverseLibrary,
  ): { added: number; skipped: number };
  readRawTournamentDataForRecovery?(): string;
  getRecoverySnapshotStatus?(): { available: boolean; warning?: string };
}
