import type { PointsSystem, Tournament } from "../entities/tournament";
import { secondDivisionKind } from "./second-division-rules";
import type { TieBreaker } from "../value-objects/tie-breaker";
import { isValidFixtureResult } from "./match-result-validation";

import { makeResolutionContext, verifiedDrawOrder, multipleRelegationContext } from "./official-resolution-core";
import { programmeOrder } from "./official-programme";
import type { OfficialResolutionContext } from "../entities/official-resolution";

export interface TeamStanding {
  readonly teamId: string;
  readonly teamName: string;
  readonly played: number;
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly goalDifference: number;
  readonly points: number;
}

export interface UnresolvedStandingsTieDetail {
  readonly teams: readonly TeamStanding[];
  readonly criterion: TieBreaker | "configured-criteria";
  readonly reason: string;
  readonly fixtureIds?: readonly string[];
}

type MutableTeamStanding = {
  -readonly [Key in keyof TeamStanding]: TeamStanding[Key];
};

interface HeadToHeadStats {
  points: number;
  goalsFor: number;
  goalsAgainst: number;
}

const defaultPointsSystem: PointsSystem = { win: 3, draw: 1, loss: 0 };

function compareNumberDescending(first: number, second: number): number {
  return second - first;
}

export function calculateStandings(
  tournament: Tournament,
  resultValidationMatchdays: readonly Tournament["matchdays"][number][] = tournament.matchdays,
): TeamStanding[] {
  const pointsSystem = tournament.pointsSystem
    ?? tournament.competitionRules?.points
    ?? defaultPointsSystem;
  const standings = tournament.teams.map((team): MutableTeamStanding => ({
    teamId: team.id,
    teamName: team.name,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
  }));
  const standingsById = new Map(standings.map((standing) => [standing.teamId, standing]));

  for (const matchday of tournament.matchdays) {
    for (const fixture of matchday.fixtures) {
      const result = fixture.result;
      if (!result || !isValidFixtureResult(tournament, matchday, fixture, resultValidationMatchdays)) {
        continue;
      }

      const home = standingsById.get(fixture.homeTeamId);
      const away = standingsById.get(fixture.awayTeamId);
      if (!home && !away) {
        continue;
      }

      const homeGoals = result.homeGoals;
      const awayGoals = result.awayGoals;
      if (home) {
        home.played += 1;
        home.goalsFor += homeGoals;
        home.goalsAgainst += awayGoals;
      }
      if (away) {
        away.played += 1;
        away.goalsFor += awayGoals;
        away.goalsAgainst += homeGoals;
      }

      if (homeGoals > awayGoals) {
        if (home) {
          home.wins += 1;
          home.points += pointsSystem.win;
        }
        if (away) {
          away.losses += 1;
          away.points += pointsSystem.loss;
        }
      } else if (homeGoals < awayGoals) {
        if (away) {
          away.wins += 1;
          away.points += pointsSystem.win;
        }
        if (home) {
          home.losses += 1;
          home.points += pointsSystem.loss;
        }
      } else {
        if (home) {
          home.draws += 1;
          home.points += pointsSystem.draw;
        }
        if (away) {
          away.draws += 1;
          away.points += pointsSystem.draw;
        }
      }
    }
  }

  for (const standing of standings) {
    standing.goalDifference = standing.goalsFor - standing.goalsAgainst;
  }

  const pointsGroups = new Map<number, TeamStanding[]>();
  for (const standing of standings) {
    const group = pointsGroups.get(standing.points) ?? [];
    group.push(standing);
    pointsGroups.set(standing.points, group);
  }

  const sortedStandings: TeamStanding[] = [];
  for (const points of [...pointsGroups.keys()].sort((first, second) => second - first)) {
    const group = pointsGroups.get(points);
    if (!group) {
      continue;
    }

    sortedStandings.push(...sortByTieBreakers(
      group,
      getEffectiveTieBreakers(tournament),
      0,
      tournament,
      resultValidationMatchdays,
        pointsSystem,
      ));
  }

  const context = multipleRelegationContext(tournament, sortedStandings);
  const order = context ? programmeOrder(tournament, context) : undefined;
  const relegationStart = context ? sortedStandings.findIndex(row => context.participantIds.includes(row.teamId)) : -1;
  // A relegation-only decision must never resolve the independent top-eight qualification criteria.
  if (context && order && relegationStart >= 8) {
    const start = relegationStart;
    sortedStandings.splice(start, order.length, ...order.map(id => sortedStandings.find(row => row.teamId === id)!));
  }
  return sortedStandings;
}

export function hasUniqueStandingsLeader(
  tournament: Tournament,
  standings: readonly TeamStanding[],
  resultValidationMatchdays: readonly Tournament["matchdays"][number][] = tournament.matchdays,
): boolean {
  if (standings.length < 2) return false;
  if (usesBrazilian2026TieBreakers(tournament)) return !getUnresolvedStandingsTieGroups(
    tournament, standings, resultValidationMatchdays,
  ).some(group => group.some(row => row.teamId === standings[0].teamId));
  const [leader, runnerUp] = standings;
  if (leader.points !== runnerUp.points) return true;

  const tieBreakers = getEffectiveTieBreakers(tournament);
  const pointsSystem = tournament.pointsSystem
    ?? tournament.competitionRules?.points
    ?? defaultPointsSystem;
  const headToHeadByTeam = tieBreakers.some(isHeadToHeadTieBreaker)
    ? buildHeadToHeadStats([leader, runnerUp], tournament, resultValidationMatchdays, pointsSystem)
    : undefined;
  for (const tieBreaker of tieBreakers) {
    const prepared = prepareTieBreakerValues(
      [leader, runnerUp], tieBreaker, tournament, resultValidationMatchdays,
    );
    if (prepared.issue) return false;
    if (compareByTieBreaker(leader, runnerUp, tieBreaker, headToHeadByTeam, prepared.values) !== 0) {
      return true;
    }
  }
  return false;
}

/** Returns teams still tied after the configured sporting tie-breakers (ignoring display order). */
export function getUnresolvedStandingsTieGroups(
  tournament: Tournament,
  standings: readonly TeamStanding[],
  resultValidationMatchdays: readonly Tournament["matchdays"][number][] = tournament.matchdays,
): TeamStanding[][] {
  const tieBreakers = getEffectiveTieBreakers(tournament);
  const pointsGroups = new Map<number, TeamStanding[]>();
  for (const standing of standings) {
    const group = pointsGroups.get(standing.points) ?? [];
    group.push(standing);
    pointsGroups.set(standing.points, group);
  }
  const unresolved: TeamStanding[][] = [];
  for (const group of pointsGroups.values()) {
    if (group.length < 2) continue;
    sortByTieBreakers(
      group,
      tieBreakers,
      0,
      tournament,
      resultValidationMatchdays,
      tournament.pointsSystem ?? tournament.competitionRules?.points ?? defaultPointsSystem,
      unresolved,
    );
  }
  const context = multipleRelegationContext(tournament, standings);
  return context && standings.findIndex(row => context.participantIds.includes(row.teamId)) >= 8 && programmeOrder(tournament, context)
    ? unresolved.filter(group => !group.every(row => context.participantIds.includes(row.teamId))) : unresolved;
}

/** Includes why a displayed order is provisional when information required by a tie-break is missing. */
export function getUnresolvedStandingsTieDetails(
  tournament: Tournament,
  standings: readonly TeamStanding[],
  resultValidationMatchdays: readonly Tournament["matchdays"][number][] = tournament.matchdays,
): UnresolvedStandingsTieDetail[] {
  const tieBreakers = getEffectiveTieBreakers(tournament);
  const pointsGroups = new Map<number, TeamStanding[]>();
  for (const standing of standings) {
    const group = pointsGroups.get(standing.points) ?? [];
    group.push(standing);
    pointsGroups.set(standing.points, group);
  }
  const details: UnresolvedStandingsTieDetail[] = [];
  for (const group of pointsGroups.values()) {
    if (group.length < 2) continue;
    sortByTieBreakers(
      group,
      tieBreakers,
      0,
      tournament,
      resultValidationMatchdays,
      tournament.pointsSystem ?? tournament.competitionRules?.points ?? defaultPointsSystem,
      undefined,
      details,
    );
  }
  const context = multipleRelegationContext(tournament, standings);
  return context && standings.findIndex(row => context.participantIds.includes(row.teamId)) >= 8 && programmeOrder(tournament, context)
    ? details.filter(detail => !detail.teams.every(row => context.participantIds.includes(row.teamId))) : details;
}

export function calculateStandingsWithResolution(
  tournament: Tournament,
  resultValidationMatchdays: readonly Tournament["matchdays"][number][] = tournament.matchdays,
): { readonly standings: TeamStanding[]; readonly unresolvedTies: UnresolvedStandingsTieDetail[] } {
  const standings = calculateStandings(tournament, resultValidationMatchdays);
  return {
    standings,
    unresolvedTies: getUnresolvedStandingsTieDetails(tournament, standings, resultValidationMatchdays),
  };
}

function isCopaLiga2026(tournament: Tournament): boolean {
  return tournament.id === "anfp-copa-de-la-liga-2026" && tournament.season === 2026;
}

function usesBrazilian2026TieBreakers(tournament: Tournament): boolean {
  return secondDivisionKind(tournament) === "brasil" || (tournament.season === 2026
    && (tournament.competitionId ?? tournament.id.replace(/-2026$/, "")) === "brasileirao-serie-a");
}

function getEffectiveTieBreakers(tournament: Tournament): readonly TieBreaker[] {
  const configured = tournament.competitionRules?.tieBreakers ?? tournament.tieBreakers;
  if (isCopaLiga2026(tournament) || usesBrazilian2026TieBreakers(tournament)) return configured;
  return configured.filter((tieBreaker) => tieBreaker !== "awayGoals"
    && tieBreaker !== "redCards"
    && tieBreaker !== "yellowCards"
    && tieBreaker !== "competitionNumber");
}

interface TieBreakerIssue {
  readonly reason: string;
  readonly fixtureIds: readonly string[];
}

interface PreparedTieBreakerValues {
  readonly values: ReadonlyMap<string, number>;
  readonly issue?: TieBreakerIssue;
}

function prepareTieBreakerValues(
  group: readonly TeamStanding[],
  tieBreaker: TieBreaker,
  tournament: Tournament,
  resultValidationMatchdays: readonly Tournament["matchdays"][number][],
): PreparedTieBreakerValues {
  const teamIds = new Set(group.map(({ teamId }) => teamId));
  const values = new Map<string, number>([...teamIds].map((teamId) => [teamId, 0]));

  if (tieBreaker === "competitionNumber") {
    const numbers = tournament.teams.map((team) => team.competitionNumber);
    if (numbers.some((number) => !Number.isSafeInteger(number) || (number ?? 0) < 1)
      || new Set(numbers).size !== numbers.length) {
      return {
        values,
        issue: {
          reason: "No se puede aplicar la numeración oficial: faltan números válidos o hay números repetidos.",
          fixtureIds: [],
        },
      };
    }
    const byTeam = new Map(tournament.teams.map((team) => [team.id, team.competitionNumber as number]));
    return { values: new Map([...teamIds].map((teamId) => [teamId, byTeam.get(teamId) ?? 0])) };
  }

  if (tieBreaker !== "awayGoals" && tieBreaker !== "redCards" && tieBreaker !== "yellowCards") {
    return { values };
  }

  const incompleteCoverage: string[] = [];
  for (const matchday of tournament.matchdays) {
    for (const fixture of matchday.fixtures) {
      if (!isValidFixtureResult(tournament, matchday, fixture, resultValidationMatchdays)) continue;
      const homeIsTied = teamIds.has(fixture.homeTeamId);
      const awayIsTied = teamIds.has(fixture.awayTeamId);
      if (!homeIsTied && !awayIsTied) continue;
      const result = fixture.result;
      if (!result) continue;
      if (tieBreaker === "awayGoals") {
        if (awayIsTied) values.set(fixture.awayTeamId, (values.get(fixture.awayTeamId) ?? 0) + result.awayGoals);
        continue;
      }
      if (fixture.eventsCoverage !== "complete") {
        incompleteCoverage.push(fixture.id);
        continue;
      }
      const expectedEventType = tieBreaker === "redCards" ? "red-card" : "yellow-card";
      for (const event of fixture.events ?? []) {
        if (event.type !== expectedEventType || !teamIds.has(event.teamId)) continue;
        values.set(event.teamId, (values.get(event.teamId) ?? 0) + 1);
      }
    }
  }
  if (incompleteCoverage.length > 0) {
    const cardLabel = tieBreaker === "redCards" ? "tarjetas rojas" : "tarjetas amarillas";
    return {
      values,
      issue: {
        reason: `No se puede desempatar por ${cardLabel}: falta verificar la cobertura de eventos de los partidos ${incompleteCoverage.join(", ")}.`,
        fixtureIds: incompleteCoverage,
      },
    };
  }
  return { values };
}

function buildHeadToHeadStats(
  tiedTeams: readonly TeamStanding[],
  tournament: Tournament,
  resultValidationMatchdays: readonly Tournament["matchdays"][number][],
  pointsSystem: PointsSystem,
): Map<string, HeadToHeadStats> {
  const tiedTeamIds = new Set(tiedTeams.map((team) => team.teamId));
  const stats = new Map(
    tiedTeams.map((team) => [team.teamId, { points: 0, goalsFor: 0, goalsAgainst: 0 }]),
  );

  for (const matchday of tournament.matchdays) {
    for (const fixture of matchday.fixtures) {
      const result = fixture.result;
      if (
        !result
        || !isValidFixtureResult(tournament, matchday, fixture, resultValidationMatchdays)
        || !tiedTeamIds.has(fixture.homeTeamId)
        || !tiedTeamIds.has(fixture.awayTeamId)
      ) {
        continue;
      }

      const home = stats.get(fixture.homeTeamId);
      const away = stats.get(fixture.awayTeamId);
      if (home) {
        home.goalsFor += result.homeGoals;
        home.goalsAgainst += result.awayGoals;
      }
      if (away) {
        away.goalsFor += result.awayGoals;
        away.goalsAgainst += result.homeGoals;
      }

      if (result.homeGoals > result.awayGoals) {
        if (home) home.points += pointsSystem.win;
        if (away) away.points += pointsSystem.loss;
      } else if (result.homeGoals < result.awayGoals) {
        if (away) away.points += pointsSystem.win;
        if (home) home.points += pointsSystem.loss;
      } else {
        if (home) home.points += pointsSystem.draw;
        if (away) away.points += pointsSystem.draw;
      }
    }
  }

  return stats;
}

function sortByTieBreakers(
  group: readonly TeamStanding[],
  tieBreakers: readonly TieBreaker[],
  index: number,
  tournament: Tournament,
  resultValidationMatchdays: readonly Tournament["matchdays"][number][],
  pointsSystem: PointsSystem,
  unresolvedTieGroups?: TeamStanding[][],
  unresolvedTieDetails?: UnresolvedStandingsTieDetail[],
): TeamStanding[] {
  if (group.length < 2) return [...group];
  if (index >= tieBreakers.length) {
    if (secondDivisionKind(tournament) === "brasil" && canUseBrazilianDraw(tournament)) {
      const context = brazilianDrawContext(tournament, group);
      const order = verifiedDrawOrder(tournament, context);
      if (order) return [...group].sort((a, b) => order.indexOf(a.teamId) - order.indexOf(b.teamId));
    }
    if (group.length > 1) {
      unresolvedTieGroups?.push([...group]);
      unresolvedTieDetails?.push({
        teams: [...group],
        criterion: "configured-criteria",
        reason: "Los criterios deportivos configurados no separan a estos equipos.",
      });
    }
    return [...group].sort((first, second) =>
      first.teamName.localeCompare(second.teamName, "es", { sensitivity: "base" }),
    );
  }

  const tieBreaker = tieBreakers[index];
  const prepared = prepareTieBreakerValues(
    group,
    tieBreaker,
    tournament,
    resultValidationMatchdays,
  );
  if (prepared.issue) {
    unresolvedTieGroups?.push([...group]);
    unresolvedTieDetails?.push({
      teams: [...group],
      criterion: tieBreaker,
      reason: prepared.issue.reason,
      ...(prepared.issue.fixtureIds.length > 0
        ? { fixtureIds: prepared.issue.fixtureIds }
        : {}),
    });
    return [...group].sort((first, second) =>
      first.teamName.localeCompare(second.teamName, "es", { sensitivity: "base" }),
    );
  }
  const skipBrazilDirect = usesBrazilian2026TieBreakers(tournament) && group.length > 2
    && tieBreaker === "headToHeadGoalDifference";
  const headToHeadByTeam = isHeadToHeadTieBreaker(tieBreaker)
    ? buildHeadToHeadStats(group, tournament, resultValidationMatchdays, pointsSystem)
    : undefined;
  const compare = (first: TeamStanding, second: TeamStanding): number =>
    skipBrazilDirect ? 0 : compareByTieBreaker(first, second, tieBreaker, headToHeadByTeam, prepared.values);
  const sorted = [...group].sort(compare);
  const result: TeamStanding[] = [];
  let tiedStart = 0;

  while (tiedStart < sorted.length) {
    let tiedEnd = tiedStart + 1;
    while (tiedEnd < sorted.length && compare(sorted[tiedStart], sorted[tiedEnd]) === 0) {
      tiedEnd += 1;
    }
    result.push(...sortByTieBreakers(
      sorted.slice(tiedStart, tiedEnd),
      tieBreakers,
      index + 1,
      tournament,
      resultValidationMatchdays,
      pointsSystem,
      unresolvedTieGroups,
      unresolvedTieDetails,
    ));
    tiedStart = tiedEnd;
  }
  return result;
}

function isHeadToHeadTieBreaker(tieBreaker: TieBreaker): boolean {
  return tieBreaker === "headToHead"
    || tieBreaker === "headToHeadPoints"
    || tieBreaker === "headToHeadGoalDifference"
    || tieBreaker === "headToHeadGoalsFor";
}

function compareByTieBreaker(
  first: TeamStanding,
  second: TeamStanding,
  tieBreaker: TieBreaker,
  headToHeadByTeam: ReadonlyMap<string, HeadToHeadStats> | undefined,
  values?: ReadonlyMap<string, number>,
): number {
  switch (tieBreaker) {
    case "goalDifference":
      return compareNumberDescending(first.goalDifference, second.goalDifference);
    case "goalsFor":
      return compareNumberDescending(first.goalsFor, second.goalsFor);
    case "wins":
      return compareNumberDescending(first.wins, second.wins);
    case "awayGoals":
      return compareNumberDescending(values?.get(first.teamId) ?? 0, values?.get(second.teamId) ?? 0);
    case "redCards":
    case "yellowCards":
      return (values?.get(first.teamId) ?? 0) - (values?.get(second.teamId) ?? 0);
    case "competitionNumber":
      return (values?.get(first.teamId) ?? 0) - (values?.get(second.teamId) ?? 0);
    case "headToHeadPoints":
      return compareNumberDescending(
        headToHeadByTeam?.get(first.teamId)?.points ?? 0,
        headToHeadByTeam?.get(second.teamId)?.points ?? 0,
      );
    case "headToHeadGoalDifference":
      return compareNumberDescending(
        getHeadToHeadGoalDifference(headToHeadByTeam?.get(first.teamId)),
        getHeadToHeadGoalDifference(headToHeadByTeam?.get(second.teamId)),
      );
    case "headToHeadGoalsFor":
      return compareNumberDescending(
        headToHeadByTeam?.get(first.teamId)?.goalsFor ?? 0,
        headToHeadByTeam?.get(second.teamId)?.goalsFor ?? 0,
      );
    case "headToHead":
      return compareHeadToHead(
        headToHeadByTeam?.get(first.teamId),
        headToHeadByTeam?.get(second.teamId),
      );
  }
}

function getHeadToHeadGoalDifference(stats: HeadToHeadStats | undefined): number {
  return stats ? stats.goalsFor - stats.goalsAgainst : 0;
}

function compareHeadToHead(
  first: HeadToHeadStats | undefined,
  second: HeadToHeadStats | undefined,
): number {
  if (!first || !second) {
    return 0;
  }

  return compareNumberDescending(first.points, second.points)
    || compareNumberDescending(
      first.goalsFor - first.goalsAgainst,
      second.goalsFor - second.goalsAgainst,
    )
    || compareNumberDescending(first.goalsFor, second.goalsFor);
}

function canUseBrazilianDraw(tournament: Tournament): boolean {
  const days = tournament.matchdays.filter(day => day.phaseName === "Fase regular");
  return tournament.teams.length === 20 && days.flatMap(day => day.fixtures).length === 380
    && days.every(day => day.fixtures.every(f => isValidFixtureResult(tournament, day, f)));
}
function brazilianDrawContext(tournament: Tournament, rows: readonly TeamStanding[]): OfficialResolutionContext {
  return makeResolutionContext(tournament, "brasil-table", "Tabela final", "Sorteo final de tabla · Série B",
    rows.map(row => row.teamId), [...rows].sort((a, b) => a.teamId.localeCompare(b.teamId)));
}
export function getBrazilianOfficialDrawContexts(tournament: Tournament): OfficialResolutionContext[] {
  if (secondDivisionKind(tournament) !== "brasil" || !canUseBrazilianDraw(tournament)) return [];
  const raw = { ...tournament, officialResolutions: undefined };
  return getUnresolvedStandingsTieDetails(raw, calculateStandings(raw))
    .filter(detail => detail.criterion === "configured-criteria")
    .map(detail => brazilianDrawContext(tournament, detail.teams));
}
