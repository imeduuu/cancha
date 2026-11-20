import type {
  OfficialLeagueId,
  OfficialLeagueSeason,
  OfficialLeagueSource,
  OfficialLeagueZone,
  OfficialMatch,
  OfficialMatchday,
} from "@cancha/core/application/ports/official-league-source";

const seasonYear = 2026;
const sourceBaseUrl = "https://anfaterceradivision.cl/assets/php/";
const roundRobinCalendars = {
  "tercera-a": {
    id: "anfa-tercera-a-2026",
    name: "Tercera A Nacional",
    path: "calendario_ta.php",
    roundQuery: "j",
    tableIndex: 0,
    sourceUrl: `${sourceBaseUrl}calendario_ta.php`,
    placementRules: {
      championPlaces: 1,
      playoffPlaces: { from: 2, to: 5 },
      relegationPlayoffPlaces: { from: 11, to: 12 },
      relegationPlaces: 2,
    },
  },
  "tercera-b-norte": {
    id: "anfa-tercera-b-norte-2026",
    name: "Tercera B Norte",
    path: "calendario.php",
    roundQuery: "j38",
    tableIndex: 1,
    sourceUrl: `${sourceBaseUrl}perfil_campeonato_tbn.php`,
    placementRules: {
      championPlaces: 1,
      playoffPlaces: { from: 2, to: 3 },
      relegationPlaces: 2,
    },
  },
  "tercera-b-sur": {
    id: "anfa-tercera-b-sur-2026",
    name: "Tercera B Sur",
    path: "calendario.php",
    roundQuery: "j39",
    tableIndex: 2,
    sourceUrl: `${sourceBaseUrl}perfil_campeonato_tbs.php`,
    placementRules: {
      championPlaces: 1,
      playoffPlaces: { from: 2, to: 3 },
      relegationPlaces: 2,
    },
  },
} as const;

type ThirdDivisionCalendar = (typeof roundRobinCalendars)[keyof typeof roundRobinCalendars];

const maximumConcurrentRequests = 5;

function getCalendar(
  league: OfficialLeagueId,
  zone?: OfficialLeagueZone,
): ThirdDivisionCalendar {
  if (league === "tercera-a" && !zone) {
    return roundRobinCalendars["tercera-a"];
  }
  if (league === "tercera-b" && zone === "norte") {
    return roundRobinCalendars["tercera-b-norte"];
  }
  if (league === "tercera-b" && zone === "sur") {
    return roundRobinCalendars["tercera-b-sur"];
  }
  if (league === "tercera-b") {
    throw new Error("Selecciona la zona norte o la zona sur de Tercera B.");
  }
  throw new Error("La selección de zona solo está disponible para Tercera B.");
}

function parseRoundCount(html: string, roundQuery: string): number {
  const document = new DOMParser().parseFromString(html, "text/html");
  const roundNumbers = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
    .flatMap((anchor) => {
      const url = new URL(anchor.href, sourceBaseUrl);
      const value = Number(url.searchParams.get(roundQuery));
      return Number.isSafeInteger(value) && value > 0 ? [value] : [];
    });
  const maxRound = Math.max(0, ...roundNumbers);

  if (maxRound === 0) {
    throw new Error("La fuente oficial de ANFA no publicó la paginación de jornadas.");
  }
  return maxRound;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function createMatchId(
  roundNumber: number,
  homeTeamName: string,
  awayTeamName: string,
): string {
  const slug = (value: string) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `anfa-j${roundNumber}-${slug(homeTeamName)}-${slug(awayTeamName)}`;
}

function parseGoalScore(value: string, matchId: string): Pick<OfficialMatch, "homeGoals" | "awayGoals"> | undefined {
  if (!value || /^VS$/i.test(value.trim())) {
    return undefined;
  }

  const score = value.match(/^\s*(\d{1,2})\s*[-–]\s*(\d{1,2})\s*$/);
  if (!score) {
    throw new Error(`La fuente oficial publicó un marcador inválido para el partido ${matchId}.`);
  }

  const homeGoals = Number(score[1]);
  const awayGoals = Number(score[2]);
  if (homeGoals > 99 || awayGoals > 99) {
    throw new Error(`La fuente oficial publicó un marcador inválido para el partido ${matchId}.`);
  }
  return { homeGoals, awayGoals };
}

function parseMatchday(html: string, calendar: ThirdDivisionCalendar, roundNumber: number): OfficialMatchday {
  const document = new DOMParser().parseFromString(html, "text/html");
  const tables = Array.from(document.querySelectorAll("table.table-striped.table-responsive.table-hover"));
  const table = tables[calendar.tableIndex];
  if (!table) {
    throw new Error(`No se encontró el calendario oficial de ${calendar.name} en la jornada ${roundNumber}.`);
  }

  const matches = Array.from(table.querySelectorAll("tbody tr")).flatMap((row) => {
    const cells = Array.from(row.querySelectorAll(":scope > td"));
    if (cells.length < 4) {
      return [];
    }

    const publishedRound = Number(normalizeText(cells[0].textContent ?? ""));
    if (publishedRound !== roundNumber) {
      throw new Error(
        `ANFA respondió con la jornada ${publishedRound} al consultar la jornada ${roundNumber} de ${calendar.name}.`,
      );
    }

    const homeTeamName = normalizeText(
      cells[1].querySelector(".team-cell strong")?.textContent ?? "",
    );
    const awayTeamName = normalizeText(
      cells[3].querySelector(".team-cell strong")?.textContent ?? "",
    );
    if (!homeTeamName || !awayTeamName) {
      throw new Error(`La jornada ${roundNumber} de ${calendar.name} contiene un equipo sin nombre.`);
    }

    const id = createMatchId(roundNumber, homeTeamName, awayTeamName);
    const resultText = normalizeText(cells[2].querySelector(".resultado-box")?.textContent ?? "");
    const result = parseGoalScore(resultText, id);
    return [{
      id,
      homeTeamName,
      awayTeamName,
      ...(result ?? {}),
    }];
  });

  if (matches.length === 0) {
    throw new Error(`La jornada ${roundNumber} de ${calendar.name} no contiene partidos oficiales.`);
  }

  return { number: roundNumber, matches };
}

async function mapConcurrent<T>(
  values: readonly number[],
  concurrency: number,
  map: (value: number) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await map(values[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}

/**
 * Desde noviembre de 2026 anfaterceradivision.cl muestra una página de
 * mantenimiento y sus calendarios (`assets/php/*.php`) responden 404. El
 * importador sigue esperando el formato anterior: si el sitio vuelve igual,
 * importa sin cambios; mientras tanto, el error lo explica.
 */
export function anfaCalendarUnavailableMessage(calendarName: string): string {
  return `ANFA Tercera División ya no publica el calendario de ${calendarName} (HTTP 404): `
    + "su sitio está en mantenimiento. Intenta más tarde o crea el torneo manualmente.";
}

/**
 * 404 del sitio: directo (verify:live) o reenviado por el proxy de fuentes
 * oficiales, que lo responde como 502 con "La fuente oficial respondió con HTTP 404.".
 */
async function isMissingCalendar(response: Response): Promise<boolean> {
  if (response.status === 404) return true;
  if (response.status !== 502) return false;
  const body = await response.text().catch(() => "");
  return /respondió con HTTP 404\.?\s*$/.test(body);
}

export class AnfaThirdDivisionSource implements OfficialLeagueSource {
  async fetchSeason(
    league: OfficialLeagueId,
    zone?: OfficialLeagueZone,
  ): Promise<OfficialLeagueSeason> {
    const calendar = getCalendar(league, zone);
    const initialHtml = await this.fetchCalendarPage(calendar);
    const maxRound = parseRoundCount(initialHtml, calendar.roundQuery);
    const rounds = Array.from({ length: maxRound }, (_, index) => index + 1);
    const matchdays = await mapConcurrent(
      rounds,
      maximumConcurrentRequests,
      async (roundNumber) => parseMatchday(
        await this.fetchCalendarPage(calendar, roundNumber),
        calendar,
        roundNumber,
      ),
    );

    return {
      id: calendar.id,
      name: calendar.name,
      season: seasonYear,
      sourceUrl: calendar.sourceUrl,
      sourceName: "ANFA Tercera División",
      format: "round-robin",
      placementRules: calendar.placementRules,
      ...(zone ? { zoneName: zone === "norte" ? "Zona Norte" : "Zona Sur" } : {}),
      matchdays,
    };
  }

  private async fetchCalendarPage(
    calendar: ThirdDivisionCalendar,
    roundNumber?: number,
  ): Promise<string> {
    const roundParam = roundNumber ? `?${calendar.roundQuery}=${roundNumber}` : "";
    let response: Response;
    try {
      response = await fetch(
        `/third-division-source/assets/php/${calendar.path}${roundParam}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? ` (${error.message})` : "";
      throw new Error(
        `No se pudo conectar con ANFA Tercera División. Comprueba la conexión y el proxy del servidor.${detail}`,
      );
    }

    if (!response.ok) {
      if (await isMissingCalendar(response)) {
        throw new Error(anfaCalendarUnavailableMessage(calendar.name));
      }
      throw new Error(
        `ANFA Tercera División respondió con HTTP ${response.status} al consultar ${calendar.name}.`,
      );
    }
    return response.text();
  }
}
