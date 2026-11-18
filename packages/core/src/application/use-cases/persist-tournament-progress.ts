import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";
import { advanceTournamentProgress } from "./advance-tournament-progress";

/**
 * Avanza la progresión reglamentaria (copas, playoffs, ascensos, continentales)
 * después de un cambio deportivo y la guarda si cambió algo. Si el avance
 * invalida resoluciones oficiales, lo registra en el historial.
 */
export function persistTournamentProgress(
  tournament: Tournament,
  repository: TournamentRepository,
): Tournament {
  const advancedTournament = advanceTournamentProgress(tournament, repository);
  if (advancedTournament !== tournament) {
    const invalidated = advancedTournament.officialResolutions?.filter(item => item.invalidation
      && !tournament.officialResolutions?.find(old => old.id === item.id)?.invalidation);
    if (invalidated?.length) saveWithActivity(repository, advancedTournament, createActivityEvent(tournament, {
      action: "official-resolution-invalidated", entityType: "tournament",
      summary: "Se revisaron las dependencias oficiales y se invalidaron resoluciones que ya no corresponden.",
      before: tournament.officialResolutions, after: advancedTournament.officialResolutions,
    }));
    else repository.save(advancedTournament);
  }
  return advancedTournament;
}
