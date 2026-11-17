import type { Fixture, Matchday, Tournament } from "../entities/tournament";
import { validateGoalScorers } from "./goal-scorers";
import { validateFixtureDetails } from "./match-details";
import { validateMatchSchedule } from "./match-scheduling";
import { hasCompleteRoundRobinSchedule } from "./tournament-history";
import { getOperationalMatchStatus, getOperationalStatusLabel } from "./match-operational-status";
import { isValidPlayedFixture } from "./tournament-statistics";

export type CompetitionAlertPriority = "informative" | "warning" | "critical";
export type CompetitionAlertAction = "calendar" | "fixture" | "statistics" | "regulations";
export type CompetitionAlertType =
  | "upcoming-match"
  | "past-pending-match"
  | "incomplete-schedule"
  | "invalid-schedule"
  | "invalid-match"
  | "invalid-individual-data"
  | "incomplete-matchday"
  | "regulations-review"
  | "knockout-pending"
  | "calendar-incomplete"
  | "postponed-match"
  | "suspended-match"
  | "cancelled-match"
  | "operational-result-mismatch";

export interface CompetitionAlert {
  readonly id: string;
  readonly type: CompetitionAlertType;
  readonly priority: CompetitionAlertPriority;
  readonly title: string;
  readonly description: string;
  readonly competitionName: string;
  readonly season?: number;
  readonly matchday?: string;
  readonly fixtureId?: string;
  readonly action: CompetitionAlertAction;
}

export interface CompetitionAlertCounts {
  readonly informative: number;
  readonly warning: number;
  readonly critical: number;
  readonly total: number;
}

export function getCompetitionAlerts(
  tournament: Tournament,
  now: Date = new Date(),
): CompetitionAlert[] {
  const alerts: CompetitionAlert[] = [];
  const fixtures = tournament.matchdays.flatMap((matchday) =>
    matchday.fixtures.map((fixture) => ({ matchday, fixture })));
  const teamIds = new Set(tournament.teams.map(({ id }) => id));
  const today = formatLocalDate(now);
  const localTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  for (const { matchday, fixture } of fixtures) {
    const label = getMatchLabel(matchday, fixture, tournament);
    const { schedule: _schedule, ...individualDetails } = fixture;
    const detailsIssue = validateFixtureDetails(tournament, individualDetails);
    const scorersIssue = validateGoalScorers(fixture.goalScorers ?? [], fixture);
    const scheduleIssue = fixture.schedule
      ? validateMatchSchedule(fixture.schedule)
      : undefined;
    const teamsInvalid = !teamIds.has(fixture.homeTeamId)
      || !teamIds.has(fixture.awayTeamId)
      || fixture.homeTeamId === fixture.awayTeamId;
    const { operationalState: _operationalState, ...fixtureWithoutOperationalState } = fixture;
    const resultInvalid = fixture.result !== undefined
      && !isValidPlayedFixture(tournament, matchday, fixtureWithoutOperationalState);
    const operationalStatus = getOperationalMatchStatus(fixture);

    if (teamsInvalid || resultInvalid) {
      addAlert(alerts, tournament, {
        key: `invalid-match:${fixture.id}`,
        type: "invalid-match",
        priority: "critical",
        title: "Partido con datos inválidos",
        description: teamsInvalid
          ? `${label}: una referencia de equipo no es válida.`
          : `${label}: el resultado no pasa la validación deportiva configurada.`,
        matchday: formatMatchday(matchday),
        fixtureId: fixture.id,
        action: "fixture",
      });
    } else if (detailsIssue || scorersIssue) {
      addAlert(alerts, tournament, {
        key: `invalid-details:${fixture.id}`,
        type: "invalid-individual-data",
        priority: "warning",
        title: "Detalles de partido para revisar",
        description: `${label}: ${detailsIssue ?? scorersIssue} Los datos individuales asociados no se consideran válidos para las estadísticas correspondientes.`,
        matchday: formatMatchday(matchday),
        fixtureId: fixture.id,
        action: "fixture",
      });
    }

    if (scheduleIssue) {
      addAlert(alerts, tournament, {
        key: `invalid-schedule:${fixture.id}`,
        type: "invalid-schedule",
        priority: "warning",
        title: "Programación inválida",
        description: `${label}: ${scheduleIssue} No afecta ni modifica el resultado deportivo.`,
        matchday: formatMatchday(matchday),
        fixtureId: fixture.id,
        action: "fixture",
      });
    }

    if (operationalStatus === "suspended") {
      addAlert(alerts, tournament, {
        key: `suspended:${fixture.id}`,
        type: "suspended-match",
        priority: "warning",
        title: "Partido suspendido",
        description: `${label}: requiere seguimiento y una decisión explícita antes de reanudar o finalizar. Sus datos deportivos se conservaron.`,
        matchday: formatMatchday(matchday),
        fixtureId: fixture.id,
        action: "fixture",
      });
    } else if (operationalStatus === "postponed") {
      addAlert(alerts, tournament, {
        key: `postponed:${fixture.id}`,
        type: "postponed-match",
        priority: "warning",
        title: "Partido aplazado sin nueva programación completa",
        description: `${label}: se registró el aplazamiento. ${fixture.schedule?.date && fixture.schedule.time
          ? "Hay una fecha y hora guardadas, pero el modelo no indica si se registraron después del aplazamiento."
          : "No hay una nueva fecha y hora completas."} Registra explícitamente la nueva programación y cambia el estado a programado cuando corresponda.`,
        matchday: formatMatchday(matchday),
        fixtureId: fixture.id,
        action: "fixture",
      });
    } else if (operationalStatus === "cancelled") {
      addAlert(alerts, tournament, {
        key: `cancelled:${fixture.id}`,
        type: "cancelled-match",
        priority: "warning",
        title: "Partido cancelado dentro de la competición",
        description: `${label}: no se asigna un resultado ni puntos administrativos. El reglamento o una decisión de la competición debe resolver cómo se contabiliza.`,
        matchday: formatMatchday(matchday),
        fixtureId: fixture.id,
        action: "fixture",
      });
    } else if (operationalStatus === "finished" && fixture.result === undefined) {
      addAlert(alerts, tournament, {
        key: `finished-without-result:${fixture.id}`,
        type: "operational-result-mismatch",
        priority: "critical",
        title: "Partido finalizado sin resultado válido",
        description: `${label}: el estado operativo dice finalizado, pero no hay un marcador registrado. El partido no se cuenta como disputado ni resuelto.`,
        matchday: formatMatchday(matchday),
        fixtureId: fixture.id,
        action: "fixture",
      });
    } else if (fixture.result !== undefined
      && operationalStatus !== "finished"
      && !resultInvalid) {
      addAlert(alerts, tournament, {
        key: `result-status-mismatch:${fixture.id}`,
        type: "operational-result-mismatch",
        priority: "warning",
        title: "Marcador guardado con estado no final",
        description: `${label}: existe un marcador, pero el estado operativo es ${getOperationalStatusLabel(operationalStatus).toLocaleLowerCase("es")}. El marcador se conserva, pero no se incluye en resultados ni eliminatorias hasta una resolución explícita.`,
        matchday: formatMatchday(matchday),
        fixtureId: fixture.id,
        action: "fixture",
      });
    }

    if (fixture.result === undefined) {
      const schedule = fixture.schedule;
      if (scheduleIssue
        || (operationalStatus !== "scheduled" && operationalStatus !== "unscheduled")) {
        continue;
      } else if (!schedule?.date || !schedule.time) {
        addAlert(alerts, tournament, {
          key: `incomplete-schedule:${fixture.id}`,
          type: "incomplete-schedule",
          priority: "warning",
          title: "Partido pendiente sin programación completa",
          description: `${label}: falta ${[
            !schedule?.date ? "la fecha" : "",
            !schedule?.time ? "la hora" : "",
          ].filter(Boolean).join(" y ")}. No se infiere una programación.`,
          matchday: formatMatchday(matchday),
          fixtureId: fixture.id,
          action: "fixture",
        });
      } else if (schedule.date < today
        || (schedule.date === today && schedule.time < localTime)) {
        addAlert(alerts, tournament, {
          key: `past-pending:${fixture.id}`,
          type: "past-pending-match",
          priority: "warning",
          title: "Partido con fecha pasada y resultado pendiente",
          description: `${label}: la fecha registrada ya pasó, pero no consta si fue aplazado, suspendido o no disputado. Revisa su situación; no se marca automáticamente como atrasado.`,
          matchday: formatMatchday(matchday),
          fixtureId: fixture.id,
          action: "fixture",
        });
      } else {
        addAlert(alerts, tournament, {
          key: `upcoming:${fixture.id}`,
          type: "upcoming-match",
          priority: "informative",
          title: "Próximo partido pendiente",
          description: `${label}: programado para ${schedule.date}${schedule.time ? ` a las ${schedule.time}` : ""}${schedule.venue ? ` en ${schedule.venue}` : ""}.`,
          matchday: formatMatchday(matchday),
          fixtureId: fixture.id,
          action: "fixture",
        });
      }
    }
  }

  for (const matchday of tournament.matchdays) {
    const status = matchday.fixtures.map((fixture) => getFixtureState(tournament, matchday, fixture));
    const pending = status.filter((item) => item === "pending").length;
    const invalid = status.filter((item) => item === "invalid").length;
    if (pending > 0 || invalid > 0) {
      addAlert(alerts, tournament, {
        key: `matchday-incomplete:${matchday.leg}:${matchday.phaseName ?? ""}:${matchday.number}`,
        type: "incomplete-matchday",
        priority: invalid > 0 ? "warning" : "informative",
        title: "Jornada incompleta",
        description: `${formatMatchday(matchday)}: ${pending} pendiente(s) y ${invalid} inválido(s). No se considera completa mientras existan estos casos.`,
        matchday: formatMatchday(matchday),
        action: "calendar",
      });
    }
  }

  if (hasIncompleteRoundRobinCalendar(tournament)) {
    addAlert(alerts, tournament, {
      key: "calendar-incomplete",
      type: "calendar-incomplete",
      priority: "warning",
      title: "Calendario de liga incompleto",
      description: "El formato permite comprobar todos los cruces de liga, pero faltan partidos en el fixture guardado. No se crean encuentros automáticamente.",
      action: "calendar",
    });
  }

  if (hasUnverifiedRules(tournament)) {
    addAlert(alerts, tournament, {
      key: "regulations-review",
      type: "regulations-review",
      priority: "informative",
      title: "Reglamento pendiente de revisión",
      description: getUnverifiedRulesDescription(tournament),
      action: "regulations",
    });
  }

  for (const stage of tournament.knockoutStages ?? []) {
    const stageMatches = fixtures.filter(({ matchday }) =>
      matchday.phaseName?.toLocaleLowerCase("es").includes(stage.name.toLocaleLowerCase("es")));
    const pending = stageMatches.filter(({ matchday, fixture }) =>
      getFixtureState(tournament, matchday, fixture) !== "played").length;
    if (stageMatches.length > 0 && pending > 0) {
      addAlert(alerts, tournament, {
        key: `knockout:${stage.name}`,
        type: "knockout-pending",
        priority: "warning",
        title: "Eliminatoria pendiente de resolución",
        description: `${stage.name}: quedan ${pending} partido(s) sin un resultado válido. No se declara resuelta ni se confirma un campeón.`,
        action: "calendar",
      });
    }
  }

  return alerts;
}

export function countCompetitionAlerts(alerts: readonly CompetitionAlert[]): CompetitionAlertCounts {
  const informative = alerts.filter(({ priority }) => priority === "informative").length;
  const warning = alerts.filter(({ priority }) => priority === "warning").length;
  const critical = alerts.filter(({ priority }) => priority === "critical").length;
  return { informative, warning, critical, total: alerts.length };
}

function getFixtureState(
  tournament: Tournament,
  matchday: Matchday,
  fixture: Fixture,
): "pending" | "played" | "invalid" {
  const teamIds = new Set(tournament.teams.map(({ id }) => id));
  const status = getOperationalMatchStatus(fixture);
  const { operationalState: _operationalState, ...fixtureWithoutOperationalState } = fixture;
  if ((fixture.result !== undefined
      && !isValidPlayedFixture(tournament, matchday, fixtureWithoutOperationalState))
    || !teamIds.has(fixture.homeTeamId)
    || !teamIds.has(fixture.awayTeamId)
    || fixture.homeTeamId === fixture.awayTeamId
    || Boolean(validateFixtureDetails(tournament, fixture))
    || Boolean(validateGoalScorers(fixture.goalScorers ?? [], fixture))
    || (status === "finished" && fixture.result === undefined)) return "invalid";
  return fixture.result && status === "finished" ? "played" : "pending";
}

function hasIncompleteRoundRobinCalendar(tournament: Tournament): boolean {
  if (tournament.competitionType === "cup" || tournament.format === "staged"
    || tournament.teams.some((team) => team.groupName)
    || (tournament.format === undefined && tournament.competitionType !== "league")) return false;
  if (tournament.teams.length < 2 || tournament.legs < 1) return false;
  return !hasCompleteRoundRobinSchedule(tournament);
}

function hasUnverifiedRules(tournament: Tournament): boolean {
  return Boolean(tournament.matchRegulations && tournament.matchRegulations.verification !== "verified")
    || Boolean(tournament.competitionRules && (
      tournament.competitionRules.verification.standings !== "verified"
      || tournament.competitionRules.verification.placements !== "verified"
      || tournament.competitionRules.internationalQualification?.verification === "provisional"
      || tournament.competitionRules.internationalQualification?.verification === "pending"
      || tournament.competitionRules.relegationAverage?.verification === "provisional"
      || tournament.competitionRules.relegationAverage?.verification === "pending"
      || tournament.competitionRules.conditionalPlacements?.some(({ status }) => status !== "verified")
    ));
}

function getUnverifiedRulesDescription(tournament: Tournament): string {
  const pendingAreas = [
    tournament.matchRegulations?.verification !== "verified" && "reglamento de partidos",
    tournament.competitionRules?.verification.standings !== "verified" && "reglas de posiciones",
    tournament.competitionRules?.verification.placements !== "verified" && "reglas de clasificación",
    tournament.competitionRules?.internationalQualification
      && tournament.competitionRules.internationalQualification.verification !== "verified"
      && "clasificación internacional",
    tournament.competitionRules?.relegationAverage
      && tournament.competitionRules.relegationAverage.verification !== "verified"
      && "promedios de descenso",
    tournament.competitionRules?.conditionalPlacements?.some(({ status }) => status !== "verified")
      && "clasificaciones condicionales",
  ].filter((area): area is string => Boolean(area));
  return `Requieren revisión: ${pendingAreas.join(", ")}. Es una alerta informativa; estas configuraciones no se presentan como oficiales ni verificadas.`;
}

function getMatchLabel(matchday: Matchday, fixture: Fixture, tournament: Tournament): string {
  const teamNames = new Map(tournament.teams.map(({ id, name }) => [id, name]));
  return `${teamNames.get(fixture.homeTeamId) ?? "Equipo local no identificado"} contra ${teamNames.get(fixture.awayTeamId) ?? "equipo visitante no identificado"} (${formatMatchday(matchday)})`;
}

function formatMatchday(matchday: Matchday): string {
  return `${matchday.phaseName ? `${matchday.phaseName} · ` : ""}Fecha ${matchday.number}${matchday.leg > 1 ? ` · rueda ${matchday.leg}` : ""}`;
}

function formatLocalDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addAlert(
  alerts: CompetitionAlert[],
  tournament: Tournament,
  alert: Omit<CompetitionAlert, "id" | "competitionName" | "season"> & { key: string },
): void {
  if (alerts.some(({ id }) => id === `${tournament.id}:${alert.key}`)) return;
  alerts.push({
    id: `${tournament.id}:${alert.key}`,
    type: alert.type,
    priority: alert.priority,
    title: alert.title,
    description: alert.description,
    competitionName: tournament.name,
    ...(tournament.season !== undefined ? { season: tournament.season } : {}),
    ...(alert.matchday ? { matchday: alert.matchday } : {}),
    ...(alert.fixtureId ? { fixtureId: alert.fixtureId } : {}),
    action: alert.action,
  });
}
