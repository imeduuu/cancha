import { DomainError } from "../../domain/domain-error.js";
import type { TournamentLibraryRepository } from "../ports/tournament-repository";
import { recordRejectedImport } from "../services/activity-log";
import type { LibraryRestoreMode, LibraryRestoreResult } from "../services/library-restore";
import { parseTournamentBackupWithActivity } from "../services/tournament-archive";

/**
 * Restaura un respaldo `cancha-backup` (JSON v7 o anterior) agregando o
 * reemplazando la biblioteca, sin importación parcial. Un archivo que no se
 * puede leer se rechaza sin escribir; si la restauración falla, se registra el
 * rechazo en el historial (como en la web) y se relanza el error.
 * Los universos deportivos del respaldo se restauran con la misma regla que la
 * web (`restoredSportsUniverses`), si el repositorio los admite.
 */
export function restoreTournamentBackup(
  text: string,
  mode: LibraryRestoreMode,
  repository: TournamentLibraryRepository,
): LibraryRestoreResult {
  if (mode !== "merge" && mode !== "replace") throw new DomainError("Elige si el respaldo se agrega o reemplaza la biblioteca.");
  const backup = parseTournamentBackupWithActivity(text);
  if (!repository.importTournaments) {
    throw new DomainError("No se restauró el respaldo: este almacenamiento no permite restaurar respaldos.");
  }
  try {
    return repository.importTournaments(backup.tournaments, mode, backup.activity, false, backup.universes);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Error desconocido al restaurar el respaldo.";
    recordRejectedImport(repository, reason, backup.tournaments[0]);
    throw error;
  }
}
