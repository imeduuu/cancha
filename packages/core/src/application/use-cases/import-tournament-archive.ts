import { mergeContinentalPlanHistory } from "../../domain/services/continental-plan";
import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { createActivityEvent, recordRejectedImport, saveWithActivity } from "../services/activity-log";
import { cloneTournamentWithNewIds } from "../services/tournament-archive";

import { secondDivisionKind } from "../../domain/services/second-division-rules";
import { advanceTournamentProgress } from "./advance-tournament-progress";

export type TournamentArchiveDecision = "add" | "copy" | "update" | "cancel";

function findCompetitionSeasonConflict(
  tournament: Tournament,
  savedTournaments: readonly Tournament[],
): Tournament | undefined {
  if (!tournament.competitionId || tournament.season === undefined) return undefined;
  return savedTournaments.find((saved) =>
    saved.id !== tournament.id
    && saved.competitionId === tournament.competitionId
    && saved.season === tournament.season,
  );
}

export function importTournamentArchive(
  tournament: Tournament,
  decision: TournamentArchiveDecision,
  repository: TournamentRepository,
  createId?: () => string,
): Tournament | null {
  if (decision === "cancel") return null;

  try {
    const savedTournaments = repository.findAll();
    const existing = savedTournaments.some(({ id }) => id === tournament.id);
    if (decision === "add" && existing) {
      throw new Error("Ya existe un torneo con ese identificador. Elige crear una copia o actualizarlo.");
    }
    if (decision === "update" && !existing) {
      throw new Error("No se encontró el torneo que se solicitó actualizar.");
    }

    if (decision !== "copy") {
      const conflict = findCompetitionSeasonConflict(tournament, savedTournaments);
      if (conflict) {
        throw new Error(
          `Ya existe "${conflict.name}" (ID: ${conflict.id}) para la competiciÃ³n "${tournament.competitionId}" en la temporada ${tournament.season}. Elige actualizar ese torneo o importar como copia independiente.`,
        );
      }
    }

    const continentalPlans = decision === "update" ? mergeContinentalPlanHistory(savedTournaments.find(t => t.id === tournament.id)?.continentalPlans,tournament.continentalPlans) : tournament.continentalPlans;
    const candidate = decision === "copy"
      ? cloneTournamentWithNewIds(tournament, createId)
      : {...tournament,...(continentalPlans ? {continentalPlans}: {})};
    const imported = secondDivisionKind(candidate) ? advanceTournamentProgress(candidate) : candidate;
    if (decision === "copy" && savedTournaments.some(({ id }) => id === imported.id)) {
      throw new Error("El identificador de la copia ya está en uso. Intenta importar el archivo nuevamente.");
    }
    saveWithActivity(repository, imported, createActivityEvent(imported, {
      action: "tournament-imported",
      entityType: "tournament",
      summary: `Se importó "${imported.name}" desde un archivo de torneo (${decision}).`,
      after: { decision, sourceTournamentId: tournament.id },
    }));
    return imported;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Error desconocido de importación.";
    try {
      recordRejectedImport(repository, reason, tournament);
    } catch (auditError) {
      const auditReason = auditError instanceof Error ? auditError.message : "error de almacenamiento";
      throw new Error(`${reason} Además, no se pudo registrar el rechazo: ${auditReason}`);
    }
    throw error;
  }
}
