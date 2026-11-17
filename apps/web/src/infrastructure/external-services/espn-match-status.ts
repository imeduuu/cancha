import type { OperationalMatchStatus } from "@cancha/core/domain/entities/tournament";

export type EspnMatchOperationalStatus = OperationalMatchStatus | "abandoned";

export function parseEspnMatchOperationalStatus(
  statusType: { readonly name?: unknown; readonly state?: unknown; readonly completed?: unknown },
  matchId: string,
): EspnMatchOperationalStatus {
  const name = typeof statusType.name === "string" ? statusType.name : "";
  const state = typeof statusType.state === "string" ? statusType.state.toLowerCase() : "";

  if (/ABANDONED/i.test(name)) return "abandoned";
  if (/CANCELLED|CANCELED/i.test(name)) return "cancelled";
  if (/POSTPONED/i.test(name)) return "postponed";
  if (/SUSPENDED/i.test(name)) return "suspended";
  if (/IN_PROGRESS|INPROGRESS|HALFTIME|FIRST_HALF|SECOND_HALF/i.test(name) || state === "in") {
    return "in-progress";
  }
  if (statusType.completed === true || /FULL_TIME|FINAL/i.test(name)) {
    return "finished";
  }
  if (/SCHEDULED|PRE/i.test(name) || state === "pre") return "scheduled";

  throw new Error(`La API de ESPN publicó un estado desconocido o incompleto para el partido ${matchId}.`);
}
