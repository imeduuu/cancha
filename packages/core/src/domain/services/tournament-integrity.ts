import {validateNationalCupPlanning} from "./national-cup-planning";
import { validateContinentalPlans } from "./continental-plan";
import { isSeasonPreparation } from "./season-preparation";
import type { Fixture, MatchResult, Tournament } from "../entities/tournament";
import { normalizeTeamName } from "./team-name";
import { isValidKnockoutResult, isValidMatchResult } from "./match-result-validation";
import { getCompletedStageWinners } from "./official-cup-progression";
import { isValidGoalScorer, isGoalScorerForFixture } from "./goal-scorers";
import { validateMatchSchedule } from "./match-scheduling";
import { isOperationallyFinished } from "./match-operational-status";
import { validateContinentalGroupSchedule } from "./continental-group-schedule";
import { validateFixturePairings } from "./fixture-pairing-validation";
import { isValidRelegationPlaces } from "./placement-classification";

import { validateOfficialResolutions } from "./official-resolution-validation";

export function validateTournamentIntegrity(tournament: Tournament): string[] {
  const issues: string[] = [...validateOfficialResolutions(tournament), ...validateContinentalPlans(tournament), ...validateNationalCupPlanning(tournament)];
  if (tournament.seasonPreparation !== undefined && !isSeasonPreparation(tournament.seasonPreparation)) issues.push("Preparación de temporada inválida.");
  const teamIds = new Set<string>();
  const competitionNumbers = new Set<number>();

  if (!tournament.id.trim()) issues.push("Identificador del torneo: no puede estar vacío.");
  if (!tournament.name.trim()) issues.push("Nombre del torneo: no puede estar vacío.");
  if (tournament.name.trim().length > 80) {
    issues.push("Nombre del torneo: no puede superar los 80 caracteres.");
  }
  if (!Number.isSafeInteger(tournament.legs) || tournament.legs < 1) {
    issues.push("Ruedas o fases: debe existir al menos una y su número debe ser entero.");
  }
  if (!Number.isFinite(Date.parse(tournament.createdAt))) {
    issues.push("Fecha de creación: no es una fecha válida.");
  }
  if (tournament.calendarProvenance !== undefined
    && tournament.calendarProvenance !== "official-import"
    && tournament.calendarProvenance !== "local-generated"
    && tournament.calendarProvenance !== "manual") {
    issues.push("Procedencia del calendario: estado no reconocido.");
  }
  if (
    tournament.season !== undefined
    && (!Number.isSafeInteger(tournament.season) || tournament.season < 1)
  ) {
    issues.push("Temporada: debe ser un año entero positivo.");
  }
  if (tournament.competitionRules
    && (!Number.isSafeInteger(tournament.competitionRules.season)
      || tournament.competitionRules.season < 1)) {
    issues.push("La temporada de las reglas de competiciÃ³n debe ser un aÃ±o entero positivo.");
  }
  if (tournament.season !== undefined
    && tournament.competitionRules
    && tournament.season !== tournament.competitionRules.season) {
    issues.push("La temporada del torneo y la de sus reglas de competiciÃ³n deben coincidir.");
  }

  if (tournament.placementRules?.relegationPlaces !== undefined
    && !isValidRelegationPlaces(
      tournament.placementRules.relegationPlaces,
      tournament.teams.length > 0 ? tournament.teams.length : undefined,
    )) {
    issues.push(`Puestos de descenso: debe ser un entero no negativo${tournament.teams.length > 0
      ? ` y no superar los ${tournament.teams.length} equipos participantes`
      : ""}.`);
  }

  if (tournament.teams.length < 2 && tournament.matchdays.some(
    (matchday) => matchday.fixtures.length > 0,
  )) {
    issues.push("Equipos: se requieren al menos dos equipos para los partidos registrados.");
  }

  for (const [index, team] of tournament.teams.entries()) {
    const path = `Equipo ${index + 1}`;
    if (!team.id.trim()) issues.push(`${path}, identificador: no puede estar vacío.`);
    else if (teamIds.has(team.id)) issues.push(`${path}, identificador: "${team.id}" está duplicado.`);
    teamIds.add(team.id);

    const normalizedName = normalizeTeamName(team.name);
    if (!normalizedName) issues.push(`${path}, nombre: no puede estar vacío.`);
    else if (team.name.trim().length > 40) {
      issues.push(`${path}, nombre: no puede superar los 40 caracteres.`);
    }

    if (team.afaAffiliation !== undefined && team.afaAffiliation !== "direct" && team.afaAffiliation !== "indirect")
      issues.push(`${path}, afiliación AFA no válida.`);
    if (team.afaAffiliation && (!team.affiliationSourceUrl || !/^https:\/\//.test(team.affiliationSourceUrl)))
      issues.push(`${path}, falta una fuente HTTPS para la afiliación AFA.`);
    if (team.groupName !== undefined && !team.groupName.trim()) {
      issues.push(`${path}, grupo: no puede estar vacío si se especifica.`);
    }
    if (team.competitionNumber !== undefined
      && (!Number.isSafeInteger(team.competitionNumber) || team.competitionNumber < 1)) {
      issues.push(`${path}, numeración de competición: debe ser un entero positivo.`);
    }
    if (team.competitionNumber !== undefined) {
      if (competitionNumbers.has(team.competitionNumber)) {
        issues.push(`${path}, numeración de competición: "${team.competitionNumber}" está duplicada.`);
      }
      competitionNumbers.add(team.competitionNumber);
    }
  }

  const fixtureIds = new Set<string>();
  const matchdayKeys = new Set<string>();
  const pairByLeg = new Set<string>();
  const firstLegResults = new Map<string, { fixture: Fixture; result: MatchResult }>();

  for (const [matchdayIndex, matchday] of tournament.matchdays.entries()) {
    const path = `Fecha/fase ${matchdayIndex + 1}`;
    const isConfiguredKnockoutPhase = tournament.knockoutStages?.some((stage) => {
      const phaseName = normalizeTeamName(matchday.phaseName ?? "");
      const stageName = normalizeTeamName(stage.name);
      return phaseName === stageName || phaseName.startsWith(`${stageName} ·`);
    }) ?? false;
    if (!Number.isSafeInteger(matchday.number) || matchday.number < 1) {
      issues.push(`${path}, número: debe ser un entero positivo.`);
    }
    if (!Number.isSafeInteger(matchday.leg) || matchday.leg < 1 || matchday.leg > tournament.legs) {
      issues.push(`${path}, rueda/fase: debe ser un entero entre 1 y ${tournament.legs}.`);
    }
    if (matchday.phaseName !== undefined && !matchday.phaseName.trim()) {
      issues.push(`${path}, nombre de fase: no puede estar vacío si se especifica.`);
    }
    const matchdayKey = `${matchday.leg}|${matchday.phaseName ?? ""}|${matchday.number}`;
    if (matchdayKeys.has(matchdayKey)) {
      issues.push(`${path}: la fecha ${matchday.number} está duplicada en la misma fase.`);
    }
    matchdayKeys.add(matchdayKey);

    const scheduledTeams = new Set<string>();
    const pairsInMatchday = new Set<string>();
    for (const [fixtureIndex, fixture] of matchday.fixtures.entries()) {
      const fixturePath = `${path}, partido ${fixtureIndex + 1}`;
      if (!fixture.id.trim()) issues.push(`${fixturePath}, identificador: no puede estar vacío.`);
      else if (fixtureIds.has(fixture.id)) {
        issues.push(`${fixturePath}, identificador: "${fixture.id}" está duplicado.`);
      }
      fixtureIds.add(fixture.id);
      if (fixture.calendarProvenance !== undefined
        && fixture.calendarProvenance !== "official-import"
        && fixture.calendarProvenance !== "local-generated"
        && fixture.calendarProvenance !== "manual") {
        issues.push(`${fixturePath}, procedencia: estado no reconocido.`);
      }

      if (!teamIds.has(fixture.homeTeamId)) {
        issues.push(`${fixturePath}, local: el equipo "${fixture.homeTeamId}" no existe.`);
      }
      if (!teamIds.has(fixture.awayTeamId)) {
        issues.push(`${fixturePath}, visitante: el equipo "${fixture.awayTeamId}" no existe.`);
      }
      if (fixture.homeTeamId === fixture.awayTeamId) {
        issues.push(`${fixturePath}: un equipo no puede jugar contra sí mismo.`);
      }
      if (fixture.schedule !== undefined) {
        const scheduleIssue = validateMatchSchedule(fixture.schedule);
        if (scheduleIssue) issues.push(`${fixturePath}, programación: ${scheduleIssue}`);
      }
      if (fixture.eventsCoverage !== undefined
        && fixture.eventsCoverage !== "unverified" && fixture.eventsCoverage !== "complete") {
        issues.push(`${fixturePath}, eventos: el estado de cobertura no es válido.`);
      }
      if (fixture.operationalState !== undefined && !isValidOperationalState(fixture.operationalState)) {
        issues.push(`${fixturePath}, estado operativo: los datos no son válidos.`);
      }
      if (scheduledTeams.has(fixture.homeTeamId) || scheduledTeams.has(fixture.awayTeamId)) {
        issues.push(`${fixturePath}: un equipo aparece en más de un partido de la misma fecha.`);
      }
      scheduledTeams.add(fixture.homeTeamId);
      scheduledTeams.add(fixture.awayTeamId);

      const pair = [fixture.homeTeamId, fixture.awayTeamId].sort().join("|");
      if (pairsInMatchday.has(pair)) {
        issues.push(`${fixturePath}: el mismo cruce está duplicado en la fecha.`);
      }
      pairsInMatchday.add(pair);
      if (tournament.format !== "staged" && !isConfiguredKnockoutPhase) {
        const pairByLegKey = `${matchday.leg}|${pair}`;
        if (pairByLeg.has(pairByLegKey)) {
          issues.push(`${fixturePath}: el cruce entre esos equipos está duplicado en la rueda.`);
        }
        pairByLeg.add(pairByLegKey);
      }

      if (fixture.result && !isValidMatchResult(fixture.result)) {
        issues.push(`${fixturePath}, marcador: cada valor debe ser un entero entre 0 y 99.`);
      } else if (fixture.result && fixture.knockoutResolution !== "aggregate-then-penalties"
        && !isValidKnockoutResult(fixture.result, fixture.knockoutResolution)) {
        const isLegacyArgentinePenaltyResult = tournament.id === "arg-liga-profesional-2026"
          && fixture.knockoutResolution === "extra-time-then-penalties"
          && fixture.result.homeGoals === fixture.result.awayGoals
          && fixture.result.extraTime === undefined
          && fixture.result.penalties !== undefined
          && fixture.result.penalties.homeGoals !== fixture.result.penalties.awayGoals;
        if (!isLegacyArgentinePenaltyResult) {
          issues.push(`${fixturePath}, definición: el resultado no coincide con la regla de desempate configurada.`);
        }
      }
      if (fixture.goalScorers !== undefined) {
        if (!Array.isArray(fixture.goalScorers)
          || !fixture.goalScorers.every(isValidGoalScorer)) {
          issues.push(`${fixturePath}, autores de goles: el registro no es válido.`);
        } else if (fixture.goalScorers.some((scorer) => !isGoalScorerForFixture(scorer, fixture))) {
          issues.push(`${fixturePath}, autores de goles: el equipo del jugador no participó en el partido.`);
        }
      }

      if (matchday.phaseName?.endsWith(" · Ida") && fixture.result) {
        const returnPhase = `${matchday.phaseName.slice(0, -" · Ida".length)} · Vuelta`;
        firstLegResults.set(`${returnPhase}|${pair}`, { fixture, result: fixture.result });
      }
    }
  }

  for (const matchday of tournament.matchdays) {
    if (!matchday.phaseName?.endsWith(" · Vuelta")) continue;
    for (const [fixtureIndex, fixture] of matchday.fixtures.entries()) {
      const key = `${matchday.phaseName}|${[fixture.homeTeamId, fixture.awayTeamId].sort().join("|")}`;
      const firstLeg = firstLegResults.get(key);
      const result = fixture.result;
      if (!result) continue;
      if (firstLeg && !isOperationallyFinished(firstLeg.fixture)) continue;
      if (!firstLeg) {
        if (result.penalties) {
          issues.push(`Fase ${matchday.phaseName}, partido ${fixtureIndex + 1}: hay penales sin resultado de ida.`);
        }
        continue;
      }
      const firstHome = firstLeg.fixture.homeTeamId === fixture.homeTeamId
        ? firstLeg.result.homeGoals
        : firstLeg.result.awayGoals;
      const firstAway = firstLeg.fixture.homeTeamId === fixture.homeTeamId
        ? firstLeg.result.awayGoals
        : firstLeg.result.homeGoals;
      if (firstHome + result.homeGoals !== firstAway + result.awayGoals) {
        if (result.penalties) {
          issues.push(`Fase ${matchday.phaseName}, partido ${fixtureIndex + 1}: los penales no corresponden a un empate global.`);
        }
      } else if (!isValidKnockoutResult(
        result,
        fixture.knockoutResolution,
        {
          homeGoals: firstHome,
          awayGoals: firstAway,
        },
      )) {
        issues.push(`Fase ${matchday.phaseName}, partido ${fixtureIndex + 1}: el resultado no respeta el desempate por global.`);
      }
    }
  }

  if (tournament.format === "staged") {
    issues.push(...validateContinentalGroupSchedule(tournament, tournament.matchdays));
  }

  const regularArgentinaPhases = tournament.id === "arg-liga-profesional-2026"
    ? tournament.matchdays
      .map(({ phaseName }) => phaseName)
      .filter((phaseName): phaseName is string =>
        Boolean(phaseName && /^torneo (apertura|clausura) · fase regular$/i.test(phaseName)),
      )
    : [];
  issues.push(...validateFixturePairings(
    tournament.matchdays.map((matchday) => ({
      number: matchday.number,
      leg: matchday.leg,
      phaseName: matchday.phaseName,
      fixtures: matchday.fixtures.map((fixture) => ({
        ...fixture,
        homeTeamName: tournament.teams.find(({ id }) => id === fixture.homeTeamId)?.name,
        awayTeamName: tournament.teams.find(({ id }) => id === fixture.awayTeamId)?.name,
      })),
    })),
    {
      format: tournament.format,
      legs: tournament.legs,
      knockoutStages: tournament.knockoutStages,
      singleMeetingPhaseNames: regularArgentinaPhases,
    },
  ));

  const stages = tournament.knockoutStages ?? [];
  for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
    const stage = stages[stageIndex];
    const normalizedStageName = normalizeTeamName(stage.name);
    if (!normalizedStageName) {
      issues.push(`Fase eliminatoria ${stageIndex + 1}: el nombre no puede estar vacío.`);
      continue;
    }
    if (stages.slice(0, stageIndex).some(
      (previous) => normalizeTeamName(previous.name) === normalizedStageName,
    )) {
      issues.push(`Fase eliminatoria ${stageIndex + 1}: "${stage.name}" está duplicada.`);
    }
    if (stageIndex === 0 || stages[stageIndex - 1].advanceWinners === false) continue;

    const previousStage = stages[stageIndex - 1];
    const winners = getCompletedStageWinners(tournament.matchdays, previousStage);
    if (!winners) continue;
    const expectedTeams = new Set(winners);
    const phaseNames = stage.legs === 1
      ? [stage.name]
      : [`${stage.name} · Ida`, `${stage.name} · Vuelta`];
    for (const matchday of tournament.matchdays) {
      if (!phaseNames.some((name) => normalizeTeamName(name) === normalizeTeamName(matchday.phaseName ?? ""))) {
        continue;
      }
      for (const [fixtureIndex, fixture] of matchday.fixtures.entries()) {
        if (!expectedTeams.has(fixture.homeTeamId) || !expectedTeams.has(fixture.awayTeamId)) {
          issues.push(
            `Fase ${matchday.phaseName}, partido ${fixtureIndex + 1}: los participantes no clasificaron desde "${previousStage.name}".`,
          );
        }
      }
    }
  }

  return issues;
}

function isValidOperationalState(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const state = value;
  const validStatuses = [
    "unscheduled",
    "scheduled",
    "in-progress",
    "finished",
    "postponed",
    "suspended",
    "cancelled",
  ];
  return typeof state.status === "string"
    && validStatuses.includes(state.status)
    && typeof state.updatedAt === "string"
    && Number.isFinite(Date.parse(state.updatedAt))
    && (state.note === undefined
      || (typeof state.note === "string" && state.note.trim().length > 0 && state.note.length <= 500));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
