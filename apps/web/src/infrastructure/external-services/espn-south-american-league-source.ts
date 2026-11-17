import type {
  OfficialLeagueId,
  OfficialLeagueSeason,
  OfficialLeagueSource,
  OfficialMatch,
  OfficialMatchday,
} from "@cancha/core/application/ports/official-league-source";
import { getArgentina2026TeamGroup } from "@cancha/core/domain/services/argentina-2026-team-groups";
import { parseEspnMatchOperationalStatus } from "./espn-match-status";
import { parseEspnSchedule } from "./espn-match-schedule";

import { REGULAR_PHASE } from "@cancha/core/domain/services/second-division-rules";
const seasonYear = 2026;
const apiBaseUrl = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const espnBaseUrl = "https://www.espn.com/soccer/fixtures/_/league/";
const leagues = {
  "argentina-nacional": {
    slug: "arg.2", id: "arg-primera-nacional-2026", name: "Primera Nacional Argentina",
    sourceUrl: `${espnBaseUrl}arg.2`, format: "staged", matchdaySize: 18,
  },
  "brasil-serie-b": {
    slug: "bra.2", id: "brasileirao-serie-b-2026", name: "Campeonato Brasileiro Série B",
    sourceUrl: `${espnBaseUrl}bra.2`, format: "staged", matchdaySize: 10,
  },
  "argentina-primera": {
    slug: "arg.1",
    id: "arg-liga-profesional-2026",
    name: "Liga Profesional Argentina · Temporada anual Apertura y Clausura",
    sourceUrl: `${espnBaseUrl}arg.1`,
    format: "staged",
    matchdaySize: 15,
  },
  "brasil-primera": {
    slug: "bra.1",
    id: "brasileirao-serie-a-2026",
    name: "Campeonato Brasileiro Série A",
    sourceUrl: `${espnBaseUrl}bra.1`,
    format: "staged",
    matchdaySize: 10,
  },
} as const;

type JsonRecord = Record<string, unknown>;

interface ParsedEspnMatch extends OfficialMatch {
  readonly date: string;
  readonly phaseName: string;
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

function getNestedRecord(record: JsonRecord, field: string, description: string): JsonRecord {
  return requireRecord(record[field], description);
}

function getArgentinaPhase(slug: string): string {
  if (slug === "torneo-apertura") {
    return "Torneo Apertura · Fase regular";
  }
  if (slug === "torneo-clausura") {
    return "Torneo Clausura · Fase regular";
  }

  const phase = slug.match(/^(apertura|clausura)---(.+)$/);
  if (!phase) {
    throw new Error(`La API de ESPN publicó una etapa argentina desconocida: ${slug}.`);
  }
  const stageNames: Readonly<Record<string, string>> = {
    "round-of-16": "Octavos de final",
    quarterfinals: "Cuartos de final",
    semifinals: "Semifinales",
    final: "Final",
  };
  const stageName = stageNames[phase[2]];
  if (!stageName) {
    throw new Error(`La API de ESPN publicó una ronda argentina desconocida: ${phase[2]}.`);
  }
  const tournamentName = phase[1] === "apertura" ? "Apertura" : "Clausura";
  return `Torneo ${tournamentName} · ${stageName}`;
}

function getPhaseName(league: OfficialLeagueId, event: JsonRecord, year = 2026): string {
  if (isRecord(event.season) && event.season.year !== undefined && event.season.year !== year)
    throw new Error("ESPN devolvió partidos de otra temporada.");
  if (year !== 2026) {
    const season = getNestedRecord(event, "season", "la temporada publicada");
    if (season.year !== year) throw new Error("ESPN devolvió partidos de otra temporada.");
    return requireString(season, "slug", "la fase publicada");
  }
  if (league === "argentina-nacional" || league === "brasil-serie-b") {
    const season = getNestedRecord(event, "season", "la temporada del partido");
    if (season.year !== 2026) throw new Error("ESPN devolvió partidos de otra temporada.");
    const slug = requireString(season, "slug", "la fase del partido");
    if ((league === "argentina-nacional" && slug === "regular-season")
      || (league === "brasil-serie-b" && slug === "2026-brasileiro-serie-b")) return REGULAR_PHASE;
    throw new Error(`La fase ${slug} de ESPN requiere verificar su correspondencia reglamentaria. No se importaron datos parciales.`);
  }
  if (league === "brasil-primera") {
    return "Brasileirão Série A";
  }

  const season = getNestedRecord(event, "season", "la temporada del partido");
  return getArgentinaPhase(requireString(season, "slug", "la etapa del partido"));
}

function parseScore(record: JsonRecord, field: string, matchId: string): number {
  const value = record[field];
  const score = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(score) || score < 0 || score > 99) {
    throw new Error(`La API de ESPN publicó un marcador inválido para el partido ${matchId}.`);
  }
  return score;
}

function getArgentinaTeamGroup(teamName: string): string {
  const groupName = getArgentina2026TeamGroup(teamName);
  if (!groupName) {
    throw new Error(`No se pudo asignar ${teamName} a una zona oficial argentina de 2026.`);
  }
  return groupName;
}

function parseExtraTimeAndPenaltyScores(
  competition: JsonRecord,
  homeTeamId: string,
  awayTeamId: string,
  homeFinalScore: number,
  awayFinalScore: number,
  matchId: string,
) {
  if (!Array.isArray(competition.details)) {
    throw new Error(`ESPN no publicó el detalle de goles del partido eliminatorio ${matchId}.`);
  }
  const goals = {
    homeGoals: 0,
    awayGoals: 0,
    extraTime: { homeGoals: 0, awayGoals: 0 },
    penalties: { homeGoals: 0, awayGoals: 0 },
  };
  for (const value of competition.details) {
    const detail = requireRecord(value, `un evento del partido ${matchId}`);
    if (detail.scoringPlay !== true || typeof detail.scoreValue !== "number") {
      continue;
    }
    const team = getNestedRecord(detail, "team", `el equipo que anotó en ${matchId}`);
    const teamId = requireString(team, "id", `el equipo que anotó en ${matchId}`);
    const side = teamId === homeTeamId ? "home" : teamId === awayTeamId ? "away" : undefined;
    if (!side) {
      throw new Error(`ESPN publicó un gol de un equipo desconocido en el partido ${matchId}.`);
    }
    if (detail.shootout === true) {
      goals.penalties[`${side}Goals`] += detail.scoreValue;
      continue;
    }

    const clock = getNestedRecord(detail, "clock", `el minuto del gol en ${matchId}`);
    const displayValue = requireString(clock, "displayValue", `el minuto del gol en ${matchId}`);
    const minute = Number(displayValue.match(/^\d+/)?.[0]);
    if (!Number.isInteger(minute)) {
      throw new Error(`ESPN publicó un minuto inválido para un gol del partido ${matchId}.`);
    }
    if (minute > 90 && !/^90\+/.test(displayValue)) {
      goals.extraTime[`${side}Goals`] += detail.scoreValue;
    } else {
      goals[`${side}Goals`] += detail.scoreValue;
    }
  }
  if (
    goals.homeGoals + goals.extraTime.homeGoals !== homeFinalScore
    || goals.awayGoals + goals.extraTime.awayGoals !== awayFinalScore
  ) {
    throw new Error(`Los goles publicados no coinciden con el marcador final del partido ${matchId}.`);
  }
  return {
    homeGoals: goals.homeGoals,
    awayGoals: goals.awayGoals,
    ...(goals.extraTime.homeGoals > 0 || goals.extraTime.awayGoals > 0
      ? { extraTime: goals.extraTime }
      : {}),
    ...(goals.penalties.homeGoals > 0 || goals.penalties.awayGoals > 0
      ? { penalties: goals.penalties }
      : {}),
  };
}

function parseEvent(
  league: OfficialLeagueId,
  value: unknown,
  year = 2026,
): ParsedEspnMatch | undefined {
  const event = requireRecord(value, "un partido");
  const id = requireString(event, "id", "un partido");
  const date = requireString(event, "date", `la fecha del partido ${id}`);
  const schedule = parseEspnSchedule(date, id);
  if (!Number.isFinite(Date.parse(date))) {
    throw new Error(`La API de ESPN publicó una fecha inválida para el partido ${id}.`);
  }

  const competitions = event.competitions;
  if (!Array.isArray(competitions) || competitions.length === 0) {
    throw new Error(`La API de ESPN publicó el partido ${id} sin competencia.`);
  }
  const competition = requireRecord(competitions[0], `la competencia del partido ${id}`);
  const status = getNestedRecord(competition, "status", `el estado del partido ${id}`);
  const statusType = getNestedRecord(status, "type", `el estado del partido ${id}`);
  const statusName = typeof statusType.name === "string" ? statusType.name : "";
  const operationalStatus = parseEspnMatchOperationalStatus(statusType, id);
  if (operationalStatus === "abandoned") {
    return undefined;
  }
  const competitors = competition.competitors;
  if (!Array.isArray(competitors) || competitors.length !== 2) {
    throw new Error(`La API de ESPN publicó el partido ${id} sin dos equipos.`);
  }

  const phaseName = getPhaseName(league, event, year);
  const isArgentinaKnockout = year === 2026 && league === "argentina-primera"
    && !phaseName.endsWith("Fase regular");
  let homeTeamName: string | undefined;
  let awayTeamName: string | undefined;
  let homeTeamId: string | undefined;
  let awayTeamId: string | undefined;
  let homeGoals: number | undefined;
  let awayGoals: number | undefined;
  for (const value of competitors) {
    const competitor = requireRecord(value, `un equipo del partido ${id}`);
    const side = requireString(competitor, "homeAway", `un equipo del partido ${id}`);
    const team = getNestedRecord(competitor, "team", `un equipo del partido ${id}`);
    const teamName = requireString(team, "displayName", `un equipo del partido ${id}`);
    if ((league === "argentina-nacional" || league === "brasil-serie-b")
      && /^(?:TBD(?: Home| Away)?|To Be Determined)$/i.test(teamName)) return undefined;
    const teamId = requireString(team, "id", `un equipo del partido ${id}`);
    if (side === "home") {
      homeTeamName = teamName;
      homeTeamId = teamId;
      if (operationalStatus === "finished") {
        homeGoals = parseScore(competitor, "score", id);
      }
    } else if (side === "away") {
      awayTeamName = teamName;
      awayTeamId = teamId;
      if (operationalStatus === "finished") {
        awayGoals = parseScore(competitor, "score", id);
      }
    } else {
      throw new Error(`La API de ESPN publicó una localía inválida para el partido ${id}.`);
    }
  }
  if (!homeTeamName || !awayTeamName || !homeTeamId || !awayTeamId) {
    throw new Error(`La API de ESPN publicó el partido ${id} sin local o visitante.`);
  }

  let extraTime: ParsedEspnMatch["extraTime"];
  let penalties: ParsedEspnMatch["penalties"];
  let knockoutResolution: ParsedEspnMatch["knockoutResolution"];
  const isAfterExtraTime = /FINAL_AET|FINAL_PEN/i.test(statusName);
  if (operationalStatus === "finished" && isArgentinaKnockout && isAfterExtraTime) {
    const finalHomeGoals = homeGoals;
    const finalAwayGoals = awayGoals;
    if (finalHomeGoals === undefined || finalAwayGoals === undefined) {
      throw new Error(`ESPN no publicó el marcador final del partido eliminatorio ${id}.`);
    }
    const extendedScore = parseExtraTimeAndPenaltyScores(
      competition,
      homeTeamId,
      awayTeamId,
      finalHomeGoals,
      finalAwayGoals,
      id,
    );
    homeGoals = extendedScore.homeGoals;
    awayGoals = extendedScore.awayGoals;
    extraTime = extendedScore.extraTime;
    penalties = extendedScore.penalties;
    knockoutResolution = statusName.includes("FINAL_AET")
      || (penalties && (extraTime?.homeGoals || extraTime?.awayGoals))
      ? "extra-time-then-penalties"
      : "penalties";
  }
  if (isArgentinaKnockout && !knockoutResolution) {
    knockoutResolution = "extra-time-then-penalties";
  }

  const match: ParsedEspnMatch = {
    id,
    date,
    schedule,
    phaseName,
    operationalStatus,
    homeTeamName,
    awayTeamName,
    ...(year === 2026 && league === "argentina-primera"
      ? {
        homeGroupName: getArgentinaTeamGroup(homeTeamName),
        awayGroupName: getArgentinaTeamGroup(awayTeamName),
      }
      : {}),
    ...(knockoutResolution
      ? { knockoutResolution }
      : {}),
    ...(homeGoals !== undefined && awayGoals !== undefined ? { homeGoals, awayGoals } : {}),
    ...(extraTime ? { extraTime } : {}),
    ...(penalties ? { penalties } : {}),
  };
  return match;
}

function groupMatchdays(
  league: OfficialLeagueId,
  matches: readonly ParsedEspnMatch[],
  regularMatchdaySize: number,
): OfficialMatchday[] {
  const phases = new Map<string, ParsedEspnMatch[]>();
  for (const match of matches) {
    const phaseMatches = phases.get(match.phaseName) ?? [];
    phaseMatches.push(match);
    phases.set(match.phaseName, phaseMatches);
  }

  const matchdays: OfficialMatchday[] = [];
  for (const [phaseName, phaseMatches] of phases) {
    const isRegularSeason = phaseName.endsWith("Fase regular")
      || phaseName === "Brasileirão Série A";
    const matchdaySize = isRegularSeason
      ? regularMatchdaySize
      : phaseMatches.length;
    if (league === "brasil-primera" && phaseName === "Brasileirão Série A") {
      matchdays.push(...createBrazilianMatchdays(phaseMatches));
      continue;
    }

    const rounds: { teams: Set<string>; matches: ParsedEspnMatch[] }[] = [];
    for (const match of phaseMatches) {
      let round = rounds.find((candidate) =>
        candidate.matches.length < matchdaySize
        && !candidate.teams.has(match.homeTeamName)
        && !candidate.teams.has(match.awayTeamName),
      );
      if (!round) {
        round = { teams: new Set(), matches: [] };
        rounds.push(round);
      }
      round.matches.push(match);
      round.teams.add(match.homeTeamName);
      round.teams.add(match.awayTeamName);
    }
    matchdays.push(...rounds.map((round, index) => ({
      number: index + 1,
      phaseName,
      matches: round.matches,
    })));
  }
  return matchdays;
}

function getTeamPairKey(firstTeam: string, secondTeam: string): string {
  return [firstTeam, secondTeam].sort((first, second) => first.localeCompare(second)).join("\u0000");
}

function createBrazilianMatchdays(matches: readonly ParsedEspnMatch[]): OfficialMatchday[] {
  const teamNames = [...new Set(matches.flatMap((match) => [
    match.homeTeamName,
    match.awayTeamName,
  ]))].sort((first, second) => first.localeCompare(second));
  if (teamNames.length < 2 || teamNames.length % 2 !== 0) {
    throw new Error("No se pudieron organizar las fechas del Brasileirão por parejas de equipos.");
  }

  const matchdayByPair = new Map<string, number>();
  // ESPN omits jornada numbers, so rebuild a coherent 19+19 calendar from team pairings.
  let rotation = [...teamNames];
  for (let matchday = 1; matchday < teamNames.length; matchday += 1) {
    for (let index = 0; index < teamNames.length / 2; index += 1) {
      const firstTeam = rotation[index];
      const secondTeam = rotation[rotation.length - index - 1];
      matchdayByPair.set(getTeamPairKey(firstTeam, secondTeam), matchday);
    }
    rotation = [
      rotation[0],
      rotation[rotation.length - 1],
      ...rotation.slice(1, -1),
    ];
  }

  const activeMatches = matches.filter((match) => match.operationalStatus !== "postponed");
  const activeMatchesByPair = new Map<string, number>();
  for (const match of activeMatches) {
    const pairKey = getTeamPairKey(match.homeTeamName, match.awayTeamName);
    activeMatchesByPair.set(pairKey, (activeMatchesByPair.get(pairKey) ?? 0) + 1);
  }
  const missingReturnFixtures = matches.filter((match) =>
    match.operationalStatus === "postponed"
    && activeMatchesByPair.get(getTeamPairKey(match.homeTeamName, match.awayTeamName)) === 1,
  );
  const orderedMatches = [...activeMatches, ...missingReturnFixtures].sort(
    (first, second) => Date.parse(first.date) - Date.parse(second.date),
  );
  const matchCountsByPair = new Map<string, number>();
  const matchesByMatchday = new Map<number, ParsedEspnMatch[]>();
  for (const match of orderedMatches) {
    const pairKey = getTeamPairKey(match.homeTeamName, match.awayTeamName);
    const firstLegMatchday = matchdayByPair.get(pairKey);
    if (firstLegMatchday === undefined) {
      throw new Error(`No se pudo asignar la fecha del partido ${match.id} en el Brasileirão.`);
    }
    const leg = matchCountsByPair.get(pairKey) ?? 0;
    if (leg > 1) {
      throw new Error(`ESPN publicó más de dos partidos entre ${match.homeTeamName} y ${match.awayTeamName}.`);
    }
    const matchday = firstLegMatchday + (leg === 0 ? 0 : teamNames.length - 1);
    const roundMatches = matchesByMatchday.get(matchday) ?? [];
    roundMatches.push(match);
    matchesByMatchday.set(matchday, roundMatches);
    matchCountsByPair.set(pairKey, leg + 1);
  }

  return [...matchesByMatchday]
    .sort(([first], [second]) => first - second)
    .map(([number, roundMatches]) => ({
      number,
      phaseName: "Brasileirão Série A",
      matches: roundMatches,
    }));
}

export class EspnSouthAmericanLeagueSource implements OfficialLeagueSource {
  /** Imports published events only; no future sporting format is inferred. */
  async fetchPublishedSeason(league: OfficialLeagueId, year: number): Promise<OfficialLeagueSeason> {
    if (!(league in leagues) || !Number.isSafeInteger(year) || year < 2027 || year > 2100)
      throw new Error("Competición o año no admitidos para calendarios posteriores a 2026.");
    const config = leagues[league as keyof typeof leagues];
    const response = await fetch(`${apiBaseUrl}/${config.slug}/scoreboard?dates=${year}&limit=1000`);
    if (!response.ok) throw new Error(`ESPN respondió HTTP ${response.status}.`);
    const payload = requireRecord(await response.json(), "el calendario");
    if (!Array.isArray(payload.events) || !payload.events.length) throw new Error(`No hay calendario publicado para ${year}.`);
    const matches = payload.events.map(event => {
      const record = requireRecord(event, "el partido");
      const season = getNestedRecord(record, "season", "la temporada");
      if (season.year !== year) throw new Error("El proveedor devolvió otra temporada.");
      const parsed = parseEvent(league, event, year);
      // Future extra-time/shootout semantics require documented rules. Never guess the regulation score.
      const competitions = record.competitions as JsonRecord[];
      const status = getNestedRecord(getNestedRecord(competitions[0], "status", "estado"), "type", "tipo de estado");
      if (/FINAL_AET|FINAL_PEN/i.test(String(status.name))) throw new Error("El calendario contiene un resultado con prórroga o penales que requiere revisión específica.");
      return parsed;
    }).filter((m): m is ParsedEspnMatch => !!m);
    if (!matches.length || new Set(matches.map(m => m.id)).size !== matches.length) throw new Error("Calendario vacío o con partidos duplicados.");
    // A roster endpoint avoids interpreting teams absent from a partial scoreboard as relegated.
    const rosterResponse = await fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${config.slug}/standings?season=${year}`);
    if (!rosterResponse.ok) throw new Error("No se pudo consultar la nómina publicada; no se modificaron participantes.");
    const roster = requireRecord(await rosterResponse.json(), "los participantes");
    const teams: { name: string; groupName?: string }[] = [];
    const collect = (node: JsonRecord, grouped: boolean) => {
      if (node.standings !== undefined) {
        const standings = requireRecord(node.standings, "la tabla publicada");
        if (standings.season !== year || !Array.isArray(standings.entries)) throw new Error("La nómina publicada no acredita el año solicitado.");
        const groupName = grouped ? requireString(node, "name", "el grupo publicado") : undefined;
        for (const value of standings.entries) {
          const entry = requireRecord(value, "un participante");
          const team = getNestedRecord(entry, "team", "el club");
          teams.push({ name: requireString(team, "displayName", "el club"), ...(groupName ? { groupName } : {}) });
        }
      }
      if (Array.isArray(node.children)) for (const child of node.children) collect(requireRecord(child, "un grupo"), true);
    };
    collect(roster, false);
    if (!teams.length) throw new Error("La nómina publicada está vacía.");
    const names = new Set(teams.map(team => team.name));
    if (matches.some(m => !names.has(m.homeTeamName) || !names.has(m.awayTeamName))) throw new Error("Los partidos y la nómina del proveedor no coinciden.");
    return { id: config.id.replace(/2026$/, String(year)), name: `${config.name} ${year}`, season: year,
      sourceUrl: `${config.sourceUrl}/season/${year}`, sourceName: "ESPN (proveedor externo)", coverage: "unknown",
      format: "staged", competitionType: "league", teams,
      rulesNote: "Calendario publicado por el proveedor. Numeración local por evento; reglamento anual independiente y pendiente.",
      matchdays: matches.sort((a,b) => Date.parse(a.date)-Date.parse(b.date)).map((match,index) => ({ number:index+1, phaseName:match.phaseName, matches:[match] })) };
  }

  async fetchSeason(league: OfficialLeagueId): Promise<OfficialLeagueSeason> {
    if (league !== "argentina-primera" && league !== "brasil-primera"
      && league !== "argentina-nacional" && league !== "brasil-serie-b") {
      throw new Error("La fuente ESPN solo admite Primera División de Argentina y Brasil.");
    }
    const config = leagues[league];
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}/${config.slug}/scoreboard?dates=${seasonYear}&limit=1000`);
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
      throw new Error("La API de ESPN respondió con un formato JSON inválido para el calendario.");
    }
    const scoreboard = requireRecord(payload, "el calendario");
    if (!Array.isArray(scoreboard.events) || scoreboard.events.length === 0) {
      throw new Error(`ESPN no publicó partidos para ${config.name} ${seasonYear}.`);
    }
    const matches = scoreboard.events
      .map((event) => parseEvent(league, event))
      .filter((match): match is ParsedEspnMatch => match !== undefined)
      .sort((first, second) => Date.parse(first.date) - Date.parse(second.date));
    if (matches.length === 0) {
      throw new Error(`ESPN no publicó partidos importables para ${config.name} ${seasonYear}.`);
    }
    const ids = new Set<string>();
    for (const match of matches) {
      if (ids.has(match.id)) {
        throw new Error(`La API de ESPN repitió el partido ${match.id}.`);
      }
      ids.add(match.id);
    }

    if (league === "argentina-nacional" || league === "brasil-serie-b") {
      const teamNames = [...new Set(matches.flatMap(match => [match.homeTeamName, match.awayTeamName]))];
      if (teamNames.length !== (league === "argentina-nacional" ? 36 : 20))
        throw new Error("ESPN no publicó todos los participantes esperados de la segunda división 2026.");
      let teams: OfficialLeagueSeason["teams"] = teamNames.map(name => ({ name }));
      if (league === "argentina-nacional") {
        const response = await fetch(`https://site.api.espn.com/apis/v2/sports/soccer/arg.2/standings?season=2026`);
        if (!response.ok) throw new Error("No se pudieron consultar las zonas de Primera Nacional en ESPN.");
        const payload = requireRecord(await response.json(), "las zonas de Primera Nacional");
        if (!Array.isArray(payload.children)) throw new Error("ESPN no publicó las zonas de Primera Nacional.");
        const membership = new Map<string, string>();
        for (const item of payload.children) {
          const group = requireRecord(item, "una zona");
          const groupName = group.name === "Group A" ? "Zona A" : group.name === "Group B" ? "Zona B" : undefined;
          if (!groupName) throw new Error("ESPN publicó una zona desconocida de Primera Nacional.");
          const standings = requireRecord(group.standings, "la tabla de zona");
          if (standings.season !== 2026 || !Array.isArray(standings.entries) || standings.entries.length !== 18)
            throw new Error("Las zonas de ESPN no corresponden a los 36 participantes de 2026.");
          for (const entry of standings.entries) {
            const team = requireRecord(requireRecord(entry, "un participante").team, "un equipo");
            const name = requireString(team, "displayName", "un equipo");
            if (membership.has(name)) throw new Error("ESPN repiti? un equipo en sus zonas.");
            membership.set(name, groupName);
          }
        }
        if (membership.size !== 36 || teamNames.some(name => !membership.has(name)))
          throw new Error("El calendario y las zonas de ESPN no coinciden.");
        teams = teamNames.map(name => ({ name, groupName: membership.get(name)! }));
      }
      const matchdays = league === "brasil-serie-b"
        ? createBrazilianMatchdays(matches).map(day => ({ ...day, phaseName: REGULAR_PHASE }))
        : groupMatchdays(league, matches, 18);
      return {
        id: config.id, name: config.name, season: 2026, sourceUrl: config.sourceUrl,
        sourceName: "ESPN (proveedor externo, API pública)", format: "staged", competitionType: "league",
        coverage: "unknown", teams, matchdays,
        rulesNote: "Datos de ESPN, proveedor externo. Jornadas reorganizadas localmente; no representan el orden oficial. Los cruces de ascenso se calculan al completar la fase regular según el reglamento 2026. No se inventan resultados ni sorteos oficiales.",
        placementRules: league === "brasil-serie-b"
          ? { championPlaces: 1, playoffPlaces: { from: 3, to: 6 }, relegationPlaces: 4,
              note: "1.º y 2.º ascienden directamente; 3.º–6.º disputan dos playoffs a ida y vuelta con ventaja por clasificación, sin penales ni final adicional." }
          : { playoffPlaces: { from: 2, to: 8 }, relegationPlaces: 2,
              note: "Por zona: 1.º a la final por el primer ascenso; 2.º–8.º al Reducido; dos últimos descienden, sujetos a desempate por puntos (art. 111)." },
      };
    }
    return {
      id: config.id,
      name: config.name,
      season: seasonYear,
      sourceUrl: config.sourceUrl,
      sourceName: "ESPN (API pública)",
      format: config.format,
      matchdays: groupMatchdays(league, matches, config.matchdaySize),
      ...(league === "argentina-primera"
        ? {
          placementRules: {
            championPlaces: 1,
            libertadoresPlaces: { from: 2, to: 2 },
            libertadoresQualifyingPlaces: { from: 3, to: 3 },
            sudamericanaPlaces: { from: 4, to: 9 },
            relegationPlaces: 1,
          },
          rulesNote: "Descienden el último por promedios de las últimas tres temporadas y el último de la tabla anual. Si es el mismo club, también desciende el penúltimo anual. Esta tabla no calcula promedios. Las plazas internacionales mostradas son las posiciones base de la tabla anual; pueden correrse por campeones de Apertura, Clausura o Copa Argentina y la app aún no calcula esos corrimientos.",
        }
        : {}),
      ...(league === "brasil-primera"
        ? {
          placementRules: {
            championPlaces: 1,
            libertadoresPlaces: { from: 1, to: 4 },
            libertadoresQualifyingPlaces: { from: 5, to: 6 },
            sudamericanaPlaces: { from: 7, to: 12 },
            relegationPlaces: 4,
          },
          rulesNote: "Plazas base por posición: los puestos pueden correrse si los campeones de copas ya clasificaron por otra vía.",
        }
        : {}),
    };
  }
}
