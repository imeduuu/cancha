import type { Tournament } from "../../domain/entities/tournament";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import { getTournamentCompletionStatus, getTournamentCompetitionId } from "../../domain/services/tournament-history";
import { isValidPlayedFixture } from "../../domain/services/tournament-statistics";
import { getDivisionOutcome } from "../../domain/services/second-division-progression";
import { getCompetitionAlerts } from "../../domain/services/competition-alerts";
import { secondDivisionKind } from "../../domain/services/second-division-rules";

// Identity catalog only: no sporting rules or relationships are inferred from labels.
const catalog: Readonly<Record<string, readonly [string, string, string]>> = {
  "arg-liga-profesional": ["Argentina", "Primera División", "Primera"],
  "arg-primera-nacional": ["Argentina", "Primera Nacional", "Segunda"],
  "brasileirao-serie-a": ["Brasil", "Série A", "Primera"],
  "brasileirao-serie-b": ["Brasil", "Série B", "Segunda"],
  "afa-copa-argentina": ["Argentina", "Copa Argentina", "Copa nacional"],
  "cbf-copa-do-brasil": ["Brasil", "Copa do Brasil", "Copa nacional"],
  "conmebol-libertadores": ["CONMEBOL", "Copa Libertadores", "Continental"],
  "conmebol-sudamericana": ["CONMEBOL", "Copa Sudamericana", "Continental"],
  "anfp-liga-primera": ["Chile", "Primera División", "Primera"],
  "anfp-liga-de-ascenso": ["Chile", "Primera B", "Segunda"],
  "anfp-liga-segunda": ["Chile", "Segunda División", "Tercera"],
  "anfp-liga-segunda-ascenso": ["Chile", "Segunda División · Zona de Ascenso", "Tercera"],
  "anfp-liga-segunda-descenso": ["Chile", "Segunda División · Zona de Descenso", "Tercera"],
  "anfp-copa-chile": ["Chile", "Copa Chile", "Copa nacional"],
  "anfp-copa-de-la-liga": ["Chile", "Copa de la Liga", "Copa nacional"],
  "anfa-tercera-a": ["Chile", "Tercera A", "Cuarta"],
  "anfa-tercera-b-norte": ["Chile", "Tercera B Norte", "Quinta"],
  "anfa-tercera-b-sur": ["Chile", "Tercera B Sur", "Quinta"],
};
export function competitionIdentity(t: Tournament): string {
  const legacy = getTournamentCompetitionId(t.id);
  return t.competitionId ?? (legacy && Object.prototype.hasOwnProperty.call(catalog, legacy) ? legacy : t.id);
}
export function groupCompetitions(tournaments: readonly Tournament[]) {
  const groups = new Map<string, { id: string; territory: string; name: string; category: string; seasons: Tournament[] }>();
  for (const t of tournaments) {
    const id = competitionIdentity(t);
    let group = groups.get(id);
    if (!group) {
      const metadata = Object.prototype.hasOwnProperty.call(catalog, id) ? catalog[id] : undefined;
      group = { id, territory: metadata?.[0] ?? "Sin país registrado", name: metadata?.[1] ?? t.name,
        category: metadata?.[2] ?? "Categoría no registrada", seasons: [] };
      groups.set(id, group);
    }
    group.seasons.push(t);
  }
  return [...groups.values()].map(group => ({ ...group, seasons: group.seasons.sort((a,b) =>
    (b.season ?? 0) - (a.season ?? 0) || a.id.localeCompare(b.id)) }))
    .sort((a,b) => a.territory.localeCompare(b.territory, "es") || a.name.localeCompare(b.name, "es"));
}
export function hasLocalSeasonActivity(tournamentId: string, activity: readonly ActivityEvent[]) {
  return activity.some(e => e.tournamentId === tournamentId && (
    ["matches-simulated", "match-result-updated", "tournament-duplicated", "season-created"].includes(e.action)
    || e.action === "tournament-imported" && !!e.after && typeof e.after === "object" && "decision" in e.after && e.after.decision === "copy"
  ));
}
export function seasonOverview(t: Tournament, activity: readonly ActivityEvent[]) {
  const local = hasLocalSeasonActivity(t.id,activity);
  const planning = Boolean(t.seasonPreparation || t.continentalPlans?.some(p => p.mode === "incorporated"));
  const provenance = planning ? "Planificación · escenario local" : local ? "Escenario local · resultados editados o simulados"
    : t.sourceUrl ? "Importada · resultados sin certificación oficial" : "Personalizada o procedencia no registrada";
  const fixtures = t.matchdays.flatMap(d => d.fixtures.map(f => ({ d, f })));
  const played = fixtures.filter(({ d,f }) => isValidPlayedFixture(t,d,f)).length;
  const rules = t.competitionRules;
  const verification = rules && rules.season === t.season ? rules.verification : undefined;
  const labels = { verified: "verificado", provisional: "provisional", pending: "pendiente" };
  const pending = secondDivisionKind(t) ? getDivisionOutcome(t).pending : [];
  return { provenance, played, total: fixtures.length, status: getTournamentCompletionStatus(t),
    rules: `Tabla: ${labels[verification?.standings ?? "pending"]}; clasificaciones: ${labels[verification?.placements ?? "pending"]}`,
    pending: [...new Set([...pending, ...(played < fixtures.length ? ["Hay partidos pendientes o sin resultado válido."] : []), ...getCompetitionAlerts(t).filter(a => ["knockout-pending", "calendar-incomplete", "incomplete-schedule", "regulations-review"].includes(a.type)).map(a => a.description), ...(verification?.placements !== "verified" ? ["Clasificaciones pendientes de reglamento verificado."] : []),
      ...(rules?.conditionalPlacements?.filter(p => p.status !== "verified").map(p => p.description) ?? [])])],
  };
}
/** Explicit references only. Missing source records remain visible, never guessed. */
export function seasonOrigins(t: Tournament, activity: readonly ActivityEvent[]): readonly string[] {
  const ids = [...(t.seasonPreparation?.sourceTournamentIds ?? [])];
  for (const e of activity) {
    if (e.tournamentId !== t.id || e.action !== "season-created" || !e.before || typeof e.before !== "object") continue;
    const before = e.before as Record<string, unknown>;
    for (const key of ["sourceTournamentId", "upperId", "lowerId"]) {
      if (typeof before[key] === "string") ids.push(before[key]);
    }
  }
  return [...new Set(ids)];
}

export function recordedSeasonMovements(t: Tournament, activity: readonly ActivityEvent[]) {
  for (const event of [...activity].reverse()) {
    if (event.action !== "season-created" || !event.after || typeof event.after !== "object") continue;
    const data = event.after as Record<string, unknown>;
    if (!Array.isArray(data.tournamentIds) || !data.tournamentIds.includes(t.id)) continue;
    const strings = (key: string) => Array.isArray(data[key]) ? data[key].filter((id): id is string => typeof id === "string") : [];
    return { promoted: strings("promoted"), upperRelegated: strings("upperRelegated"), lowerRelegated: strings("lowerRelegated"), at: event.occurredAt };
  }
  return undefined;
}
