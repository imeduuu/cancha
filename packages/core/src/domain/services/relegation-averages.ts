import type { RelegationAverageConfiguration, Tournament } from "../entities/tournament";
import type { TieBreaker } from "../value-objects/tie-breaker";
import { normalizeTeamName } from "./team-name";
import { calculateStandings, type TeamStanding } from "./standings";
import { isValidFixtureResult } from "./match-result-validation";

export interface RelegationAverageStanding {
  readonly teamId: string;
  readonly teamName: string;
  readonly played: number;
  readonly points: number;
  readonly average: number | undefined;
  readonly seasonsPresent: readonly number[];
  readonly completeHistory: boolean;
  readonly rank: number;
  readonly tiedAtBoundary: boolean;
  readonly status: "confirmed" | "provisional" | "pending";
  readonly relegation: boolean;
}

export interface RelegationAverageResult {
  readonly standings: readonly RelegationAverageStanding[];
  readonly verification: RelegationAverageConfiguration["verification"];
  readonly pendingReasons: readonly string[];
}

function seasonOf(tournament: Tournament): number | undefined {
  if (tournament.season !== undefined && tournament.competitionRules?.season !== undefined
    && tournament.season !== tournament.competitionRules.season) return undefined;
  if (tournament.season !== undefined) return tournament.season;
  if (tournament.competitionRules?.season !== undefined) return tournament.competitionRules.season;
  const match = /(?:^|-)(\d{4})$/.exec(tournament.id);
  return match ? Number(match[1]) : undefined;
}

function teamIdentity(team: Tournament["teams"][number]): string {
  return normalizeTeamName(team.averageIdentity ?? team.name);
}

export function calculateRelegationAverages(
  current: Tournament,
  seasonTournaments: readonly Tournament[],
  configuration: RelegationAverageConfiguration,
): RelegationAverageResult {
  if (
    configuration.seasons.length === 0
    || new Set(configuration.seasons).size !== configuration.seasons.length
    || !Number.isSafeInteger(configuration.relegatedCount)
    || configuration.relegatedCount < 0
  ) {
    return {
      standings: [],
      verification: "pending",
      pendingReasons: ["La configuración de temporadas o cantidad de descensos no es válida."],
    };
  }
  const identity = (t: Tournament) => t.competitionId ?? t.id.replace(/-\d{4}$/, "");
  const eligible = [...seasonTournaments.filter(t => t.id !== current.id), current]
    .filter(t => identity(t) === identity(current));
  const regular = (t: Tournament): Tournament => identity(t) === "arg-liga-profesional"
    ? { ...t, matchdays: t.matchdays.filter(day => !day.phaseName || day.phaseName.endsWith("Fase regular")) } : t;
  const tournamentsBySeason = new Map<number, Tournament>();
  const ambiguousSeasons = new Set<number>();
  const inconsistentSeasonTournaments = eligible.filter((tournament) =>
    tournament.season !== undefined && tournament.competitionRules?.season !== undefined
    && tournament.season !== tournament.competitionRules.season
    && (configuration.seasons.includes(tournament.season) || configuration.seasons.includes(tournament.competitionRules.season)));
  for (const tournament of eligible) {
    const season = seasonOf(tournament);
    if (season === undefined || !configuration.seasons.includes(season)) continue;
    // The explicitly selected current season takes precedence over other snapshots of that year.
    if (season === seasonOf(current) && tournament.id !== current.id) continue;
    if (tournamentsBySeason.has(season) && tournamentsBySeason.get(season)!.id !== tournament.id) ambiguousSeasons.add(season);
    tournamentsBySeason.set(season, regular(tournament));
  }
  for (const season of ambiguousSeasons) tournamentsBySeason.delete(season);
  const missingSeasons = configuration.seasons.filter((season) => !tournamentsBySeason.has(season));
  const pointsByIdentity = new Map<string, {
    points: number;
    played: number;
    wins: number;
    goalsFor: number;
    goalsAgainst: number;
    seasons: Set<number>;
    headToHead: Map<string, { points: number; goalsFor: number; goalsAgainst: number }>;
  }>();

  for (const season of configuration.seasons) {
    const tournament = tournamentsBySeason.get(season);
    if (!tournament) continue;
    const standings = calculateStandings(tournament);
    const teams = new Map(tournament.teams.map((team) => [team.id, team]));
    for (const standing of standings) {
      const team = teams.get(standing.teamId);
      if (!team) continue;
      const identity = teamIdentity(team);
      const totals = pointsByIdentity.get(identity) ?? {
        points: 0,
        played: 0,
        wins: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        seasons: new Set<number>(),
        headToHead: new Map(),
      };
      totals.points += standing.points;
      totals.played += standing.played;
      totals.wins += standing.wins;
      totals.goalsFor += standing.goalsFor;
      totals.goalsAgainst += standing.goalsAgainst;
      totals.seasons.add(season);
      pointsByIdentity.set(identity, totals);
    }
    const teamsById = new Map(tournament.teams.map((team) => [team.id, team]));
    const points = tournament.pointsSystem ?? tournament.competitionRules?.points
      ?? { win: 3, draw: 1, loss: 0 };
    for (const matchday of tournament.matchdays) {
      for (const fixture of matchday.fixtures) {
      if (!fixture.result || !isValidFixtureResult(tournament, matchday, fixture)) continue;
      const home = teamsById.get(fixture.homeTeamId);
      const away = teamsById.get(fixture.awayTeamId);
      if (!home || !away) continue;
      const homeId = teamIdentity(home);
      const awayId = teamIdentity(away);
      const homeH2h = pointsByIdentity.get(homeId)?.headToHead.get(awayId)
        ?? { points: 0, goalsFor: 0, goalsAgainst: 0 };
      const awayH2h = pointsByIdentity.get(awayId)?.headToHead.get(homeId)
        ?? { points: 0, goalsFor: 0, goalsAgainst: 0 };
      homeH2h.goalsFor += fixture.result.homeGoals;
      homeH2h.goalsAgainst += fixture.result.awayGoals;
      awayH2h.goalsFor += fixture.result.awayGoals;
      awayH2h.goalsAgainst += fixture.result.homeGoals;
      if (fixture.result.homeGoals > fixture.result.awayGoals) {
        homeH2h.points += points.win;
        awayH2h.points += points.loss;
      } else if (fixture.result.homeGoals < fixture.result.awayGoals) {
        awayH2h.points += points.win;
        homeH2h.points += points.loss;
      } else {
        homeH2h.points += points.draw;
        awayH2h.points += points.draw;
      }
      pointsByIdentity.get(homeId)?.headToHead.set(awayId, homeH2h);
      pointsByIdentity.get(awayId)?.headToHead.set(homeId, awayH2h);
      }
    }
  }

  const currentStandings: TeamStanding[] = calculateStandings(regular(current));
  const completeResultsBySeason = [...tournamentsBySeason.values()].every((tournament) =>
    tournament.importCoverage !== "partial" && tournament.importCoverage !== "unknown"
    && tournament.matchdays.some(day => day.fixtures.length > 0)
    && tournament.matchdays.every((matchday) => matchday.fixtures.every((fixture) =>
      isValidFixtureResult(tournament, matchday, fixture),
    )),
  );
  const rulesVerified = configuration.verification === "verified"
    && [...tournamentsBySeason.values()].every(t => !t.competitionRules || t.competitionRules.verification.standings === "verified");
  const allSeasonDataAvailable = missingSeasons.length === 0 && ambiguousSeasons.size === 0;
  const pendingReasons: string[] = [];
  if (ambiguousSeasons.size) pendingReasons.push(`Hay temporadas históricas duplicadas: ${[...ambiguousSeasons].join(", ")}. Selecciona una fuente inequívoca.`);
  if ([...tournamentsBySeason.values()].some(t => t.importCoverage === "partial" || t.importCoverage === "unknown"))
    pendingReasons.push("La cobertura histórica es parcial o no está acreditada como completa.");
  if (inconsistentSeasonTournaments.length > 0) {
    pendingReasons.push(
      `Hay torneos con temporada y temporada de reglas incompatibles: ${inconsistentSeasonTournaments
        .map(({ id }) => id).join(", ")}. Esos datos no se contabilizaron.`,
    );
  }
  if (!rulesVerified) pendingReasons.push("El reglamento de promedios no está verificado.");
  if (missingSeasons.length > 0) {
    pendingReasons.push(`Faltan datos de las temporadas: ${missingSeasons.join(", ")}.`);
  }
  if (!completeResultsBySeason) pendingReasons.push("Hay partidos sin resultado en las temporadas consideradas.");

  const preliminary = currentStandings.map((standing) => {
    const currentTeam = current.teams.find(({ id }) => id === standing.teamId);
    const identity = currentTeam ? teamIdentity(currentTeam) : normalizeTeamName(standing.teamName);
    const totals = pointsByIdentity.get(identity);
    const seasonsPresent = [...(totals?.seasons ?? [])].sort((a, b) => a - b);
    const completeHistory = configuration.seasons.every((season) => seasonsPresent.includes(season));
    return {
      teamId: standing.teamId,
      teamName: standing.teamName,
      played: totals?.played ?? 0,
      points: totals?.points ?? 0,
      average: totals && totals.played > 0 ? totals.points / totals.played : undefined,
      seasonsPresent,
      completeHistory,
      metrics: totals,
      identity,
    };
  });

  const configuredTieBreakers = configuration.tieBreakers ?? [];
  const baseSort = (first: typeof preliminary[number], second: typeof preliminary[number]) =>
    (second.average ?? Number.NEGATIVE_INFINITY) - (first.average ?? Number.NEGATIVE_INFINITY);
  const averageTieGroup = (standing: typeof preliminary[number]) => preliminary.filter((candidate) =>
    baseSort(candidate, standing) === 0,
  );
  preliminary.sort((first, second) =>
    baseSort(first, second)
    || compareConfiguredTieBreakers(
      first,
      second,
      configuredTieBreakers,
      averageTieGroup(first),
    )
    || first.teamName.localeCompare(second.teamName, "es"),
  );

  const rankByIdentity = new Map<string, number>();
  let rank = 1;
  for (let index = 0; index < preliminary.length; index += 1) {
    if (
      index > 0
      && baseSort(preliminary[index - 1], preliminary[index]) === 0
      && compareConfiguredTieBreakers(
        preliminary[index - 1],
        preliminary[index],
        configuredTieBreakers,
        averageTieGroup(preliminary[index]),
      ) !== 0
    ) {
      rank = index + 1;
    } else if (index > 0 && baseSort(preliminary[index - 1], preliminary[index]) !== 0) {
      rank = index + 1;
    }
    rankByIdentity.set(preliminary[index].identity, rank);
  }

  const standings = preliminary.map((standing, index) => {
    const completeData = allSeasonDataAvailable
      && inconsistentSeasonTournaments.length === 0
      && completeResultsBySeason
      && standing.completeHistory
      && standing.average !== undefined;
    const teamRank = rankByIdentity.get(standing.identity) ?? index + 1;
    const rankTie = preliminary.filter((candidate) =>
      rankByIdentity.get(candidate.identity) === teamRank,
    );
    const boundaryStart = preliminary.length - configuration.relegatedCount + 1;
    const tieIndexes = preliminary.flatMap((candidate, candidateIndex) =>
      rankByIdentity.get(candidate.identity) === teamRank ? [candidateIndex + 1] : [],
    );
    const tieStart = Math.min(...tieIndexes);
    const tieEnd = Math.max(...tieIndexes);
    const tiedAtBoundary = rankTie.length > 1
      && tieStart < boundaryStart
      && tieEnd >= boundaryStart;
    const status = !rulesVerified
      ? "pending" as const
      : completeData && !tiedAtBoundary
        ? "confirmed" as const
        : "provisional" as const;
    return {
      ...standing,
      rank: teamRank,
      tiedAtBoundary,
      status,
      relegation: standing.average !== undefined
        && (teamRank >= boundaryStart || tiedAtBoundary),
    };
  });

  if (standings.some(({ tiedAtBoundary }) => tiedAtBoundary)) {
    pendingReasons.push("Hay un empate en el límite de descenso sin desempate suficiente configurado.");
  }
  return {
    standings,
    verification: configuration.verification,
    pendingReasons,
  };
}

interface AverageTieBreakStanding {
  readonly identity: string;
  readonly metrics: {
    readonly points: number;
    readonly wins: number;
    readonly goalsFor: number;
    readonly goalsAgainst: number;
    readonly headToHead: ReadonlyMap<
      string,
      { points: number; goalsFor: number; goalsAgainst: number }
    >;
  } | undefined;
}

function getTieBreakerValues(
  standing: AverageTieBreakStanding,
  tieBreaker: TieBreaker,
  group: readonly AverageTieBreakStanding[],
): readonly number[] {
  if (tieBreaker === "headToHead" || tieBreaker.startsWith("headToHead")) {
    let points = 0;
    let goalsFor = 0;
    let goalsAgainst = 0;
    for (const opponent of group) {
      if (opponent.identity === standing.identity) continue;
      const stats = standing.metrics?.headToHead.get(opponent.identity);
      points += stats?.points ?? 0;
      goalsFor += stats?.goalsFor ?? 0;
      goalsAgainst += stats?.goalsAgainst ?? 0;
    }
    if (tieBreaker === "headToHead") {
      return [points, goalsFor - goalsAgainst, goalsFor];
    }
    if (tieBreaker === "headToHeadPoints") return [points];
    if (tieBreaker === "headToHeadGoalDifference") return [goalsFor - goalsAgainst];
    return [goalsFor];
  }
  if (tieBreaker === "goalDifference") {
    return [(standing.metrics?.goalsFor ?? 0) - (standing.metrics?.goalsAgainst ?? 0)];
  }
  if (tieBreaker === "goalsFor") return [standing.metrics?.goalsFor ?? 0];
  if (tieBreaker === "wins") return [standing.metrics?.wins ?? 0];
  return [];
}

function compareDescendingValues(
  first: readonly number[],
  second: readonly number[],
): number {
  for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
    const difference = (second[index] ?? 0) - (first[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function compareConfiguredTieBreakers(
  first: AverageTieBreakStanding,
  second: AverageTieBreakStanding,
  tieBreakers: readonly TieBreaker[],
  group: readonly AverageTieBreakStanding[],
): number {
  let stillTied = group;
  for (const tieBreaker of tieBreakers) {
    const firstValues = getTieBreakerValues(first, tieBreaker, stillTied);
    const secondValues = getTieBreakerValues(second, tieBreaker, stillTied);
    const comparison = compareDescendingValues(firstValues, secondValues);
    if (comparison !== 0) return comparison;
    stillTied = stillTied.filter((candidate) =>
      compareDescendingValues(
        getTieBreakerValues(candidate, tieBreaker, stillTied),
        firstValues,
      ) === 0,
    );
  }
  return 0;
}
