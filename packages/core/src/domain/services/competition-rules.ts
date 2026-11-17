import type {
  CompetitionRulesConfiguration,
  RulesVerificationStatus,
  Tournament,
} from "../entities/tournament";
import type { TieBreaker } from "../value-objects/tie-breaker";

import { NACIONAL_RULES_URL, SERIE_B_RULES_URL } from "./second-division-rules";

interface RulePreset {
  readonly season: number;
  readonly standings: RulesVerificationStatus;
  readonly placements: RulesVerificationStatus;
  readonly sourceUrls: readonly string[];
  readonly standingsNote: string;
  readonly placementsNote: string;
  readonly pointsSystem: NonNullable<Tournament["pointsSystem"]>;
  readonly tieBreakers?: readonly TieBreaker[];
  readonly conditionalPlacements?: NonNullable<
    CompetitionRulesConfiguration["conditionalPlacements"]
  >;
  readonly internationalQualification?: CompetitionRulesConfiguration["internationalQualification"];
  readonly relegationAverage?: CompetitionRulesConfiguration["relegationAverage"];
}

const genericStandingsNote =
  "El orden utiliza criterios de desempate genéricos de la aplicación; falta verificar el reglamento de esta competición y temporada.";
const commonPointsSystem = { win: 3, draw: 1, loss: 0 } as const;

const season2026Presets: Readonly<Record<string, RulePreset>> = {
  "arg-primera-nacional-2026": {
    season: 2026, standings: "verified", placements: "verified", pointsSystem: commonPointsSystem,
    sourceUrls: [NACIONAL_RULES_URL, "https://www.afa.com.ar/upload/torneo/Reglamento_General_AFA.pdf"],
    tieBreakers: ["goalDifference", "goalsFor", "headToHead"],
    standingsNote: "AFA 6823, art. 5 y RG art. 112: diferencia de goles, goles a favor y minitabla directa. Los empates que deciden descenso requieren partidos de desempate (art. 111).",
    placementsNote: "Dos zonas de 18; 36 partidos por equipo. Final neutral entre primeros con prórroga y penales. Reducido: primera fase única con ventaja; cuartos y semifinales ida/vuelta con ventaja; final ida/vuelta con penales. Reordenamiento por posición, puntos, DG, GF y sorteo; el perdedor de la primera final es cabeza de serie. Dos descensos por zona a Primera B o Federal A según afiliación. Sorteos y afiliaciones faltantes quedan pendientes.",
  },
  "brasileirao-serie-b-2026": {
    season: 2026, standings: "verified", placements: "verified", pointsSystem: commonPointsSystem,
    sourceUrls: [SERIE_B_RULES_URL],
    tieBreakers: ["wins", "goalDifference", "goalsFor", "headToHeadGoalDifference", "redCards", "yellowCards"],
    standingsNote: "CBF REC 2026 art. 12: victorias, DG, GF, resultado agregado directo (solo dos clubes), menos rojas, menos amarillas y sorteo. Sin cobertura completa de tarjetas o sorteo, el orden queda pendiente.",
    placementsNote: "20 equipos, 38 jornadas. 1.º y 2.º ascienden; 3.º–6.º y 4.º–5.º juegan ida/vuelta, con la vuelta en casa del mejor. Se resuelve por puntos, DG y mejor posición de liga: sin prórroga ni penales ni final adicional. 17.º–20.º a Série C (arts. 5 y 13).",
  },
  "anfp-liga-primera-2026": {
    season: 2026,
    standings: "pending",
    placements: "provisional",
    sourceUrls: ["https://www.campeonatochileno.cl/ligas/liga-de-primera-mercado-libre/"],
    standingsNote: genericStandingsNote,
    placementsNote:
      "Los cupos publicados son posiciones base. Los puestos que dependen de campeones de copa o del partido por Chile 4 permanecen provisionales.",
    conditionalPlacements: [
      {
        status: "pending",
        description: "El cupo de Chile 3 depende del campeón de Copa de la Liga.",
        sourceUrl: "https://www.campeonatochileno.cl/ligas/liga-de-primera-mercado-libre/",
      },
      {
        status: "pending",
        description: "El partido por Chile 4 entre el 3.º de liga y el campeón de Copa Chile no se calcula.",
        sourceUrl: "https://www.campeonatochileno.cl/competition/copa-chile-coca-cola-zero-azucar/",
      },
    ],
    pointsSystem: commonPointsSystem,
  },
  "anfp-liga-de-ascenso-2026": {
    season: 2026,
    standings: "pending",
    placements: "provisional",
    sourceUrls: [
      "https://www.anfp.cl/wp-content/uploads/2026/01/Bases-Primera-B-2026_VF_1.pdf",
      "https://www.campeonatochileno.cl/competition/campeonato-de-ascenso-caixun-2026/",
    ],
    standingsNote: genericStandingsNote,
    placementsNote:
      "Los puestos se basan en la clasificación configurada; la liguilla usa provisionalmente la estructura ANFP documentada para 2025, no verificada para 2026.",
    pointsSystem: commonPointsSystem,
  },
  "anfp-liga-segunda-2026": {
    season: 2026,
    standings: "pending",
    placements: "provisional",
    sourceUrls: [
      "https://www.anfp.cl/wp-content/uploads/2026/03/Bases-Segunda-Division-2026-2.pdf",
      "https://www.campeonatochileno.cl/competition/liga-de-segunda-division-panini/",
    ],
    standingsNote: genericStandingsNote,
    placementsNote: "Las plazas se aplican a la zona/etapa importada; verificar la regla completa de temporada.",
    pointsSystem: commonPointsSystem,
  },
  "anfa-tercera-a-2026": {
    season: 2026,
    standings: "pending",
    placements: "pending",
    sourceUrls: ["https://anfaterceradivision.cl/assets/php/home.php"],
    standingsNote: genericStandingsNote,
    placementsNote:
      "Promoción, playoff de ascenso y playoff de descenso marcados en la fuente; formato y reglas de los playoffs pendientes de verificar.",
    pointsSystem: commonPointsSystem,
  },
  "anfa-tercera-b-norte-2026": {
    season: 2026,
    standings: "pending",
    placements: "pending",
    sourceUrls: ["https://anfaterceradivision.cl/assets/php/home.php"],
    standingsNote: genericStandingsNote,
    placementsNote: "Formato y criterios de las plazas de promoción/descenso pendientes de verificar.",
    pointsSystem: commonPointsSystem,
  },
  "anfa-tercera-b-sur-2026": {
    season: 2026,
    standings: "pending",
    placements: "pending",
    sourceUrls: ["https://anfaterceradivision.cl/assets/php/home.php"],
    standingsNote: genericStandingsNote,
    placementsNote: "Formato y criterios de las plazas de promoción/descenso pendientes de verificar.",
    pointsSystem: commonPointsSystem,
  },
  "arg-liga-profesional-2026": {
    season: 2026,
    standings: "pending",
    placements: "provisional",
    sourceUrls: [
      "https://www.espn.com/soccer/fixtures/_/league/arg.1",
      "https://www.tycsports.com/liga-profesional-de-futbol/tabla-anual-2026-clasificacion-libertadores-sudamericana-2027-id751165.html",
    ],
    standingsNote: genericStandingsNote,
    placementsNote:
      "Cupos base sujetos a corrimientos por campeones de Apertura, Clausura y Copa Argentina. El descenso por promedios no se calcula en esta tabla.",
    conditionalPlacements: [{
      status: "pending",
      description:
        "Los cupos finales pueden cambiar según campeones de Apertura, Clausura y Copa Argentina.",
      sourceUrl: "https://www.tycsports.com/liga-profesional-de-futbol/tabla-anual-2026-clasificacion-libertadores-sudamericana-2027-id751165.html",
    }],
    pointsSystem: commonPointsSystem,
  },
  "brasileirao-serie-a-2026": {
    season: 2026,
    standings: "pending",
    placements: "provisional",
    sourceUrls: ["https://www.espn.com/soccer/fixtures/_/league/bra.1"],
    standingsNote: genericStandingsNote,
    placementsNote:
      "Plazas por posición tomadas de la configuración de importación; los corrimientos por campeones de copa no están calculados ni verificados aquí.",
    conditionalPlacements: [{
      status: "pending",
      description: "Los cupos internacionales pueden correrse cuando un campeón de copa ya clasificó por liga.",
    }],
    pointsSystem: commonPointsSystem,
  },
  "anfp-copa-chile-2026": {
    season: 2026,
    standings: "pending",
    placements: "pending",
    sourceUrls: ["https://www.campeonatochileno.cl/competition/copa-chile-coca-cola-zero-azucar/"],
    standingsNote: genericStandingsNote,
    placementsNote: "Los criterios para ordenar grupos no están verificados en la configuración actual.",
    pointsSystem: commonPointsSystem,
  },
  "anfp-copa-de-la-liga-2026": {
    season: 2026,
    standings: "verified",
    placements: "pending",
    tieBreakers: [
      "goalDifference",
      "wins",
      "goalsFor",
      "awayGoals",
      "redCards",
      "yellowCards",
      "competitionNumber",
    ],
    sourceUrls: [
      "https://www.campeonatochileno.cl/competition/copa-de-la-liga/",
      "https://www.anfp.cl/?jet_download=d91a7ecfb9af6cfaa798aacf60203b5e619f73c4",
    ],
    standingsNote: "Los criterios de desempate siguen las bases oficiales. Las tarjetas solo se usan si todos los partidos válidos de los equipos empatados tienen eventos marcados como completos; si falta cobertura, la posición queda provisional. La numeración corresponde a Primera División 2025.",
    placementsNote: "Las reglas de desempate y los cupos asociados a esta copa no se calculan con esta configuración.",
    pointsSystem: commonPointsSystem,
  },
  "conmebol-libertadores-2026": {
    season: 2026,
    standings: "pending",
    placements: "provisional",
    sourceUrls: ["https://www.espn.com/soccer/fixtures/_/league/conmebol.libertadores"],
    standingsNote: genericStandingsNote,
    placementsNote:
      "La progresión de grupos usa las posiciones calculadas; desempates de grupo pendientes de verificar contra el reglamento CONMEBOL 2026.",
    pointsSystem: commonPointsSystem,
  },
  "conmebol-sudamericana-2026": {
    season: 2026,
    standings: "pending",
    placements: "provisional",
    sourceUrls: ["https://www.espn.com/soccer/fixtures/_/league/conmebol.sudamericana"],
    standingsNote: genericStandingsNote,
    placementsNote:
      "La progresión de grupos usa las posiciones calculadas; desempates de grupo pendientes de verificar contra el reglamento CONMEBOL 2026.",
    pointsSystem: commonPointsSystem,
  },
};

function getPreset(tournamentId: string): RulePreset | undefined {
  const secondDivisionId = /^anfp-liga-segunda-(?:ascenso|descenso)-2026$/.test(tournamentId)
    ? "anfp-liga-segunda-2026"
    : tournamentId;
  const known = season2026Presets[secondDivisionId];
  if (known) return known;

  const cupSeasonMatch = /^(afa-copa-argentina|cbf-copa-do-brasil)-(\d{4})$/.exec(tournamentId);
  if (!cupSeasonMatch) return undefined;
  const season = Number(cupSeasonMatch[2]);
  return {
    season,
    standings: "pending",
    placements: "pending",
    sourceUrls: cupSeasonMatch[1] === "afa-copa-argentina"
      ? ["https://www.copaargentina.org/es/fixture.html"]
      : [`https://www.cbf.com.br/futebol-brasileiro/tabelas/copa-do-brasil/masculino/${season}`],
    standingsNote: genericStandingsNote,
    placementsNote: "No hay plazas de liga aplicables; verificar cualquier criterio de fase de grupos.",
    pointsSystem: commonPointsSystem,
  };
}

export function getCompetitionRulesConfiguration(
  tournamentId: string,
): CompetitionRulesConfiguration | undefined {
  const preset = getPreset(tournamentId);
  if (!preset) return undefined;
  return {
    season: preset.season,
    points: preset.pointsSystem,
    ...(preset.tieBreakers ? { tieBreakers: preset.tieBreakers } : {}),
    verification: {
      standings: preset.standings,
      placements: preset.placements,
    },
    sourceUrls: preset.sourceUrls,
    standingsNote: preset.standingsNote,
    placementsNote: preset.placementsNote,
    ...(preset.conditionalPlacements
      ? { conditionalPlacements: preset.conditionalPlacements }
      : {}),
    ...(preset.internationalQualification
      ? { internationalQualification: preset.internationalQualification }
      : {}),
    ...(preset.relegationAverage
      ? { relegationAverage: preset.relegationAverage }
      : {}),
  };
}

export function applyCompetitionRulesConfiguration(tournament: Tournament): Tournament {
  if (tournament.competitionRules) {
    const preset = getPreset(tournament.id);
    const addInternationalQualification = !tournament.competitionRules.internationalQualification
      && preset?.internationalQualification !== undefined;
    const addRelegationAverage = !tournament.competitionRules.relegationAverage
      && preset?.relegationAverage !== undefined;
    const pointsSystem = tournament.pointsSystem
      ?? tournament.competitionRules.points
      ?? preset?.pointsSystem;
    if (
      !addInternationalQualification
      && !addRelegationAverage
      && pointsSystem === tournament.pointsSystem
    ) {
      return tournament;
    }
    const competitionRules = {
      ...tournament.competitionRules,
      ...(addInternationalQualification
        && preset?.internationalQualification
        ? { internationalQualification: preset.internationalQualification }
        : {}),
      ...(addRelegationAverage && preset?.relegationAverage
        ? { relegationAverage: preset.relegationAverage }
        : {}),
    };
    return {
      ...tournament,
      ...(pointsSystem ? { pointsSystem } : {}),
      competitionRules,
    };
  }
  const competitionRules = getCompetitionRulesConfiguration(tournament.id);
  if (!competitionRules) return tournament;
  const preset = getPreset(tournament.id);
  const { tieBreakers } = competitionRules;
  return {
    ...tournament,
    ...(preset ? { pointsSystem: competitionRules.points ?? preset.pointsSystem } : {}),
    ...(tieBreakers ? { tieBreakers } : {}),
    competitionRules,
  };
}

/** Missing configurations remain compatible with legacy local tournaments. */
export function hasUnverifiedCompetitionRules(tournament: Tournament, scope: "standings" | "all" = "all"): boolean {
  const rules = tournament.competitionRules;
  return !!rules && ((tournament.season !== undefined && rules.season !== tournament.season)
    || rules.verification.standings !== "verified" || (scope === "all" && rules.verification.placements !== "verified"));
}
