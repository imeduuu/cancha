import { parseEspnSchedule } from "./espn-match-schedule";
import type {
  OfficialLeagueId,
  OfficialLeagueSeason,
  OfficialLeagueSource,
  OfficialMatch,
  OfficialMatchday,
} from "@cancha/core/application/ports/official-league-source";
import { parseEspnMatchOperationalStatus } from "./espn-match-status";

const seasonYear = 2026;
const apiBaseUrl = "https://site.api.espn.com/apis/site/v2/sports/soccer";

interface CupStage {
  readonly slug: string;
  readonly name: string;
  readonly legs: 1 | 2;
  readonly advanceWinners?: boolean;
}

interface ContinentalCupConfig {
  readonly league: OfficialLeagueId;
  readonly slug: string;
  readonly tournamentId: string;
  readonly name: string;
  readonly sourceUrl: string;
  readonly groupStageSlug: string;
  readonly groupStageName: string;
  readonly stages: readonly CupStage[];
}

const configurations: Readonly<Record<"libertadores" | "sudamericana", ContinentalCupConfig>> = {
  libertadores: {
    league: "libertadores",
    slug: "conmebol.libertadores",
    tournamentId: "conmebol-libertadores-2026",
    name: "Copa Libertadores",
    sourceUrl: "https://www.espn.com/soccer/fixtures/_/league/conmebol.libertadores",
    groupStageSlug: "group-stage",
    groupStageName: "Fase de grupos",
    stages: [
      // Fase 2 includes 13 direct entrants in addition to the three Fase 1 winners.
      // CONMEBOL Libertadores 2026 club manual, section 2.2.1.3.
      { slug: "first-stage", name: "Fase previa 1", legs: 2, advanceWinners: false },
      { slug: "second-stage", name: "Fase previa 2", legs: 2 },
      { slug: "third-stage", name: "Fase previa 3", legs: 2, advanceWinners: false },
      { slug: "round-of-16", name: "Octavos de final", legs: 2 },
      { slug: "quarterfinals", name: "Cuartos de final", legs: 2 },
      { slug: "semifinals", name: "Semifinales", legs: 2 },
      { slug: "final", name: "Final", legs: 1 },
    ],
  },
  sudamericana: {
    league: "sudamericana",
    slug: "conmebol.sudamericana",
    tournamentId: "conmebol-sudamericana-2026",
    name: "Copa Sudamericana",
    sourceUrl: "https://www.espn.com/soccer/fixtures/_/league/conmebol.sudamericana",
    groupStageSlug: "group-stage",
    groupStageName: "Fase de grupos",
    stages: [
      { slug: "first-stage", name: "Primera fase", legs: 1, advanceWinners: false },
      { slug: "knockout-round-playoffs", name: "Playoff de octavos", legs: 2, advanceWinners: false },
      { slug: "round-of-16", name: "Octavos de final", legs: 2 },
      { slug: "quarterfinals", name: "Cuartos de final", legs: 2 },
      { slug: "semifinals", name: "Semifinales", legs: 2 },
      { slug: "final", name: "Final", legs: 1 },
    ],
  },
};

type JsonRecord = Record<string, unknown>;

interface ParsedCupMatch {
  readonly match: OfficialMatch;
  readonly date: number;
  readonly phaseName: string;
  readonly stageSlug?: string;
  readonly leg?: 1 | 2;
  readonly groupName?: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, description: string): JsonRecord {
  if (!isRecord(value)) {
    throw new Error(`La API de ESPN respondió sin ${description} válido.`);
  }
  return value;
}

function requireString(record: JsonRecord, field: string, description: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`La API de ESPN publicó ${description} sin ${field}.`);
  }
  return value.trim();
}

function parseScore(value: unknown, matchId: string, description: string): number {
  const score = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(score) || score < 0 || score > 99) {
    throw new Error(`ESPN publicó ${description} inválidos para el partido ${matchId}.`);
  }
  return score;
}

function parseEvent(value: unknown, config: ContinentalCupConfig): ParsedCupMatch | undefined {
  const event = requireRecord(value, "un partido continental");
  const id = requireString(event, "id", "un partido continental");
  const date = requireString(event, "date", `la fecha del partido ${id}`);
  const timestamp = Date.parse(date);
  const schedule = parseEspnSchedule(date, id);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`ESPN publicó una fecha inválida para el partido ${id}.`);
  }
  const season = requireRecord(event.season, `la fase del partido ${id}`);
  if (season.year !== undefined && season.year !== seasonYear) throw new Error("ESPN devolvió partidos de otra temporada.");
  const stageSlug = requireString(season, "slug", `la fase del partido ${id}`);
  const stage = config.stages.find((candidate) => candidate.slug === stageSlug);
  if (stageSlug !== config.groupStageSlug && !stage) {
    throw new Error(`ESPN publicó una fase desconocida (${stageSlug}) para el partido ${id}.`);
  }

  const competitions = event.competitions;
  if (!Array.isArray(competitions) || competitions.length === 0) {
    throw new Error(`ESPN publicó el partido ${id} sin competencia.`);
  }
  const competition = requireRecord(competitions[0], `la competencia del partido ${id}`);
  const status = requireRecord(competition.status, `el estado del partido ${id}`);
  const statusType = requireRecord(status.type, `el estado del partido ${id}`);
  const operationalStatus = parseEspnMatchOperationalStatus(statusType, id);
  if (operationalStatus === "abandoned") return undefined;

  const competitors = competition.competitors;
  if (!Array.isArray(competitors) || competitors.length !== 2) {
    throw new Error(`ESPN publicó el partido ${id} sin dos equipos.`);
  }

  const parsedTeams = competitors.map((entry) => {
    const competitor = requireRecord(entry, `un equipo del partido ${id}`);
    const team = requireRecord(competitor.team, `un equipo del partido ${id}`);
    return {
      side: requireString(competitor, "homeAway", `un equipo del partido ${id}`),
      name: requireString(team, "displayName", `un equipo del partido ${id}`),
      score: competitor.score,
      shootoutScore: competitor.shootoutScore,
    };
  });
  const home = parsedTeams.find((team) => team.side === "home");
  const away = parsedTeams.find((team) => team.side === "away");
  if (!home || !away) {
    throw new Error(`ESPN publicó localía inválida para el partido ${id}.`);
  }
  if (/^(TBD|To Be Determined)\b/i.test(home.name) || /^(TBD|To Be Determined)\b/i.test(away.name)) {
    return undefined;
  }

  const matchLeg = isRecord(competition.leg) && competition.leg.value === 2 ? 2 : 1;
  const groupName = !stage && isRecord(competition.group)
    ? requireString(competition.group, "name", `el grupo del partido ${id}`)
    : undefined;
  const phaseName = stage
    ? `${config.name} · ${stage.name}${stage.legs === 2 ? ` · ${matchLeg === 1 ? "Ida" : "Vuelta"}` : ""}`
    : `${config.name} · ${config.groupStageName}`;
  const knockoutResolution = stage
    ? stage.legs === 1
      ? "penalties" as const
      : matchLeg === 2 ? "aggregate-then-penalties" as const : undefined
    : undefined;

  if (operationalStatus !== "finished") {
    return {
      match: {
        id,
        schedule,
        homeTeamName: home.name,
        awayTeamName: away.name,
        operationalStatus,
        ...(groupName
          ? { homeGroupName: groupName, awayGroupName: groupName }
          : {}),
        ...(knockoutResolution ? { knockoutResolution } : {}),
      },
      date: timestamp,
      phaseName,
      ...(stage ? { stageSlug, leg: matchLeg } : {}),
      ...(groupName ? { groupName } : {}),
    };
  }

  const homeGoals = parseScore(home.score, id, "los goles del local");
  const awayGoals = parseScore(away.score, id, "los goles del visitante");
  const homePenalties = home.shootoutScore === undefined
    ? 0
    : parseScore(home.shootoutScore, id, "los penales del local");
  const awayPenalties = away.shootoutScore === undefined
    ? 0
    : parseScore(away.shootoutScore, id, "los penales del visitante");
  const match: OfficialMatch = {
    id,
    schedule,
    homeTeamName: home.name,
    awayTeamName: away.name,
    operationalStatus,
    ...(groupName
      ? { homeGroupName: groupName, awayGroupName: groupName }
      : {}),
    ...(knockoutResolution ? { knockoutResolution } : {}),
    homeGoals,
    awayGoals,
    ...(knockoutResolution && homePenalties !== awayPenalties
      ? { penalties: { homeGoals: homePenalties, awayGoals: awayPenalties } }
      : {}),
  };
  return {
    match,
    date: timestamp,
    phaseName,
    ...(stage ? { stageSlug, leg: matchLeg } : {}),
    ...(groupName ? { groupName } : {}),
  };
}

function groupStageMatches(
  matches: readonly ParsedCupMatch[],
  phaseName: string,
): OfficialMatchday[] {
  const rounds: { teams: Set<string>; matches: ParsedCupMatch[] }[] = [];
  for (const match of matches) {
    let round = rounds.find((candidate) =>
      !candidate.teams.has(match.match.homeTeamName)
      && !candidate.teams.has(match.match.awayTeamName),
    );
    if (!round) {
      round = { teams: new Set(), matches: [] };
      rounds.push(round);
    }
    round.teams.add(match.match.homeTeamName);
    round.teams.add(match.match.awayTeamName);
    round.matches.push(match);
  }
  return rounds.map((round, index) => ({
    number: index + 1,
    phaseName,
    matches: round.matches.map(({ match }) => match),
  }));
}

export class EspnContinentalCupSource implements OfficialLeagueSource {
  async fetchSeason(league: OfficialLeagueId): Promise<OfficialLeagueSeason> {
    if (league !== "libertadores" && league !== "sudamericana") {
      throw new Error("La fuente continental solo admite Copa Libertadores y Copa Sudamericana.");
    }
    const config = configurations[league];
    let response: Response;
    try {
      response = await fetch(
        `${apiBaseUrl}/${config.slug}/scoreboard?dates=${seasonYear}&limit=1000`,
      );
    } catch (error) {
      const detail = error instanceof Error ? ` (${error.message})` : "";
      throw new Error(`No se pudo conectar con la API de ESPN.${detail}`);
    }
    if (!response.ok) {
      throw new Error(`La API de ESPN respondió con HTTP ${response.status}.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("La API de ESPN respondió con un formato JSON inválido para el calendario continental.");
    }
    const scoreboard = requireRecord(payload, "el calendario continental");
    if (!Array.isArray(scoreboard.events) || scoreboard.events.length === 0) {
      throw new Error(`ESPN no publicó partidos para ${config.name} ${seasonYear}.`);
    }
    const matches = scoreboard.events
      .map((event) => parseEvent(event, config))
      .filter((match): match is ParsedCupMatch => match !== undefined)
      .sort((first, second) => first.date - second.date);
    if (matches.length === 0) {
      throw new Error(`ESPN no publicó partidos importables para ${config.name} ${seasonYear}.`);
    }

    const matchdays: OfficialMatchday[] = [];
    const groupMatches = matches.filter((match) => match.phaseName.endsWith(config.groupStageName));
    if (groupMatches.length > 0) {
      matchdays.push(...groupStageMatches(groupMatches, `${config.name} · ${config.groupStageName}`));
    }
    const phaseGroups = new Map<string, ParsedCupMatch[]>();
    for (const match of matches) {
      if (!match.stageSlug) continue;
      const phaseMatches = phaseGroups.get(match.phaseName) ?? [];
      phaseMatches.push(match);
      phaseGroups.set(match.phaseName, phaseMatches);
    }
    for (const [phaseName, phaseMatches] of phaseGroups) {
      const stage = config.stages.find((candidate) => candidate.slug === phaseMatches[0].stageSlug);
      if (!stage) continue;
      matchdays.push({
        number: 1,
        phaseName,
        matches: phaseMatches.map(({ match }) => match),
      });
    }

    const knockoutStages = config.stages.map((stage) => ({
      name: `${config.name} · ${stage.name}`,
      legs: stage.legs,
      ...(stage.advanceWinners === false ? { advanceWinners: false } : {}),
    }));
    return {
      id: config.tournamentId,
      name: config.name,
      season: seasonYear,
      sourceUrl: config.sourceUrl,
      sourceName: "ESPN (API pública)",
      format: "staged",
      competitionType: "cup",
      knockoutStages,
      rulesNote: "Calendario y resultados de ESPN. Al completarse todas las tablas se clasifican primero y segundo de cada grupo de Libertadores a octavos, y tercero al playoff de Sudamericana; en Sudamericana clasifican primero directo a octavos y segundo al playoff contra esos terceros. Se conservan los cruces publicados por ESPN. Si aún no hay un sorteo publicado, se genera un emparejamiento reproducible compatible con la fase; no reemplaza el sorteo oficial. Eliminatorias a dos partidos por global y penales.",
      matchdays,
    };
  }
}
