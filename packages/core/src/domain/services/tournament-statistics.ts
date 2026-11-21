import { hasUnverifiedCompetitionRules } from "./competition-rules";
import { hasPendingAnnualRules } from "./season-preparation";
import type { Fixture, Matchday, Tournament } from "../entities/tournament";
import { isValidFixtureResult } from "./match-result-validation";
import {
  isGoalScorerForFixture,
  isValidGoalScorer,
  validateGoalScorers,
} from "./goal-scorers";
import { getCompletedStageWinners } from "./official-cup-progression";
import { getOperationalMatchStatus } from "./match-operational-status";
import { validateFixtureDetails } from "./match-details";
import {
  calculateStandings,
  hasUniqueStandingsLeader,
  type TeamStanding,
} from "./standings";

import { secondDivisionKind } from "./second-division-rules";
import { getArgentinaLeagueChampion, isArgentinaAnnualLeague } from "./argentina-league-champion";
import { isChileanAscenso } from "./chilean-ascenso-playoff-progression";
import { getChileanAscensoOutcome } from "./chilean-division-outcome";
import { regularDivisionTournament, hasCompleteDivisionLeague, getDivisionOutcome } from "./second-division-progression";

export interface TournamentStatistics {
  readonly played: number;
  readonly pending: number;
  readonly notPlayed: number;
  readonly incomplete: number;
  readonly invalidDetails: number;
  readonly suspended: number;
  readonly cancelled: number;
  readonly postponed: number;
  readonly scheduled: number;
  readonly inProgress: number;
  readonly unscheduled: number;
  readonly finished: number;
  readonly homeWins: number;
  readonly draws: number;
  readonly awayWins: number;
  readonly totalGoals: number;
  readonly averageGoals: number;
  readonly progressPercent: number;
  readonly progressLabel: string;
  readonly standings: readonly TeamStanding[];
  readonly homeAway: ReadonlyMap<string, {
    readonly homePlayed: number;
    readonly homeWins: number;
    readonly homeDraws: number;
    readonly homeLosses: number;
    readonly awayPlayed: number;
    readonly awayWins: number;
    readonly awayDraws: number;
    readonly awayLosses: number;
  }>;
  readonly topScorers: readonly {
    readonly playerId?: string;
    readonly playerName: string;
    readonly teamId: string;
    readonly teamName: string;
    readonly goals: number;
  }[];
  readonly topScorerRecordCount: number;
  readonly scorerDataAvailable: boolean;
  readonly individualStatistics: readonly {
    readonly playerId: string;
    readonly playerName: string;
    readonly teamId: string;
    readonly starts: number;
    readonly substituteAppearances: number;
    readonly goals: number;
    readonly ownGoals: number;
    readonly yellowCards: number;
    readonly redCards: number;
    readonly minutesPlayed?: number;
  }[];
  readonly championTeamId?: string;
  /** Sporting outcome without the annual-rules verification gate (simulated or calculated champions). */
  readonly sportingChampionTeamId?: string;
}

export interface TournamentStatisticsFilter {
  readonly phaseName?: string;
  readonly groupName?: string;
}

export function isValidPlayedFixture(tournament: Tournament, matchday: Matchday, fixture: Fixture): boolean {
  return isValidFixtureResult(tournament, matchday, fixture);
}

export function calculateTournamentStatistics(
  tournament: Tournament,
  filter: TournamentStatisticsFilter = {},
): TournamentStatistics {
  const groupTeamIds = filter.groupName
    ? new Set(tournament.teams
      .filter((team) => team.groupName === filter.groupName)
      .map((team) => team.id))
    : undefined;
  const matchdays = tournament.matchdays
    .filter((matchday) => !filter.phaseName || matchday.phaseName === filter.phaseName)
    .map((matchday) => ({
      ...matchday,
      fixtures: matchday.fixtures.filter((fixture) => !groupTeamIds
        || (secondDivisionKind(tournament)
          ? groupTeamIds.has(fixture.homeTeamId) || groupTeamIds.has(fixture.awayTeamId)
          : groupTeamIds.has(fixture.homeTeamId) && groupTeamIds.has(fixture.awayTeamId))),
    }));
  const scopedTournament: Tournament = {
    ...tournament,
    teams: groupTeamIds
      ? tournament.teams.filter((team) => groupTeamIds.has(team.id))
      : tournament.teams,
    matchdays,
  };
  const standings = calculateStandings(secondDivisionKind(tournament) && !filter.phaseName
    ? regularDivisionTournament(scopedTournament) : scopedTournament, tournament.matchdays);
  const teamsById = new Map(scopedTournament.teams.map((team) => [team.id, team]));
  const homeAway = new Map<string, {
    homePlayed: number;
    homeWins: number;
    homeDraws: number;
    homeLosses: number;
    awayPlayed: number;
    awayWins: number;
    awayDraws: number;
    awayLosses: number;
  }>(scopedTournament.teams.map(({ id }) => [id, {
    homePlayed: 0,
    homeWins: 0,
    homeDraws: 0,
    homeLosses: 0,
    awayPlayed: 0,
    awayWins: 0,
    awayDraws: 0,
    awayLosses: 0,
  }]));
  const scorerCounts = new Map<string, {
    playerId?: string;
    teamId: string;
    playerName: string;
    goals: number;
  }>();
  const individualCounts = new Map<string, {
    playerId: string;
    playerName: string;
    teamId: string;
    starts: number;
    substituteAppearances: number;
    goals: number;
    ownGoals: number;
    yellowCards: number;
    redCards: number;
  }>();
  const playersById = new Map((tournament.players ?? []).map((player) =>
    [player.id, `${player.firstName} ${player.lastName}`]));
  const getIndividual = (playerId: string, teamId: string, name?: string) => {
    const key = `${playerId}|${teamId}`;
    let current = individualCounts.get(key);
    if (!current) {
      current = {
        playerId,
        playerName: playersById.get(playerId) ?? name ?? playerId,
        teamId,
        starts: 0,
        substituteAppearances: 0,
        goals: 0,
        ownGoals: 0,
        yellowCards: 0,
        redCards: 0,
      };
      individualCounts.set(key, current);
    }
    return current;
  };
  let played = 0;
  let pending = 0;
  let incomplete = 0;
  let invalidDetails = 0;
  let suspended = 0;
  let cancelled = 0;
  let postponed = 0;
  let scheduled = 0;
  let inProgress = 0;
  let unscheduled = 0;
  let finished = 0;
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let totalGoals = 0;
  let topScorerRecordCount = 0;
  const hasEmptyStage = tournament.matchdays.some((matchday) =>
    Boolean(matchday.phaseName) && matchday.fixtures.length === 0,
  );

  for (const matchday of matchdays) {
    for (const fixture of matchday.fixtures) {
      const hasInvalidDetails = hasInvalidIndividualData(tournament, fixture);
      if (hasInvalidDetails) invalidDetails += 1;
      const operationalStatus = getOperationalMatchStatus(fixture);
      if (operationalStatus === "suspended") suspended += 1;
      if (operationalStatus === "cancelled") cancelled += 1;
      if (operationalStatus === "postponed") postponed += 1;
      if (operationalStatus === "scheduled") scheduled += 1;
      if (operationalStatus === "in-progress") inProgress += 1;
      if (operationalStatus === "unscheduled") unscheduled += 1;
      if (operationalStatus === "finished") finished += 1;
      if (operationalStatus === "postponed"
        || operationalStatus === "suspended"
        || operationalStatus === "cancelled"
        || operationalStatus === "unscheduled"
        || operationalStatus === "scheduled"
        || operationalStatus === "in-progress") {
        const { operationalState: _operationalState, ...fixtureWithoutOperationalState } = fixture;
        if (fixture.result !== undefined
          && !isValidPlayedFixture(tournament, matchday, fixtureWithoutOperationalState)) {
          incomplete += 1;
        } else {
          pending += 1;
        }
        continue;
      }
      if (!fixture.result) {
        incomplete += 1;
        continue;
      }
      if (!isValidPlayedFixture(tournament, matchday, fixture)) {
        incomplete += 1;
        continue;
      }

      played += 1;
      const { homeGoals, awayGoals, extraTime } = fixture.result;
      totalGoals += homeGoals + awayGoals
        + (extraTime?.homeGoals ?? 0) + (extraTime?.awayGoals ?? 0);
      if (homeGoals > awayGoals) homeWins += 1;
      else if (homeGoals < awayGoals) awayWins += 1;
      else draws += 1;

      const homeStats = homeAway.get(fixture.homeTeamId);
      const awayStats = homeAway.get(fixture.awayTeamId);
      if (homeStats) {
        homeStats.homePlayed += 1;
        if (homeGoals > awayGoals) homeStats.homeWins += 1;
        else if (homeGoals < awayGoals) homeStats.homeLosses += 1;
        else homeStats.homeDraws += 1;
      }
      if (awayStats) {
        awayStats.awayPlayed += 1;
        if (awayGoals > homeGoals) awayStats.awayWins += 1;
        else if (awayGoals < homeGoals) awayStats.awayLosses += 1;
        else awayStats.awayDraws += 1;
      }

      if (!hasInvalidDetails) {
        for (const scorer of fixture.goalScorers ?? []) {
          if (!isValidGoalScorer(scorer) || !isGoalScorerForFixture(scorer, fixture)) continue;
          topScorerRecordCount += 1;
          if (scorer.playerId) {
            const individual = getIndividual(scorer.playerId, scorer.teamId, scorer.playerName);
            if (scorer.type === "own-goal") individual.ownGoals += 1;
            else individual.goals += 1;
          }
          if (scorer.type === "own-goal") continue;
          const key = scorer.playerId
            ? `${scorer.teamId}|id:${scorer.playerId}`
            : `${scorer.teamId}|name:${scorer.playerName.trim().toLocaleLowerCase("es")}`;
          const current = scorerCounts.get(key);
          if (current) current.goals += 1;
          else scorerCounts.set(key, {
            ...(scorer.playerId ? { playerId: scorer.playerId } : {}),
            teamId: scorer.teamId,
            playerName: scorer.playerName.trim(),
            goals: 1,
          });
        }

        if (fixture.lineups) {
          for (const [teamId, lineup] of [
            [fixture.homeTeamId, fixture.lineups.home],
            [fixture.awayTeamId, fixture.lineups.away],
          ] as const) {
            for (const playerId of lineup.starters) {
              getIndividual(playerId, teamId).starts += 1;
            }
          }
        }
        for (const substitution of fixture.substitutions ?? []) {
          const player = playersById.get(substitution.playerInId);
          if (player) getIndividual(substitution.playerInId, substitution.teamId, player)
            .substituteAppearances += 1;
        }
        for (const event of fixture.events ?? []) {
          if (!event.playerId) continue;
          const individual = getIndividual(event.playerId, event.teamId, event.playerName);
          if (event.type === "own-goal"
            && !(fixture.goalScorers ?? []).some((scorer) => scorer.eventId === event.id)) {
            individual.ownGoals += 1;
          } else if (event.type === "yellow-card") individual.yellowCards += 1;
          else if (event.type === "red-card") individual.redCards += 1;
        }
      }
    }
  }

  const totalFixtures = played + pending + incomplete;
  const allRecordedFixturesPlayed = totalFixtures > 0 && pending === 0 && incomplete === 0;
  const sportingChampionTeamId = getSportingChampionFrom(
    tournament,
    standings,
    matchdays,
    allRecordedFixturesPlayed && !filter.phaseName && !filter.groupName,
  );
  const championTeamId = hasVerifiedChampionRules(tournament) ? sportingChampionTeamId : undefined;
  const topScorers = [...scorerCounts.values()]
    .map((scorer) => ({
      ...scorer,
      teamName: teamsById.get(scorer.teamId)?.name ?? "Equipo desconocido",
    }))
    .sort((first, second) =>
      second.goals - first.goals
      || first.playerName.localeCompare(second.playerName, "es")
      || first.teamName.localeCompare(second.teamName, "es"));

  return {
    played,
    pending,
    notPlayed: 0,
    incomplete,
    invalidDetails,
    suspended,
    cancelled,
    postponed,
    scheduled,
    inProgress,
    unscheduled,
    finished,
    homeWins,
    draws,
    awayWins,
    totalGoals,
    averageGoals: played > 0 ? totalGoals / played : 0,
    progressPercent: totalFixtures > 0 ? Math.round((played / totalFixtures) * 100) : 0,
    progressLabel: getProgressLabel(
      allRecordedFixturesPlayed,
      incomplete,
      pending,
      hasEmptyStage,
      tournament,
    ),
    standings,
    homeAway,
    topScorers,
    topScorerRecordCount,
    scorerDataAvailable: topScorerRecordCount > 0,
    individualStatistics: [...individualCounts.values()]
      .sort((first, second) =>
        second.goals - first.goals
        || second.starts + second.substituteAppearances
          - (first.starts + first.substituteAppearances)
        || first.playerName.localeCompare(second.playerName, "es")),
    ...(championTeamId ? { championTeamId } : {}),
    ...(sportingChampionTeamId ? { sportingChampionTeamId } : {}),
  };
}

function hasInvalidIndividualData(tournament: Tournament, fixture: Fixture): boolean {
  if (validateFixtureDetails(tournament, fixture)
    || validateGoalScorers(fixture.goalScorers ?? [], fixture)) return true;
  const playerIds = new Set((tournament.players ?? []).map(({ id }) => id));
  const registrations = tournament.playerRegistrations ?? [];
  return (fixture.goalScorers ?? []).some((scorer) =>
    scorer.playerId !== undefined
    && (!playerIds.has(scorer.playerId)
      || !registrations.some((registration) =>
        registration.playerId === scorer.playerId && registration.teamId === scorer.teamId)));
}

function getProgressLabel(
  allRecordedFixturesPlayed: boolean,
  incomplete: number,
  pending: number,
  hasEmptyStage: boolean,
  tournament: Tournament,
): string {
  if (secondDivisionKind(tournament) && getDivisionOutcome(tournament).complete) return "Temporada resuelta";
  if (incomplete > 0) return "Hay resultados incompletos o inválidos";
  if (hasEmptyStage && tournament.format === "staged") return "Fase futura aún sin cruces";
  if (allRecordedFixturesPlayed) return "Partidos programados completos";
  if (pending > 0) return "En curso";
  return "Sin partidos programados";
}

function hasVerifiedChampionRules(tournament: Tournament): boolean {
  return !hasPendingAnnualRules(tournament)
    && (tournament.competitionType === "cup" || !hasUnverifiedCompetitionRules(tournament, "standings"));
}

/** Champion of the sporting outcome itself; callers decide how it is accredited. */
export function getSportingChampion(tournament: Tournament): string | undefined {
  return calculateTournamentStatistics(tournament).sportingChampionTeamId;
}

function getSportingChampionFrom(
  tournament: Tournament,
  standings: readonly TeamStanding[],
  matchdays: readonly Matchday[],
  allFixturesPlayed: boolean,
): string | undefined {
  if (isArgentinaAnnualLeague(tournament)) return getArgentinaLeagueChampion(tournament).champion;
  if (isChileanAscenso(tournament)) {
    const outcome = getChileanAscensoOutcome(tournament);
    return allFixturesPlayed && outcome.complete ? outcome.champion : undefined;
  }
  if (secondDivisionKind(tournament)) {
    if (!hasCompleteDivisionLeague(tournament)) return undefined;
    if (secondDivisionKind(tournament) === "argentina") return getDivisionOutcome(tournament).promoted[0];
    const regular = regularDivisionTournament(tournament);
    const table = calculateStandings(regular);
    return hasUniqueStandingsLeader(regular, table) ? table[0]?.teamId : undefined;
  }
  if (!allFixturesPlayed || standings.length === 0) return undefined;
  if (
    tournament.competitionType !== "cup"
    && tournament.format !== "staged"
    && !tournament.teams.some((team) => team.groupName)
    && hasCompleteRoundRobinSchedule(tournament)
    && hasUniqueStandingsLeader(tournament, standings)
  ) {
    return standings[0].teamId;
  }

  if (tournament.competitionType !== "cup" || !tournament.knockoutStages?.length) {
    return undefined;
  }
  const finalStage = tournament.knockoutStages[tournament.knockoutStages.length - 1];
  if (!/final/i.test(finalStage.name)) return undefined;
  if (tournament.knockoutStages.some((stage) =>
    !getCompletedStageWinners(matchdays, stage))) return undefined;
  const winners = getCompletedStageWinners(matchdays, finalStage);
  return winners?.length === 1 ? winners[0] : undefined;
}

function hasCompleteRoundRobinSchedule(tournament: Tournament): boolean {
  if (tournament.teams.length < 2 || tournament.legs < 1) return false;
  const fixtures = tournament.matchdays.flatMap(({ fixtures }) => fixtures);
  const expectedCount = (tournament.teams.length * (tournament.teams.length - 1) / 2)
    * tournament.legs;
  if (fixtures.length !== expectedCount) return false;
  const meetings = new Map<string, number>();
  for (const fixture of fixtures) {
    const key = [fixture.homeTeamId, fixture.awayTeamId].sort().join("|");
    meetings.set(key, (meetings.get(key) ?? 0) + 1);
  }
  return meetings.size === tournament.teams.length * (tournament.teams.length - 1) / 2
    && [...meetings.values()].every((count) => count === tournament.legs);
}
