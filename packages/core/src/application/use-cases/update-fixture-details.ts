import type { Fixture, GoalScorer, Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { validateFixtureDetails, type FixtureDetailsUpdate } from "../../domain/services/match-details";
import { validateTournamentPlayerData } from "../../domain/services/player-roster";
import { validateGoalScorers } from "../../domain/services/goal-scorers";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";

import { advanceTournamentProgress } from "./advance-tournament-progress";

export function updateFixtureDetails(
  tournament: Tournament,
  fixtureId: string,
  update: FixtureDetailsUpdate,
  repository: TournamentRepository,
): Tournament {
  const target = tournament.matchdays.flatMap(({ fixtures }) => fixtures)
    .find(({ id }) => id === fixtureId);
  if (!target) throw new Error("No se encontró el partido que quieres actualizar.");
  const updatedFixture: Fixture = {
    ...target,
    ...(update.lineups !== undefined ? { lineups: update.lineups } : {}),
    ...(update.substitutions !== undefined ? { substitutions: update.substitutions } : {}),
    ...(update.events !== undefined ? { events: update.events } : {}),
    ...(update.events !== undefined
      ? { eventsCoverage: update.eventsCoverage ?? "unverified" as const }
      : update.eventsCoverage !== undefined ? { eventsCoverage: update.eventsCoverage } : {}),
  };
  let goalScorers = target.goalScorers;
  if (update.events !== undefined) {
    const eventScorers: GoalScorer[] = update.events
      .filter((event) => event.type === "goal" || event.type === "own-goal")
      .map((event) => ({
        teamId: event.teamId,
        playerName: event.playerName,
        ...(event.playerId ? { playerId: event.playerId } : {}),
        ...(event.minute !== undefined ? { minute: event.minute } : {}),
        ...(event.type === "own-goal" ? { type: "own-goal" as const } : { type: "regular" as const }),
        eventId: event.id,
      }));
    goalScorers = [
      ...(target.goalScorers ?? []).filter((scorer) => !scorer.eventId),
      ...eventScorers,
    ];
  }
  const fixtureWithScorers = {
    ...updatedFixture,
    ...(goalScorers !== undefined ? { goalScorers } : {}),
  };
  const before = {
    ...(update.lineups !== undefined ? { lineups: target.lineups ?? null } : {}),
    ...(update.substitutions !== undefined ? { substitutions: target.substitutions ?? null } : {}),
    ...(update.events !== undefined ? { events: target.events ?? null } : {}),
    ...(update.events !== undefined || update.eventsCoverage !== undefined
      ? { eventsCoverage: target.eventsCoverage ?? "unverified" } : {}),
    ...(update.events !== undefined ? { goalScorers: target.goalScorers ?? null } : {}),
  };
  const after = {
    ...(update.lineups !== undefined ? { lineups: update.lineups } : {}),
    ...(update.substitutions !== undefined ? { substitutions: update.substitutions } : {}),
    ...(update.events !== undefined ? { events: update.events } : {}),
    ...(update.events !== undefined || update.eventsCoverage !== undefined
      ? { eventsCoverage: fixtureWithScorers.eventsCoverage ?? "unverified" } : {}),
    ...(update.events !== undefined ? { goalScorers: fixtureWithScorers.goalScorers ?? null } : {}),
  };
  if (JSON.stringify(before) === JSON.stringify(after)) return tournament;
  const issue = validateFixtureDetails(tournament, fixtureWithScorers);
  if (issue) throw new Error(issue);
  const scorerIssue = validateGoalScorers(fixtureWithScorers.goalScorers ?? [], fixtureWithScorers);
  if (scorerIssue) throw new Error(scorerIssue);
  const matchdays = tournament.matchdays.map((matchday) => ({
    ...matchday,
    fixtures: matchday.fixtures.map((fixture) =>
      fixture.id === fixtureId ? fixtureWithScorers : fixture),
  }));
  const updatedTournament = advanceTournamentProgress({ ...tournament, matchdays });
  const playerIssue = validateTournamentPlayerData(updatedTournament);
  if (playerIssue) throw new Error(playerIssue);
  saveWithActivity(repository, updatedTournament, createActivityEvent(tournament, {
    action: "match-details-updated",
    entityId: fixtureId,
    entityType: "match",
    summary: `Se actualizaron detalles del partido ${fixtureId}.`,
    before,
    after,
  }));
  return updatedTournament;
}
