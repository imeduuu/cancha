import type {
  OfficialLeagueId,
  OfficialLeagueZone,
  OfficialLeagueSeason,
  OfficialLeagueSource,
  OfficialMatch,
  OfficialMatchday,
} from "../../application/ports/official-league-source";
import { normalizeTeamName } from "../../domain/services/team-name";

interface LeaguePageConfig {
  readonly id: string;
  readonly name: string;
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly path: string;
  readonly format: "round-robin" | "staged";
  readonly placementRules?: OfficialLeagueSeason["placementRules"];
}

const leaguePages: Record<"primera" | "primera-b" | "segunda" | "copa-chile" | "copa-liga", LeaguePageConfig> = {
  primera: {
    id: "anfp-liga-primera-2026",
    name: "Liga de Primera Mercado Libre",
    sourceName: "Campeonato Chileno",
    sourceUrl: "https://www.campeonatochileno.cl/ligas/liga-de-primera-mercado-libre/",
    path: "/ligas/liga-de-primera-mercado-libre/",
    format: "round-robin",
    placementRules: {
      championPlaces: 1,
      libertadoresPlaces: { from: 1, to: 2 },
      libertadoresQualifyingPlaces: { from: 3, to: 3 },
      sudamericanaPlaces: { from: 4, to: 6 },
      relegationPlaces: 2,
      note: "Cupos base 2027: 1.º y 2.º de liga a Libertadores; 3.º disputa un partido único contra el campeón de Copa Chile por el cupo Chile 4, cuyo perdedor va a Sudamericana. 4.º–6.º clasifican a Sudamericana. El campeón de Copa de la Liga obtiene Chile 3. La app no calcula esos campeones, el partido por Chile 4 ni los corrimientos de cupos.",
    },
  },
  "primera-b": {
    id: "anfp-liga-de-ascenso-2026",
    name: "Campeonato de Ascenso Caixun",
    sourceName: "Campeonato Chileno",
    sourceUrl: "https://www.campeonatochileno.cl/competition/campeonato-de-ascenso-caixun-2026/",
    path: "/competition/campeonato-de-ascenso-caixun-2026/",
    format: "round-robin",
    placementRules: {
      championPlaces: 1,
      playoffPlaces: { from: 2, to: 8 },
      relegationPlaces: 1,
    },
  },
  segunda: {
    id: "anfp-liga-segunda-2026",
    name: "Liga de Segunda División Panini",
    sourceName: "Campeonato Chileno",
    sourceUrl: "https://www.campeonatochileno.cl/competition/liga-de-segunda-division-panini/",
    path: "/competition/liga-de-segunda-division-panini/",
    format: "staged",
    placementRules: { championPlaces: 1 },
  },
  "copa-chile": {
    id: "anfp-copa-chile-2026",
    name: "Copa Chile Coca-Cola Zero Azúcar",
    sourceName: "Campeonato Chileno",
    sourceUrl: "https://www.campeonatochileno.cl/competition/copa-chile-coca-cola-zero-azucar/",
    path: "/competition/copa-chile-coca-cola-zero-azucar/",
    format: "staged",
  },
  "copa-liga": {
    id: "anfp-copa-de-la-liga-2026",
    name: "Copa de la Liga",
    sourceName: "Campeonato Chileno",
    sourceUrl: "https://www.campeonatochileno.cl/competition/copa-de-la-liga/",
    path: "/competition/copa-de-la-liga/",
    format: "staged",
  },
};

// Numeración publicada en las bases oficiales de Copa de la Liga 2026:
// posición final de Primera División 2025 (ascendidos en los números 15 y 16).
// https://www.anfp.cl/?jet_download=d91a7ecfb9af6cfaa798aacf60203b5e619f73c4
const copaLiga2026CompetitionNumbers: Readonly<Record<string, number>> = {
  "coquimbo unido": 1,
  "universidad catolica": 2,
  "o'higgins": 3,
  "universidad de chile": 4,
  "audax italiano": 5,
  "palestino": 6,
  "cobresal": 7,
  "colo colo": 8,
  "huachipato": 9,
  "nublense": 10,
  "deportes limache": 11,
  "union la calera": 12,
  "deportes la serena": 13,
  "everton": 14,
  "universidad de concepcion": 15,
  "deportes concepcion": 16,
};

function requiredText(element: Element, selector: string, field: string): string {
  const value = element.querySelector(selector)?.textContent?.trim();
  if (!value) {
    throw new Error(`La fuente oficial no contiene ${field} en uno de los partidos.`);
  }
  return value;
}

function parseMatch(
  element: Element,
  groupName?: string,
  knockoutResolution?: OfficialMatch["knockoutResolution"],
): OfficialMatch {
  const id = element.getAttribute("data-anwp-match");
  if (!id) {
    throw new Error("La fuente oficial publicó un partido sin identificador.");
  }

  const match: OfficialMatch = {
    id,
    homeTeamName: requiredText(element, ".match-slim__team-home-title", "el equipo local"),
    awayTeamName: requiredText(element, ".match-slim__team-away-title", "el equipo visitante"),
    ...(groupName
      ? { homeGroupName: groupName, awayGroupName: groupName }
      : {}),
    ...(knockoutResolution ? { knockoutResolution } : {}),
  };

  const statusText = element.textContent?.trim().toLocaleLowerCase("es") ?? "";
  const operationalStatus: OfficialMatch["operationalStatus"] =
    /partido\s+(?:pospuesto|postergado)|\b(?:pospuesto|postergado)\b/.test(statusText)
      ? "postponed"
      : /\b(?:suspendido|suspendida)\b/.test(statusText)
        ? "suspended"
        : /\b(?:cancelado|cancelada)\b/.test(statusText)
          ? "cancelled"
          : element.classList.contains("game-status-1") ? "finished" : undefined;

  if (!element.classList.contains("game-status-1")) {
    return operationalStatus ? { ...match, operationalStatus } : match;
  }

  const homeGoalsText = requiredText(element, ".anwp-fl-game__scores-home", "los goles del local");
  const awayGoalsText = requiredText(element, ".anwp-fl-game__scores-away", "los goles del visitante");
  const homeGoals = Number(homeGoalsText);
  const awayGoals = Number(awayGoalsText);

  if (
    !Number.isInteger(homeGoals)
    || homeGoals < 0
    || homeGoals > 99
    || !Number.isInteger(awayGoals)
    || awayGoals < 0
    || awayGoals > 99
  ) {
    throw new Error(`La fuente oficial publicó un marcador inválido para el partido ${id}.`);
  }

  const penaltiesText = element.querySelector(".match-slim__bottom-special")?.textContent?.trim();
  const penaltyMatch = penaltiesText?.match(/Penales\s+(\d{1,2})\s*[-–—]\s*(\d{1,2})/i);
  if (penaltiesText?.toLocaleLowerCase("es").includes("penales") && !penaltyMatch) {
    throw new Error(`La fuente oficial publicó una tanda de penales inválida para el partido ${id}.`);
  }
  return {
    ...match,
    ...(operationalStatus ? { operationalStatus } : {}),
    homeGoals,
    awayGoals,
    ...(penaltyMatch
      ? {
        knockoutResolution: knockoutResolution ?? "penalties",
        penalties: {
          homeGoals: Number(penaltyMatch[1]),
          awayGoals: Number(penaltyMatch[2]),
        },
      }
      : {}),
  };
}

function parseRoundNumber(title: string): number {
  const number = Number(title.match(/\d+/)?.[0]);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`No se pudo interpretar la fecha oficial "${title}".`);
  }
  return number;
}

function parseMatchweekSlides(document: Document): OfficialMatchday[] {
  return Array.from(
    document.querySelectorAll(".anwp-fl-matchweek-slides__swiper-slide"),
    (element) => {
      const title = requiredText(element, ".competition__stage-title", "el número de fecha");
      const matches = Array.from(element.querySelectorAll(".anwp-fl-game"), (game) => parseMatch(game));
      if (matches.length === 0) {
        throw new Error(`La fecha ${parseRoundNumber(title)} no contiene partidos oficiales.`);
      }
      return { number: parseRoundNumber(title), matches };
    },
  );
}

function parseGroupMatchdays(
  group: Element,
  phaseName?: string,
  groupName?: string,
): OfficialMatchday[] {
  const matchdays: OfficialMatchday[] = [];
  let currentMatchday: { number: number; matches: OfficialMatch[] } | undefined;

  for (const child of Array.from(group.children)) {
    const title = child.querySelector(".competition__round-title")?.textContent?.trim();
    if (title) {
      if (currentMatchday) {
        if (currentMatchday.matches.length === 0) {
          throw new Error(`La fecha ${currentMatchday.number} no contiene partidos oficiales.`);
        }
        matchdays.push({
          ...currentMatchday,
          ...(phaseName ? { phaseName } : {}),
        });
      }
      currentMatchday = { number: parseRoundNumber(title), matches: [] };
    }

    const games = child.matches(".anwp-fl-game")
      ? [child]
      : Array.from(child.querySelectorAll(".anwp-fl-game"));
    if (games.length > 0 && !currentMatchday) {
      throw new Error("La fuente oficial publicó partidos sin una fecha identificable.");
    }
    currentMatchday?.matches.push(...games.map((game) => parseMatch(game, groupName)));
  }

  if (currentMatchday) {
    if (currentMatchday.matches.length === 0) {
      throw new Error(`La fecha ${currentMatchday.number} no contiene partidos oficiales.`);
    }
    matchdays.push({
      ...currentMatchday,
      ...(phaseName ? { phaseName } : {}),
    });
  }

  return matchdays;
}

function parseStagedCupMatchdays(
  document: Document,
  options: {
    readonly headingText: string;
    readonly groupPhaseName: string;
    readonly competitionName: string;
    readonly singleMatchPhaseSuffix?: boolean;
    readonly postponedFinalWithoutSchedule?: boolean;
  },
): OfficialMatchday[] {
  const phaseHeadings = Array.from(document.querySelectorAll(".competition__stage-title"));
  const eliminationHeading = phaseHeadings.find((heading) =>
    heading.textContent?.trim().toLocaleLowerCase("es").includes(options.headingText),
  );
  const groupsHeading = phaseHeadings.find((heading) =>
    heading.textContent?.trim().toLocaleLowerCase("es").includes(options.groupPhaseName),
  );
  const eliminationSection = eliminationHeading?.closest(".anwp-section");
  if (!eliminationSection || !groupsHeading) {
    throw new Error("La página oficial de Copa Chile no contiene sus fases de grupos y eliminatorias.");
  }

  const groupMatchdays = Array.from(document.querySelectorAll(".competition__group-wrapper"))
    .flatMap((group) => {
      const groupName = group.querySelector(".competition__title-group")?.textContent?.trim();
      if (!groupName) return [];
      return parseGroupMatchdays(group, `${options.competitionName} · ${groupName}`, groupName);
    });
  if (groupMatchdays.length === 0) {
    throw new Error("No se encontraron partidos de grupos en la página oficial de Copa Chile.");
  }

  const knockoutMatchdays: OfficialMatchday[] = [];
  let currentRound: {
    phaseName: string;
    matches: { readonly match: OfficialMatch; readonly dateTime: string }[];
  } | undefined;
  const finishRound = () => {
    if (!currentRound) return;
    if (currentRound.matches.length === 0) {
      throw new Error(`La ronda ${currentRound.phaseName} no contiene partidos oficiales.`);
    }
    const ties = new Map<string, typeof currentRound.matches>();
    for (const entry of currentRound.matches) {
      const teams = [entry.match.homeTeamName, entry.match.awayTeamName]
        .map((name) => name.trim().toLocaleLowerCase("es"))
        .sort();
      const tieKey = teams.join("|");
      const tie = ties.get(tieKey) ?? [];
      tie.push(entry);
      ties.set(tieKey, tie);
    }

    const firstLegMatches: OfficialMatch[] = [];
    const returnLegMatches: OfficialMatch[] = [];
    const singleMatchTies: OfficialMatch[] = [];
    for (const tie of ties.values()) {
      const orderedTie = [...tie].sort((left, right) =>
        left.dateTime.localeCompare(right.dateTime),
      );
      if (orderedTie.length === 1) {
        singleMatchTies.push({
          ...orderedTie[0].match,
          knockoutResolution: orderedTie[0].match.knockoutResolution ?? "penalties",
        });
      } else if (orderedTie.length === 2) {
        firstLegMatches.push(orderedTie[0].match);
        returnLegMatches.push({
          ...orderedTie[1].match,
          knockoutResolution: "aggregate-then-penalties",
        });
      } else {
        throw new Error(`La ronda ${currentRound.phaseName} contiene una llave con partidos duplicados.`);
      }
    }
    const basePhaseName = `${options.competitionName} · ${currentRound.phaseName}`;
    if (firstLegMatches.length > 0) {
      knockoutMatchdays.push({
        number: 1,
        phaseName: `${basePhaseName} · Ida`,
        matches: firstLegMatches,
      });
      knockoutMatchdays.push({
        number: 1,
        phaseName: `${basePhaseName} · Vuelta`,
        matches: returnLegMatches,
      });
    }
    if (singleMatchTies.length > 0) {
      knockoutMatchdays.push({
        number: 1,
        phaseName: options.singleMatchPhaseSuffix === false
          ? basePhaseName
          : `${basePhaseName} · Partido único`,
        matches: singleMatchTies,
      });
    }
    currentRound = undefined;
  };

  for (
    let section = eliminationSection.nextElementSibling;
    section && !section.querySelector(".competition__stage-title");
    section = section.nextElementSibling
  ) {
    const roundTitle = section.querySelector(".competition__round-title")?.textContent?.trim();
    if (roundTitle) {
      finishRound();
      currentRound = { phaseName: roundTitle, matches: [] };
    }
    if (currentRound) {
      currentRound.matches.push(...Array.from(section.querySelectorAll(".anwp-fl-game"), (game) => {
        const dateTime = game.getAttribute("data-fl-game-datetime") ?? "";
        let match = parseMatch(game);
        // ANFP announced this final as postponed pending a new date. The current raw
        // card omits that label and publishes its sentinel date instead.
        if (
          options.postponedFinalWithoutSchedule
          && currentRound?.phaseName.toLocaleLowerCase("es") === "final"
          && !/^20\d{2}-\d{2}-\d{2}t/i.test(dateTime)
          && match.homeGoals === undefined
          && match.awayGoals === undefined
        ) {
          match = { ...match, operationalStatus: "postponed" };
        }
        return { match, dateTime };
      }));
    }
  }
  finishRound();
  if (knockoutMatchdays.length === 0) {
    throw new Error("No se encontraron rondas eliminatorias en la página oficial de Copa Chile.");
  }
  return [...groupMatchdays, ...knockoutMatchdays];
}

function parseCompetitionGroups(document: Document): OfficialMatchday[] {
  const stagedGroups = Array.from(document.querySelectorAll(".competition__stage-title"));
  if (stagedGroups.length > 0) {
    return stagedGroups.flatMap((heading) => {
      const phaseName = heading.textContent?.trim();
      const group = heading.closest(".anwp-section")?.nextElementSibling;
      if (!phaseName || !group?.classList.contains("competition__group-wrapper")) {
        throw new Error("La fuente oficial contiene una etapa sin calendario identificable.");
      }
      const matchdays = parseGroupMatchdays(group, phaseName);
      if (matchdays.length === 0) {
        throw new Error(`La etapa oficial "${phaseName}" no contiene fechas.`);
      }
      return matchdays;
    });
  }

  const groups = Array.from(document.querySelectorAll(".competition__group-wrapper"));
  if (groups.length !== 1) {
    throw new Error("No se pudo identificar el calendario por fechas en la página oficial.");
  }
  return parseGroupMatchdays(groups[0]);
}

function validateMatchdays(matchdays: readonly OfficialMatchday[]): void {
  if (matchdays.length === 0) {
    throw new Error("No se encontraron fechas en la página oficial de Campeonato Chileno.");
  }

  const roundKeys = new Set<string>();
  const matchIds = new Set<string>();
  for (const matchday of matchdays) {
    const roundKey = `${matchday.phaseName ?? ""}:${matchday.number}`;
    if (roundKeys.has(roundKey)) {
      throw new Error(`La fuente oficial contiene fechas duplicadas (${roundKey}).`);
    }
    roundKeys.add(roundKey);

    for (const match of matchday.matches) {
      if (matchIds.has(match.id)) {
        throw new Error(`La fuente oficial repite el partido ${match.id}.`);
      }
      matchIds.add(match.id);
    }
  }
}

export class AnfpOfficialLeagueSource implements OfficialLeagueSource {
  async fetchSeason(
    league: OfficialLeagueId,
    zone?: OfficialLeagueZone,
  ): Promise<OfficialLeagueSeason> {
    if (league === "tercera-a" || league === "tercera-b") {
      throw new Error("Las competencias de Tercera División se consultan desde la fuente oficial ANFA.");
    }
    if (
      league === "argentina-nacional"
      || league === "brasil-serie-b"
      || league === "argentina-primera"
      || league === "brasil-primera"
      || league === "copa-argentina"
      || league === "copa-brasil"
      || league === "libertadores"
      || league === "sudamericana"
    ) {
      throw new Error("Las competencias de Argentina y Brasil se consultan desde sus fuentes oficiales.");
    }
    if (league === "segunda" && zone !== "ascenso" && zone !== "descenso") {
      throw new Error("Selecciona la zona de ascenso o la zona de descenso de Segunda División.");
    }
    if (league !== "segunda" && zone) {
      throw new Error("La selección de zona solo está disponible para Segunda División.");
    }

    const baseConfig = leaguePages[league];
    const phaseToImport = league === "segunda"
      ? zone === "ascenso" ? "Fase final Campeón" : "Fase final descenso"
      : undefined;
    const zoneName = zone === "ascenso" ? "Zona de Ascenso" : "Zona de Descenso";
    const config: LeaguePageConfig & { readonly zoneName?: string } = league === "segunda"
      ? {
        ...baseConfig,
        id: `anfp-liga-segunda-${zone}-2026`,
        name: `${baseConfig.name} · ${zoneName}`,
        zoneName,
        placementRules: zone === "ascenso"
          ? { championPlaces: 1 }
          : { relegationPlaces: 2 },
      }
      : baseConfig;
    let response: Response;
    try {
      response = await fetch(`/official-source${config.path}`);
    } catch (error) {
      const detail = error instanceof Error ? ` (${error.message})` : "";
      throw new Error(
        `No se pudo conectar con la fuente ANFP. Comprueba la conexión y el proxy del servidor.${detail}`,
      );
    }

    if (!response.ok) {
      throw new Error(`La fuente oficial ANFP respondió con HTTP ${response.status}.`);
    }

    const html = await response.text();
    const document = new DOMParser().parseFromString(html, "text/html");
    let matchdays = league === "copa-chile"
      ? parseStagedCupMatchdays(document, {
        headingText: "eliminatorias",
        groupPhaseName: "fase de grupos",
        competitionName: "Copa Chile",
      })
      : league === "copa-liga"
        ? parseStagedCupMatchdays(document, {
          headingText: "finales",
          groupPhaseName: "temporada regular",
          competitionName: "Copa de la Liga",
          singleMatchPhaseSuffix: false,
          postponedFinalWithoutSchedule: true,
        })
      : document.querySelectorAll(".anwp-fl-matchweek-slides__swiper-slide").length > 0
        ? parseMatchweekSlides(document)
        : parseCompetitionGroups(document);
    if (phaseToImport) {
      const selectedPhaseMatchdays = matchdays.filter(
        (matchday) => matchday.phaseName === phaseToImport,
      );
      if (selectedPhaseMatchdays.length === 0) {
        throw new Error(`No se encontraron partidos publicados para la ${zoneName}.`);
      }
      matchdays = selectedPhaseMatchdays.map((matchday) => ({
        ...matchday,
        phaseName: zoneName,
      }));
    }
    validateMatchdays(matchdays);

    let teams: OfficialLeagueSeason["teams"];
    if (league === "copa-liga") {
      const groupTeams = new Map<string, Map<string, string>>();
      let groupMatchCount = 0;
      for (const matchday of matchdays) {
        if (!matchday.phaseName?.startsWith("Copa de la Liga · Grupo ")) continue;
        groupMatchCount += matchday.matches.length;
        for (const match of matchday.matches) {
          const groupName = match.homeGroupName;
          if (!groupName || groupName !== match.awayGroupName) {
            throw new Error(`El partido ${match.id} no conserva un grupo coherente de Copa de la Liga.`);
          }
          const participants = groupTeams.get(groupName) ?? new Map<string, string>();
          participants.set(normalizeTeamName(match.homeTeamName), match.homeTeamName);
          participants.set(normalizeTeamName(match.awayTeamName), match.awayTeamName);
          groupTeams.set(groupName, participants);
        }
      }
      if (
        groupTeams.size !== 4
        || [...groupTeams.values()].some((participants) => participants.size !== 4)
        || groupMatchCount !== 48
      ) {
        throw new Error(
          "La fuente oficial de Copa de la Liga no contiene los cuatro grupos completos de cuatro equipos y sus 48 partidos publicados.",
        );
      }
      teams = [...groupTeams].flatMap(([groupName, participants]) =>
        [...participants.values()].map((name) => {
          const competitionNumber = copaLiga2026CompetitionNumbers[normalizeTeamName(name)];
          if (competitionNumber === undefined) {
            throw new Error(
              `No existe numeración oficial de Copa de la Liga 2026 para el equipo "${name}".`,
            );
          }
          return { name, groupName, competitionNumber };
        }),
      );
    }

    return {
      ...config,
      season: 2026,
      ...(teams ? { teams } : {}),
      ...(league === "copa-liga"
        ? {
          competitionType: "cup" as const,
          knockoutStages: [
            { name: "Copa de la Liga · Semifinales", legs: 2 as const },
            { name: "Copa de la Liga · Final", legs: 1 as const },
          ],
          rulesNote: "Fase regular con cuatro grupos de cuatro equipos; semifinales a ida y vuelta y final a partido único. Los desempates de grupos no se aplican por esta importación.",
        }
        : league === "copa-chile"
        ? {
          competitionType: "cup" as const,
          knockoutStages: [
            { name: "Copa Chile · Octavos de final", legs: 2 as const },
            { name: "Copa Chile · Cuartos de final", legs: 2 as const },
            { name: "Copa Chile · Semifinales", legs: 2 as const },
            { name: "Copa Chile · Final", legs: 1 as const },
          ],
          rulesNote: "Fase de grupos por zonas, octavos, cuartos y semifinales a ida y vuelta; la final se juega a partido único. Los empates en las eliminatorias se definen por penales cuando corresponde.",
        }
        : {}),
      matchdays,
    };
  }
}
