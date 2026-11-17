import type { GoalScorer, Tournament } from "../../domain/entities/tournament";
import { validateGoalScorers } from "../../domain/services/goal-scorers";
import { validateTournamentPlayerData } from "../../domain/services/player-roster";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";
import type { TournamentRepository } from "../ports/tournament-repository";

export function updateMatchGoalScorers(
  tournament: Tournament,
  fixtureId: string,
  goalScorers: readonly GoalScorer[],
  repository: TournamentRepository,
): Tournament {
  const targetFixture = tournament.matchdays
    .flatMap(({ fixtures }) => fixtures)
    .find(({ id }) => id === fixtureId);
  if (!targetFixture) {
    throw new Error("No se encontró el partido al que quieres asignar autores de goles.");
  }
  const validationError = validateGoalScorers(goalScorers, targetFixture);
  if (validationError) throw new Error(validationError);
  if (JSON.stringify(targetFixture.goalScorers ?? []) === JSON.stringify(goalScorers)) return tournament;

  const matchdays = tournament.matchdays.map((matchday) => ({
    ...matchday,
    fixtures: matchday.fixtures.map((fixture) => fixture.id === fixtureId
      ? { ...fixture, goalScorers: goalScorers.map((scorer) => ({ ...scorer })) }
      : fixture),
  }));
  const updatedTournament = { ...tournament, matchdays };
  const playerIssue = validateTournamentPlayerData(updatedTournament);
  if (playerIssue) throw new Error(playerIssue);
  saveWithActivity(repository, updatedTournament, createActivityEvent(tournament, {
    action: "match-goal-scorers-updated",
    entityId: fixtureId,
    entityType: "match",
    summary: `Se actualizaron los autores de goles del partido ${fixtureId}.`,
    before: targetFixture.goalScorers ?? [],
    after: goalScorers,
  }));
  return updatedTournament;
}
