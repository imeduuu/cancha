import { normalizeTeamName } from "@cancha/core/domain/services/team-name";
import type {
  OfficialLeagueId,
  OfficialLeagueSeason,
  OfficialLeagueSource,
  OfficialLeagueFetchOptions,
  OfficialLeagueZone,
  OfficialMatch,
  OfficialMatchday,
} from "@cancha/core/application/ports/official-league-source";

const argentinaFixtureUrl = "https://www.copaargentina.org/es/fixture.html";
const argentinaFeedPath = "/es/fixture/feed/editions.json";
const brazilCompetitionUrl = "https://www.cbf.com.br/futebol-brasileiro/tabelas/copa-do-brasil/masculino";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, description: string): JsonRecord {
  if (!isRecord(value)) {
    throw new Error(`La fuente oficial respondió sin ${description} válido.`);
  }
  return value;
}

function requireString(record: JsonRecord, field: string, description: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`La fuente oficial publicó ${description} sin ${field}.`);
  }
  return value.trim();
}

function parseScore(value: unknown, matchId: string, description: string): number {
  const score = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(score) || score < 0 || score > 99) {
    throw new Error(`La fuente oficial publicó ${description} inválidos para el partido ${matchId}.`);
  }
  return score;
}

async function fetchText(path: string, sourceName: string, headers?: HeadersInit, signal?: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(path, { headers, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    const detail = error instanceof Error ? ` (${error.message})` : "";
    throw new Error(`No se pudo conectar con ${sourceName}.${detail}`);
  }
  if (!response.ok) {
    throw new Error(`${sourceName} respondió con HTTP ${response.status}.`);
  }
  return response.text();
}

function parseCopaArgentinaMatch(value: unknown): OfficialMatch {
  const record = requireRecord(value, "un partido de Copa Argentina");
  const id = requireString(record, "id", "un partido de Copa Argentina");
  if (!Array.isArray(record.teams) || record.teams.length !== 2) {
    throw new Error(`La fuente oficial publicó el partido ${id} sin dos equipos.`);
  }
  const home = requireRecord(record.teams[0], `el equipo local del partido ${id}`);
  const away = requireRecord(record.teams[1], `el equipo visitante del partido ${id}`);
  const homeTeamName = requireString(home, "team_name", `el equipo local del partido ${id}`);
  const awayTeamName = requireString(away, "team_name", `el equipo visitante del partido ${id}`);
  const match: OfficialMatch = {
    id,
    homeTeamName,
    awayTeamName,
    knockoutResolution: "penalties",
  };
  if (record.match_status_text !== "Finalizado" && record.match_status !== "5" && record.match_status !== 5) {
    return match;
  }

  const homeGoals = parseScore(home.score, id, "los goles del equipo local");
  const awayGoals = parseScore(away.score, id, "los goles del equipo visitante");
  const homePenalties = parseScore(home.penalties ?? 0, id, "los penales del equipo local");
  const awayPenalties = parseScore(away.penalties ?? 0, id, "los penales del equipo visitante");
  return {
    ...match,
    homeGoals,
    awayGoals,
    ...(homePenalties > 0 || awayPenalties > 0
      ? { penalties: { homeGoals: homePenalties, awayGoals: awayPenalties } }
      : {}),
  };
}

export class CopaArgentinaOfficialSource implements OfficialLeagueSource {
  async fetchSeason(league: OfficialLeagueId): Promise<OfficialLeagueSeason> {
    if (league !== "copa-argentina") {
      throw new Error("La fuente Copa Argentina solo admite esa competencia.");
    }

    const editionsText = await fetchText(
      `/argentina-cup-source${argentinaFeedPath}`,
      "la fuente oficial Copa Argentina",
    );
    let editions: unknown;
    try {
      editions = JSON.parse(editionsText);
    } catch {
      throw new Error("La fuente oficial Copa Argentina respondió con un listado de ediciones inválido.");
    }
    if (!Array.isArray(editions)) {
      throw new Error("La fuente oficial Copa Argentina no publicó sus ediciones.");
    }
    const editionRecords = editions.map((value) => requireRecord(value, "una edición"));
    const edition = editionRecords.find(
      (value) => value.default === "1",
    ) ?? editionRecords[0];
    if (!edition) {
      throw new Error("La fuente oficial Copa Argentina no publicó ninguna edición.");
    }
    const season = Number(requireString(edition, "hash", "la edición actual"));
    if (!Number.isSafeInteger(season) || season < 1900) {
      throw new Error("La fuente oficial Copa Argentina publicó una temporada inválida.");
    }
    const feedPath = requireString(edition, "url", "la edición actual");
    if (!Array.isArray(edition.competition_seasons)) {
      throw new Error("La fuente oficial Copa Argentina no publicó las rondas de la edición actual.");
    }

    const phases = edition.competition_seasons.map((value) =>
      requireRecord(value, "una ronda de Copa Argentina"),
    );
    const phaseNames = new Map(
      phases.map((phase) => [
        requireString(phase, "id", "una ronda de Copa Argentina"),
        requireString(phase, "name", "una ronda de Copa Argentina"),
      ]),
    );
    const knockoutStages = [...phaseNames.values()].map((phaseName) => ({
      name: `Copa Argentina · ${phaseName}`,
      legs: 1 as const,
    }));
    if (!knockoutStages.some((stage) => stage.name.toLocaleLowerCase("es").endsWith("· final"))) {
      knockoutStages.push({ name: "Copa Argentina · Final", legs: 1 });
    }

    const feedText = await fetchText(
      `/argentina-cup-source${feedPath}`,
      "la fuente oficial Copa Argentina",
    );
    let feed: unknown;
    try {
      feed = JSON.parse(feedText);
    } catch {
      throw new Error("La fuente oficial Copa Argentina respondió con un fixture inválido.");
    }
    if (!Array.isArray(feed)) {
      throw new Error("La fuente oficial Copa Argentina no publicó su fixture.");
    }

    const grouped = new Map<string, OfficialMatch[]>();
    for (const value of feed) {
      const record = requireRecord(value, "un partido de Copa Argentina");
      const classId = requireString(record, "class", "un partido de Copa Argentina");
      const phaseName = phaseNames.get(classId);
      if (!phaseName) {
        throw new Error(`La fuente oficial asignó un partido a la ronda desconocida ${classId}.`);
      }
      const matches = grouped.get(phaseName) ?? [];
      matches.push(parseCopaArgentinaMatch(record));
      grouped.set(phaseName, matches);
    }

    const matchdays: OfficialMatchday[] = phases.flatMap((phase) => {
      const phaseId = requireString(phase, "id", "una ronda de Copa Argentina");
      const phaseName = phaseNames.get(phaseId);
      const matches = grouped.get(phaseName ?? "");
      return matches?.length
        ? [{
          number: 1,
          phaseName: `Copa Argentina · ${phaseName}`,
          matches,
        }]
        : [];
    });
    if (matchdays.length === 0) {
      throw new Error("No se encontraron partidos en la edición oficial de Copa Argentina.");
    }

    return {
      id: `afa-copa-argentina-${season}`,
      name: "Copa Argentina",
      season,
      sourceUrl: argentinaFixtureUrl,
      sourceName: "Copa Argentina (sitio oficial)",
      format: "staged",
      competitionType: "cup",
      knockoutStages,
      rulesNote: "Las rondas eliminatorias se disputan a partido único y los empates se definen por penales. Las fases siguientes se generan al completar todos los partidos de cada ronda.",
      matchdays,
    };
  }
}

interface CbfPhase {
  readonly fase_id: string;
  readonly fase_nome: string;
  readonly rodadas_qtd: string;
  readonly fase_tipo: string;
}

function parseFlightValue(
  payload: string,
  marker: string,
  opening: "[" | "{",
  searchFrom = 0,
): unknown {
  const markerIndex = payload.indexOf(marker, searchFrom);
  if (markerIndex < 0) {
    throw new Error(`La CBF respondió sin el campo ${marker.replace(/[^a-z]/gi, "")}.`);
  }
  const start = payload.indexOf(opening, markerIndex + marker.length);
  if (start < 0) {
    throw new Error(`La CBF publicó el campo ${marker.replace(/[^a-z]/gi, "")} sin datos válidos.`);
  }

  const closing = opening === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = start;
  for (; end < payload.length; end += 1) {
    const character = payload[end];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") inString = true;
    else if (character === opening) depth += 1;
    else if (character === closing) {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) {
    throw new Error(`La CBF respondió con el campo ${marker.replace(/[^a-z]/gi, "")} incompleto.`);
  }
  try {
    return JSON.parse(payload.slice(start, end + 1));
  } catch {
    throw new Error(`La CBF respondió con el campo ${marker.replace(/[^a-z]/gi, "")} inválido.`);
  }
}

function extractCbfPhases(payload: string): CbfPhase[] {
  const value = parseFlightValue(payload, "\"phasesList\":", "[");
  if (!Array.isArray(value)) {
    throw new Error("La CBF no publicó las fases de la Copa do Brasil.");
  }
  const phaseValues = value.filter(isRecord);
  const currentPhase = (() => {
    const marker = "\"phase\":";
    const markerIndex = payload.indexOf(marker);
    if (markerIndex < 0 || payload[markerIndex + marker.length] !== "{") return undefined;
    const current = parseFlightValue(payload, marker, "{");
    return isRecord(current) ? current : undefined;
  })();
  const phases = currentPhase ? [...phaseValues, currentPhase] : phaseValues;
  const unique = new Map<string, CbfPhase>();
  for (const phase of phases) {
    const id = requireString(phase, "fase_id", "una fase de Copa do Brasil");
    const name = requireString(phase, "fase_nome", "una fase de Copa do Brasil");
    unique.set(id, {
      fase_id: id,
      fase_nome: name,
      rodadas_qtd: requireString(phase, "rodadas_qtd", `la fase ${name}`),
      fase_tipo: requireString(phase, "fase_tipo", `la fase ${name}`),
    });
  }
  return [...unique.values()];
}

interface ParsedCbfMatch {
  readonly match: OfficialMatch;
  readonly round: number;
}

function extractCbfMatches(payload: string, phase: CbfPhase): JsonRecord[] {
  const firstMatch = payload.indexOf("\"id_jogo\"");
  if (firstMatch < 0) return [];
  const dataMarker = "\"data\":";
  const markerIndex = payload.lastIndexOf(dataMarker, firstMatch);
  if (markerIndex < 0) {
    throw new Error(`La CBF no publicó la lista de partidos para la fase ${phase.fase_nome}.`);
  }
  const value = parseFlightValue(payload, dataMarker, "[", markerIndex);
  if (!Array.isArray(value)) {
    throw new Error(`La CBF no publicó partidos para la fase ${phase.fase_nome}.`);
  }
  return value.filter(isRecord);
}

function parseCbfTeam(value: unknown, matchId: string, description: string, namesById?: ReadonlyMap<string, string>) {
  const team = requireRecord(value, `el equipo ${description} del partido ${matchId}`);
  return {
    name: (typeof team.id === "string" ? namesById?.get(team.id) : undefined)
      ?? cleanCbfClubName(requireString(team, "nome", `el equipo ${description} del partido ${matchId}`)),
    externalId: typeof team.id === "string" ? team.id : undefined,
    score: team.gols,
    penalties: team.panaltis,
  };
}

function cleanCbfClubName(name: string): string {
  return name.trim().replace(/\s+(?:-\s*)?SAF\.?$/i, "").trim();
}

function parseCbfMatch(value: JsonRecord, phase: CbfPhase, namesById?: ReadonlyMap<string, string>): ParsedCbfMatch {
  const id = requireString(value, "id_jogo", "un partido de Copa do Brasil");
  const round = Number(requireString(value, "rodada", `el partido ${id}`));
  if (!Number.isSafeInteger(round) || round < 1) {
    throw new Error(`La CBF publicó una jornada inválida para el partido ${id}.`);
  }
  const home = parseCbfTeam(value.mandante, id, "local", namesById);
  const away = parseCbfTeam(value.visitante, id, "visitante", namesById);
  const match: OfficialMatch = {
    id,
    homeTeamName: home.name,
    awayTeamName: away.name,
    ...(home.externalId ? { homeTeamExternalId: home.externalId } : {}),
    ...(away.externalId ? { awayTeamExternalId: away.externalId } : {}),
    ...(phase.fase_tipo === "eliminacao" && phase.rodadas_qtd === "1"
      ? { knockoutResolution: "penalties" as const }
      : {}),
  };
  if (home.score === null || home.score === undefined) {
    if (away.score === null || away.score === undefined) return { match, round };
    throw new Error(`La CBF publicó un marcador incompleto para el partido ${id}.`);
  }
  if (away.score === null || away.score === undefined) {
    throw new Error(`La CBF publicó un marcador incompleto para el partido ${id}.`);
  }
  const homeGoals = parseScore(home.score, id, "los goles del local");
  const awayGoals = parseScore(away.score, id, "los goles del visitante");
  const homePenalties = parseScore(home.penalties ?? 0, id, "los penales del local");
  const awayPenalties = parseScore(away.penalties ?? 0, id, "los penales del visitante");
  return {
    match: {
      ...match,
      homeGoals,
      awayGoals,
      ...((homeGoals === awayGoals || phase.rodadas_qtd === "2") && (homePenalties > 0 || awayPenalties > 0)
        ? {
          ...(phase.rodadas_qtd === "1" ? { knockoutResolution: "penalties" as const } : {}),
          penalties: { homeGoals: homePenalties, awayGoals: awayPenalties },
        }
        : {}),
    },
    round,
  };
}

export class CopaDoBrasilOfficialSource implements OfficialLeagueSource {
  async fetchSeason(league: OfficialLeagueId, _zone?: OfficialLeagueZone, options?: OfficialLeagueFetchOptions): Promise<OfficialLeagueSeason> {
    if (league !== "copa-brasil") {
      throw new Error("La fuente CBF solo admite la Copa do Brasil.");
    }
    const season = new Date().getFullYear();
    const seasonUrl = `${brazilCompetitionUrl}/${season}`;
    const route = `/brazil-cup-source/futebol-brasileiro/tabelas/copa-do-brasil/masculino/${season}`;
    const phasesPayload = await fetchText(route, "la página oficial de Copa do Brasil", { RSC: "1" }, options?.signal);
    const phases = extractCbfPhases(phasesPayload);
    if (phases.length === 0) {
      throw new Error("La CBF no publicó las fases disponibles de la Copa do Brasil.");
    }

    options?.onProgress?.({ current: 1, total: phases.length + 1, label: "Fases publicadas" });
    let completedPhases = 0;
    const publishedPhases = await Promise.all(phases.map(async phase => {
      const payload = await fetchText(`${route}/${phase.fase_id}`, "el fixture oficial de Copa do Brasil", { RSC: "1" }, options?.signal);
      const result = { phase, values: extractCbfMatches(payload, phase) };
      completedPhases += 1;
      options?.onProgress?.({ current: completedPhases + 1, total: phases.length + 1, label: `Fase: ${phase.fase_nome}` });
      return result;
    }));
    const originalNames = new Map<string, string>();
    for (const { values } of publishedPhases) for (const match of values) for (const side of [match.mandante, match.visitante]) {
      if (!isRecord(side) || typeof side.id !== "string" || !side.id.trim() || typeof side.nome !== "string") continue;
      originalNames.set(side.id, side.nome.trim());
    }
    const namesById = new Map([...originalNames].map(([id,name]) => [id, cleanCbfClubName(name)]));
    const phaseMatchdays = publishedPhases.map(({ phase, values }) => {
      const matches = values.map(value => parseCbfMatch(value, phase, namesById));
      const rounds = new Map<number, OfficialMatch[]>();
      for (const { match, round } of matches) {
        const roundMatches = rounds.get(round) ?? [];
        roundMatches.push(match);
        rounds.set(round, roundMatches);
      }
      return [...rounds.entries()].map(([number, roundMatches]) => ({
        number,
        phaseName: `Copa do Brasil · ${phase.fase_nome}`,
        matches: roundMatches,
      }));
    });

    const matchdays = phaseMatchdays.flat();
    if (matchdays.length === 0) {
      throw new Error("No se encontraron partidos publicados por la CBF para la Copa do Brasil.");
    }
    const knockoutStages = phases
      .filter((phase) => phase.fase_tipo === "eliminacao")
      .map((phase) => ({
        name: `Copa do Brasil · ${phase.fase_nome}`,
        legs: phase.rodadas_qtd === "2" ? 2 as const : 1 as const,
        // CBF 2026: direct entrants join phases 2, 3 and 5. Earlier winners
        // alone cannot define those brackets; keep their published fixtures.
        ...(season === 2026 && ["1995", "1996", "1998"].includes(phase.fase_id)
          ? { advanceWinners: false } : {}),
      }));
    return {
      id: `cbf-copa-do-brasil-${season}`,
      name: "Copa do Brasil Profissional",
      season,
      sourceUrl: seasonUrl,
      sourceName: "CBF (sitio oficial)",
      format: "staged",
      competitionType: "cup",
      knockoutStages,
      rulesNote: "Fases y cantidad de partidos por fase según el fixture oficial de la CBF. Las identidades internas de clubes conservan el identificador publicado por CBF. Las fases publicadas a dos partidos se resuelven por el marcador agregado y las siguientes se generan al completar cada ronda.",
      matchdays,
    };
  }
}
