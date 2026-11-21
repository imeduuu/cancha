import { hasPendingAnnualRules } from "./season-preparation";
import type { Tournament } from "../entities/tournament";
import { calculateTournamentStatistics } from "./tournament-statistics";
import type { TeamStanding } from "./standings";

import { secondDivisionKind } from "./second-division-rules";
import { getDivisionOutcome } from "./second-division-progression";
import { isArgentinaAnnualLeague } from "./argentina-league-champion";
import { isChileanAscenso } from "./chilean-ascenso-playoff-progression";

export type TournamentCompletionStatus = "Finalizado" | "En curso" | "Incompleto" | "Indeterminado";

export interface SeasonComparison {
  readonly compatible: boolean;
  readonly warning?: string;
  readonly teams: readonly {
    readonly currentTeamName: string;
    readonly previousTeamName?: string;
    readonly identity: "stable-id" | "average-identity" | "possible-name-match" | "unmatched";
    readonly current?: TeamStanding;
    readonly previous?: TeamStanding;
  }[];
}

export function getTournamentCompetitionId(tournamentId: string): string | undefined {
  const match = /^(.*?)-((?:19|20)\d{2})$/.exec(tournamentId);
  return match?.[1] || undefined;
}

/**
 * "verified" (default) requires the annual rules gate; "sporting" accepts the sporting
 * outcome of simulated or calculated scenarios, which callers must label as such.
 */
export type ChampionBasis = "verified" | "sporting";

export function getTournamentCompletionStatus(tournament: Tournament, basis: ChampionBasis = "verified"): TournamentCompletionStatus {
  if (secondDivisionKind(tournament)) return getDivisionOutcome(tournament).complete ? "Finalizado" : "En curso";
  const statistics = calculateTournamentStatistics(tournament);
  const championTeamId = basis === "sporting" ? statistics.sportingChampionTeamId : statistics.championTeamId;
  const fixtures = tournament.matchdays.flatMap(({ fixtures: dayFixtures }) => dayFixtures);
  if (fixtures.length === 0) return "Indeterminado";
  if (statistics.incomplete > 0) return "Incompleto";
  if (statistics.pending > 0) return "En curso";
  if (statistics.played !== fixtures.length) return "Incompleto";

  if (tournament.competitionType === "cup") {
    return championTeamId ? "Finalizado" : "Indeterminado";
  }
  // Staged leagues whose conclusion has its own rule: LPF 2026 (Campeón de Liga) and Liga de Ascenso (Liguilla).
  if (isArgentinaAnnualLeague(tournament) || isChileanAscenso(tournament)) {
    return championTeamId ? "Finalizado" : "Indeterminado";
  }
  if (
    (tournament.format === undefined || tournament.format === "round-robin")
    && tournament.teams.length > 1
    && !tournament.teams.some((team) => team.groupName)
    && tournament.matchdays.every((matchday) => matchday.phaseName === undefined)
    && hasCompleteRoundRobinSchedule(tournament)
    && championTeamId
  ) {
    return "Finalizado";
  }
  return "Indeterminado";
}

export function getFinalStandings(tournament: Tournament, basis: ChampionBasis = "verified"): readonly TeamStanding[] | undefined {
  return getTournamentCompletionStatus(tournament, basis) === "Finalizado"
    && tournament.competitionType !== "cup"
    && !tournament.teams.some((team) => team.groupName)
    && tournament.matchdays.every((matchday) => matchday.phaseName === undefined)
    && hasCompleteRoundRobinSchedule(tournament)
    ? calculateTournamentStatistics(tournament).standings
    : undefined;
}

export function getSportingFinalStandings(tournament: Tournament): readonly TeamStanding[] | undefined {
  return getFinalStandings(tournament, "sporting");
}

export function canStartNewSeason(tournament: Tournament): boolean {
  if (hasPendingAnnualRules(tournament)) return false;
  return Boolean(
    tournament.competitionId
    && tournament.season
    && tournament.format !== "staged"
    && tournament.matchdays.every((matchday) => matchday.phaseName === undefined)
    && tournament.competitionType !== "cup"
    && tournament.teams.length > 1
    && !tournament.teams.some((team) => team.groupName)
    && hasCompleteRoundRobinSchedule(tournament),
  );
}

export function compareTournamentSeasons(
  current: Tournament,
  previous: Tournament,
): SeasonComparison {
  if (
    getTournamentCompletionStatus(current) !== "Finalizado"
    || getTournamentCompletionStatus(previous) !== "Finalizado"
  ) {
    return {
      compatible: false,
      warning: "La comparación de posiciones finales requiere dos temporadas completas y con campeón confirmado.",
      teams: [],
    };
  }
  const warning = getSeasonCompatibilityWarning(current, previous);
  if (warning) return { compatible: false, warning, teams: [] };

  const currentStandings = calculateTournamentStatistics(current).standings;
  const previousStandings = calculateTournamentStatistics(previous).standings;
  const previousById = new Map(previousStandings.map((standing) => [standing.teamId, standing]));
  const previousTeamsById = new Map(previous.teams.map((team) => [team.id, team]));
  const previousByAverageIdentity = new Map<string, TeamStanding>();
  const previousByName = new Map<string, TeamStanding[]>();
  for (const standing of previousStandings) {
    const team = previousTeamsById.get(standing.teamId);
    if (team?.averageIdentity) previousByAverageIdentity.set(team.averageIdentity, standing);
    const normalizedName = normalizeName(standing.teamName);
    const named = previousByName.get(normalizedName) ?? [];
    named.push(standing);
    previousByName.set(normalizedName, named);
  }
  const currentTeamsById = new Map(current.teams.map((team) => [team.id, team]));
  const teams = currentStandings.map((standing) => {
    const currentTeam = currentTeamsById.get(standing.teamId);
    const sameId = previousById.get(standing.teamId);
    if (sameId) {
      return {
        currentTeamName: standing.teamName,
        previousTeamName: sameId.teamName,
        identity: "stable-id" as const,
        current: standing,
        previous: sameId,
      };
    }
    const sameAverageIdentity = currentTeam?.averageIdentity
      ? previousByAverageIdentity.get(currentTeam.averageIdentity)
      : undefined;
    if (sameAverageIdentity) {
      return {
        currentTeamName: standing.teamName,
        previousTeamName: sameAverageIdentity.teamName,
        identity: "average-identity" as const,
        current: standing,
        previous: sameAverageIdentity,
      };
    }
    const possibleMatches = previousByName.get(normalizeName(standing.teamName)) ?? [];
    if (possibleMatches.length === 1) {
      return {
        currentTeamName: standing.teamName,
        previousTeamName: possibleMatches[0].teamName,
        identity: "possible-name-match" as const,
        current: standing,
        previous: possibleMatches[0],
      };
    }
    return {
      currentTeamName: standing.teamName,
      identity: "unmatched" as const,
      current: standing,
    };
  });
  return { compatible: true, teams };
}

function getSeasonCompatibilityWarning(current: Tournament, previous: Tournament): string | undefined {
  if (!current.competitionId || current.competitionId !== previous.competitionId) {
    return "Solo se pueden comparar temporadas con la misma identidad de competición explícita.";
  }
  if (!current.season || !previous.season || current.season === previous.season) {
    return "Se necesitan dos temporadas distintas identificadas explícitamente.";
  }
  const currentPoints = current.pointsSystem
    ?? current.competitionRules?.points
    ?? { win: 3, draw: 1, loss: 0 };
  const previousPoints = previous.pointsSystem
    ?? previous.competitionRules?.points
    ?? { win: 3, draw: 1, loss: 0 };
  if (
    current.format !== previous.format
    || current.competitionType !== previous.competitionType
    || current.legs !== previous.legs
    || currentPoints.win !== previousPoints.win
    || currentPoints.draw !== previousPoints.draw
    || currentPoints.loss !== previousPoints.loss
    || Boolean(current.teams.some((team) => team.groupName))
      !== Boolean(previous.teams.some((team) => team.groupName))
    || (current.knockoutStages ?? []).map(({ legs, advanceWinners }) =>
      `${legs}:${advanceWinners ?? true}`).join("|")
      !== (previous.knockoutStages ?? []).map(({ legs, advanceWinners }) =>
        `${legs}:${advanceWinners ?? true}`).join("|")
  ) {
    return "Los formatos o sistemas de puntos difieren; revisa la configuración antes de comparar.";
  }
  return undefined;
}

function normalizeName(name: string): string {
  return name.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}

export function hasCompleteRoundRobinSchedule(tournament: Tournament): boolean {
  if (tournament.teams.length < 2 || tournament.legs < 1) return false;
  const fixtures = tournament.matchdays.flatMap(({ fixtures }) => fixtures);
  const expectedCount = tournament.teams.length * (tournament.teams.length - 1) / 2
    * tournament.legs;
  if (fixtures.length !== expectedCount) return false;
  const teamIds = new Set(tournament.teams.map(({ id }) => id));
  if (fixtures.some((fixture) =>
    !teamIds.has(fixture.homeTeamId) || !teamIds.has(fixture.awayTeamId))) return false;
  const meetings = new Map<string, number>();
  for (const fixture of fixtures) {
    const key = [fixture.homeTeamId, fixture.awayTeamId].sort().join("|");
    meetings.set(key, (meetings.get(key) ?? 0) + 1);
  }
  return meetings.size === expectedCount / tournament.legs
    && [...meetings.values()].every((count) => count === tournament.legs);
}
