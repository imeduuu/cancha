import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";

export function setTournamentArchived(
  tournament: Tournament,
  archived: boolean,
  repository: TournamentRepository,
): Tournament {
  const updated = { ...tournament, archived };
  if ((tournament.archived ?? false) === archived) return tournament;
  saveWithActivity(repository, updated, createActivityEvent(tournament, {
    action: archived ? "tournament-archived" : "tournament-restored",
    entityType: "tournament",
    summary: `${archived ? "Se archivó" : "Se restauró"} "${tournament.name}".`,
    before: { archived: tournament.archived ?? false },
    after: { archived },
  }));
  return updated;
}
