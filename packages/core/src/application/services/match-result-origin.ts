import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { Tournament } from "../../domain/entities/tournament";

/** Use recorded operations, never the calendar's provenance, to attribute results. */
export function matchResultOrigin(t: Tournament, fixtureId: string, activity: readonly ActivityEvent[]): string {
  for (const event of [...activity].reverse()) {
    if (event.tournamentId !== t.id) continue;
    if (event.action === "match-result-updated" && event.entityId === fixtureId) return "Resultado manual";
    if (event.action === "matches-simulated" && event.after && typeof event.after === "object") {
      const data = event.after as Record<string, unknown>;
      const results = (data.change ?? data) as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(results, fixtureId)) return "Resultado simulado localmente";
    }
  }
  return t.sourceUrl ? "Resultado importado de fuente · sin certificación oficial" : "Procedencia del resultado no acreditada";
}
