import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";

export function updateTournamentRegulations(
  previous: Tournament,
  updated: Tournament,
  repository: TournamentRepository,
): Tournament {
  const before = {
    matchRegulations: previous.matchRegulations ?? null,
    competitionRules: previous.competitionRules ?? null,
    lineupRules: previous.lineupRules ?? null,
  };
  const after = {
    matchRegulations: updated.matchRegulations ?? null,
    competitionRules: updated.competitionRules ?? null,
    lineupRules: updated.lineupRules ?? null,
  };
  if (JSON.stringify(before) === JSON.stringify(after)) return previous;
  saveWithActivity(repository, updated, createActivityEvent(previous, {
    action: "regulations-updated",
    entityType: "tournament",
    summary: `Se actualizó el reglamento de "${previous.name}".`,
    before,
    after,
  }));
  return updated;
}

export function updateTournamentRoster(
  previous: Tournament,
  updated: Tournament,
  repository: TournamentRepository,
): Tournament {
  const before = {
    players: previous.players ?? [],
    registrations: previous.playerRegistrations ?? [],
  };
  const after = {
    players: updated.players ?? [],
    registrations: updated.playerRegistrations ?? [],
  };
  if (JSON.stringify(before) === JSON.stringify(after)) return previous;
  saveWithActivity(repository, updated, createActivityEvent(previous, {
    action: "roster-updated",
    entityType: "tournament",
    summary: `Se actualizó la plantilla de "${previous.name}".`,
    before,
    after,
  }));
  return updated;
}
