import type { Tournament } from "../../domain/entities/tournament";
import type { ActivityEvent } from "../../domain/entities/activity-event";

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
  readRawTournamentDataForRecovery?(): string;
  getRecoverySnapshotStatus?(): { available: boolean; warning?: string };
}
