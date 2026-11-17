import { hasUnverifiedCompetitionRules } from "./competition-rules";
import { hasPendingAnnualRules } from "./season-preparation";
import type { Fixture, PointsSystem, Tournament, TournamentPlacementRules } from "../entities/tournament";
import type { TeamStanding } from "./standings";
import { isValidFixtureResult } from "./match-result-validation";

export type PlacementClassification =
  | "champion"
  | "playoff"
  | "relegation-playoff"
  | "relegation"
  | "libertadores"
  | "libertadores-qualifying"
  | "sudamericana";

export type PlayoffPlacementStatus = "confirmed" | "provisional";

export function isValidRelegationPlaces(value: unknown, teamCount?: number): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && (teamCount === undefined || value <= teamCount);
}

export function getPlayoffPlacementStatuses(
  standings: readonly TeamStanding[],
  fixtures: readonly Fixture[],
  rules: TournamentPlacementRules,
  tournament: Tournament,
  pointsSystem: PointsSystem = { win: 3, draw: 1, loss: 0 },
): ReadonlyMap<string, PlayoffPlacementStatus> {
  const statuses = new Map<string, PlayoffPlacementStatus>();
  if (hasPendingAnnualRules(tournament) || hasUnverifiedCompetitionRules(tournament)) {
    for (const row of standings) statuses.set(row.teamId, "provisional");
    return statuses;
  }
  if (!rules.playoffPlaces && !rules.relegationPlayoffPlaces) return statuses;

  const remainingByTeam = new Map(standings.map(({ teamId }) => [teamId, 0]));
  for (const fixture of fixtures) {
    const matchday = tournament.matchdays.find(({ fixtures: matchdayFixtures }) =>
      matchdayFixtures.some(({ id }) => id === fixture.id),
    );
    if (matchday && isValidFixtureResult(tournament, matchday, fixture)) continue;
    for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
      if (remainingByTeam.has(teamId)) {
        remainingByTeam.set(teamId, (remainingByTeam.get(teamId) ?? 0) + 1);
      }
    }
  }

  standings.forEach((standing, index) => {
    const position = index + 1;
    const classification = classifyPosition(position, standings.length, rules);
    const range = classification === "playoff"
      ? rules.playoffPlaces
      : classification === "relegation-playoff"
        ? rules.relegationPlayoffPlaces
        : undefined;
    if (!range) return;

    const remaining = remainingByTeam.get(standing.teamId) ?? 0;
    const maximumPoints = standing.points + Math.max(
      pointsSystem.win,
      pointsSystem.draw,
      pointsSystem.loss,
    ) * remaining;
    const minimumPoints = standing.points + Math.min(
      pointsSystem.win,
      pointsSystem.draw,
      pointsSystem.loss,
    ) * remaining;
    const bestPossiblePosition = 1 + standings.filter((opponent) =>
      opponent.teamId !== standing.teamId
      && opponent.points + Math.max(
        pointsSystem.win,
        pointsSystem.draw,
        pointsSystem.loss,
      ) * (remainingByTeam.get(opponent.teamId) ?? 0) >= maximumPoints,
    ).length;
    const worstPossiblePosition = 1 + standings.filter((opponent) =>
      opponent.teamId !== standing.teamId
      && opponent.points + Math.max(
        pointsSystem.win,
        pointsSystem.draw,
        pointsSystem.loss,
      ) * (remainingByTeam.get(opponent.teamId) ?? 0) >= minimumPoints,
    ).length;
    statuses.set(
      standing.teamId,
      bestPossiblePosition >= range.from && worstPossiblePosition <= range.to
        ? "confirmed"
        : "provisional",
    );
  });
  return statuses;
}

export function classifyPosition(
  position: number,
  teamCount: number,
  rules: TournamentPlacementRules,
): PlacementClassification | undefined {
  if (rules.relegationPlaces !== undefined
    && !isValidRelegationPlaces(rules.relegationPlaces, teamCount)) return undefined;

  if (rules.championPlaces !== undefined && position <= rules.championPlaces) {
    return "champion";
  }

  if (
    rules.relegationPlaces !== undefined
    && rules.relegationPlaces > 0
    && position > teamCount - rules.relegationPlaces
  ) {
    return "relegation";
  }

  if (
    rules.playoffPlaces
    && position >= rules.playoffPlaces.from
    && position <= rules.playoffPlaces.to
  ) {
    return "playoff";
  }

  if (
    rules.libertadoresPlaces
    && position >= rules.libertadoresPlaces.from
    && position <= rules.libertadoresPlaces.to
  ) {
    return "libertadores";
  }

  if (
    rules.libertadoresQualifyingPlaces
    && position >= rules.libertadoresQualifyingPlaces.from
    && position <= rules.libertadoresQualifyingPlaces.to
  ) {
    return "libertadores-qualifying";
  }

  if (
    rules.sudamericanaPlaces
    && position >= rules.sudamericanaPlaces.from
    && position <= rules.sudamericanaPlaces.to
  ) {
    return "sudamericana";
  }

  if (
    rules.relegationPlayoffPlaces
    && position >= rules.relegationPlayoffPlaces.from
    && position <= rules.relegationPlayoffPlaces.to
  ) {
    return "relegation-playoff";
  }

  return undefined;
}
