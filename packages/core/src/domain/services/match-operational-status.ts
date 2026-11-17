import type {
  Fixture,
  Matchday,
  OperationalMatchStatus,
  Tournament,
} from "../entities/tournament";
import { isValidFixtureResult } from "./match-result-validation";
import { validateMatchSchedule } from "./match-scheduling";

const transitions: Readonly<Record<OperationalMatchStatus, readonly OperationalMatchStatus[]>> = {
  unscheduled: ["scheduled"],
  scheduled: ["unscheduled", "in-progress", "postponed", "cancelled"],
  "in-progress": ["suspended", "finished"],
  finished: ["postponed", "suspended", "cancelled"],
  postponed: ["unscheduled", "scheduled", "cancelled"],
  suspended: ["in-progress", "finished", "postponed", "cancelled"],
  cancelled: [],
};

export function getOperationalMatchStatus(fixture: Fixture): OperationalMatchStatus {
  if (fixture.operationalState) return fixture.operationalState.status;
  if (fixture.result !== undefined) return "finished";
  if (fixture.schedule?.date || fixture.schedule?.time) return "scheduled";
  return "unscheduled";
}

export function getAllowedOperationalTransitions(
  status: OperationalMatchStatus,
): readonly OperationalMatchStatus[] {
  return transitions[status];
}

export function isOperationallyFinished(fixture: Fixture): boolean {
  return fixture.operationalState
    ? fixture.operationalState.status === "finished"
    : fixture.result !== undefined;
}

export function validateOperationalTransition(
  tournament: Tournament,
  matchday: Matchday,
  fixture: Fixture,
  nextStatus: OperationalMatchStatus,
  confirmedAmbiguousResult = false,
): string | undefined {
  const current = getOperationalMatchStatus(fixture);
  if (!getAllowedOperationalTransitions(current).includes(nextStatus)) {
    return `No se permite cambiar un partido ${getOperationalStatusLabel(current).toLocaleLowerCase("es")} a ${getOperationalStatusLabel(nextStatus).toLocaleLowerCase("es")}.`;
  }
  if (nextStatus === "scheduled") {
    if (!fixture.schedule?.date || !fixture.schedule.time) {
      return "Registra una fecha y hora completas antes de marcar el partido como programado.";
    }
    const scheduleIssue = validateMatchSchedule(fixture.schedule);
    if (scheduleIssue) return scheduleIssue;
  }
  if (nextStatus === "finished") {
    const { operationalState: _operationalState, ...fixtureWithoutState } = fixture;
    if (!fixture.result || !isValidResultWithoutOperationalState(tournament, matchday, fixtureWithoutState)) {
      return "Un partido solo puede finalizar con un resultado deportivo válido.";
    }
  }
  if (fixture.result !== undefined
    && nextStatus !== "finished"
    && !confirmedAmbiguousResult) {
    return "Este partido conserva un marcador. Confirma que el estado operativo cambiará, pero el marcador y sus detalles se conservarán y dejarán de contar como resultado final hasta resolver la situación.";
  }
  return undefined;
}

export function getOperationalStatusLabel(status: OperationalMatchStatus): string {
  const labels: Record<OperationalMatchStatus, string> = {
    unscheduled: "Sin programar",
    scheduled: "Programado",
    "in-progress": "En juego",
    finished: "Finalizado",
    postponed: "Aplazado",
    suspended: "Suspendido",
    cancelled: "Cancelado",
  };
  return labels[status];
}

export function isOperationalStateSimulationBlocked(fixture: Fixture): boolean {
  const status = getOperationalMatchStatus(fixture);
  return status === "in-progress"
    || status === "postponed"
    || status === "suspended"
    || status === "cancelled"
    || (status === "finished" && fixture.result === undefined);
}

function isValidResultWithoutOperationalState(
  tournament: Tournament,
  matchday: Matchday,
  fixture: Fixture,
): boolean {
  return isValidFixtureResult(tournament, matchday, fixture);
}
