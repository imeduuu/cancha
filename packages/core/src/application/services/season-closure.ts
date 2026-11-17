import type { Tournament } from "../../domain/entities/tournament";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import { isSeasonClosureRecord } from "../../domain/entities/season-closure";
import { validateTournamentIntegrity } from "../../domain/services/tournament-integrity";
import { getCompetitionAlerts } from "../../domain/services/competition-alerts";
import { getFinalStandings, getTournamentCompletionStatus } from "../../domain/services/tournament-history";
import { calculateStandings, getUnresolvedStandingsTieGroups } from "../../domain/services/standings";
import { getDivisionOutcome, regularDivisionTournament, divisionZoneTournaments } from "../../domain/services/second-division-progression";
import { secondDivisionKind } from "../../domain/services/second-division-rules";
import { calculateRelegationAverages } from "../../domain/services/relegation-averages";
import { classifyPosition } from "../../domain/services/placement-classification";
import { isValidPlayedFixture } from "../../domain/services/tournament-statistics";
import { canonical } from "../../domain/services/continental-plan";
import { seasonHonours } from "./club-honours";
import { seasonOverview, competitionIdentity } from "./competition-center";
import { nationalContinentalProjection, continentalProjection, continentalPlanState, sourceScenario } from "./continental-projection";
import { nationalCupReviewState } from "./national-cup-planning";
import { projectSeasonProgression } from "./season-progression";

export type ClosureState = "Sin calendario" | "Temporada en disputa" | "Partidos pendientes" | "Decisiones deportivas pendientes" | "Lista para revisión final" | "Cierre confirmado" | "Cierre desactualizado";

/** Aggregation only: no progression, generation, randomness or persistence. Inputs are scoped by the caller. */
export function evaluateSeasonClosure(t: Tournament, tournaments: readonly Tournament[], activity: readonly ActivityEvent[], universeId: string | null) {
  const blockers: string[] = [], warnings: string[] = [], nextSeasonPending: string[] = [];
  const integrity = validateTournamentIntegrity(t);
  blockers.push(...integrity);
  const overview = seasonOverview(t, activity), honours = seasonHonours(t);
  const finalStandings = getFinalStandings(t);
  const completion = getTournamentCompletionStatus(t);
  const rules = t.competitionRules;
  if (!Number.isSafeInteger(t.season) || !rules || rules.season !== t.season
    || rules.verification.standings !== "verified" || rules.verification.placements !== "verified")
    blockers.push("Verifica el reglamento anual de tabla y decisiones deportivas para esta edición.");
  if (t.matchRegulations && (t.matchRegulations.season !== t.season || t.matchRegulations.verification !== "verified"))
    blockers.push("El reglamento de partidos registrado necesita verificación para esta edición.");
  if (!overview.total) blockers.push("No hay calendario: una temporada sin encuentros no está terminada.");
  if (overview.played < overview.total) blockers.push("Quedan encuentros pendientes o sin resultado deportivo válido.");
  if (t.matchdays.some(day => !day.fixtures.length)) blockers.push("Hay jornadas o fases registradas sin encuentros.");
  if (completion !== "Finalizado") blockers.push("El servicio de finalización no acredita todas las etapas obligatorias de este formato.");
  blockers.push(...honours.reasons);
  const division = secondDivisionKind(t) ? getDivisionOutcome(t) : undefined;
  if (division) blockers.push(...division.pending);
  const tables = finalStandings ? [{label: "Clasificación final", rows: finalStandings}]
    : division ? (secondDivisionKind(t) === "argentina" ? divisionZoneTournaments(t) : [regularDivisionTournament(t)])
      .map(zone => ({label: zone.zoneName ?? "Fase regular", rows: calculateStandings(zone)})) : [];
  if (finalStandings && getUnresolvedStandingsTieGroups(t, finalStandings).length)
    blockers.push("Hay posiciones finales con desempates sin resolver; revisa las decisiones deportivas.");
  const alerts = getCompetitionAlerts(t);
  for (const alert of alerts) {
    if (["invalid-match", "invalid-individual-data", "calendar-incomplete", "knockout-pending", "operational-result-mismatch"].includes(alert.type)) blockers.push(alert.description);
    else warnings.push(alert.description);
  }
  const ownDependencyIds = new Set<string>();
  for (const plan of t.continentalPlans ?? []) {
    plan.dependencies.forEach(d => ownDependencyIds.add(d.tournamentId));
    if (continentalPlanState(plan, tournaments, activity).startsWith("Desactualizada")) blockers.push("La planificación continental de esta edición requiere nueva revisión.");
    if (plan.mode === "incorporated" && (plan.entries.some(e => e.status !== "confirmed") || plan.pendingReasons?.length))
      blockers.push("La admisión de esta edición continental conserva decisiones o participantes provisionales.");
  }
  for (const review of t.nationalCupPlanning?.reviews ?? []) {
    review.dependencies.forEach(d => ownDependencyIds.add(d.tournamentId));
    if (nationalCupReviewState(review, tournaments, activity) === "Dependencia desactualizada") blockers.push("La admisión nacional de esta edición tiene dependencias desactualizadas.");
    if (review.mode === "incorporated" && (review.regulation.verification !== "verified" || review.participants.some(p => p.status !== "confirmed")))
      blockers.push("La admisión nacional de esta edición todavía es provisional.");
  }
  if (t.nationalCupPlanning?.requiresReview) blockers.push("La admisión nacional requiere revisión documental expresa.");
  const averages = rules?.relegationAverage ? calculateRelegationAverages(t, tournaments, rules.relegationAverage) : undefined;
  if (averages) {
    blockers.push(...averages.pendingReasons);
    if (averages.verification !== "verified" || averages.standings.some(row => row.status !== "confirmed")) blockers.push("Los descensos por promedio no están definitivamente resueltos.");
    tournaments.filter(source => competitionIdentity(source) === competitionIdentity(t)
      && rules!.relegationAverage!.seasons.includes(source.season ?? 0)).forEach(source => ownDependencyIds.add(source.id));
  }
  const relegated = [...(division?.relegated ?? (finalStandings ? finalStandings.flatMap((row, index) =>
    t.placementRules && classifyPosition(index + 1, finalStandings.length, t.placementRules) === "relegation" ? [{teamId: row.teamId, destination: "Descenso según reglamento registrado"}] : []) : []))];
  if (!division && t.placementRules?.relegationPlayoffPlaces) blockers.push("Hay plazas de promoción de descenso que requieren una resolución deportiva existente; la tabla no resuelve la promoción.");
  if (averages && t.placementRules?.relegationPlaces)
    blockers.push("Los descensos por tabla y promedio requieren una resolución conjunta en el flujo deportivo existente; no se sintetizan movimientos nuevos.");
  for (const id of ownDependencyIds) if (!tournaments.some(source => source.id === id)) blockers.push(`Dependencia propia no disponible en este universo: ${id}.`);
  const international = rules?.internationalQualification || t.placementRules?.libertadoresPlaces || t.placementRules?.sudamericanaPlaces
    ? nationalContinentalProjection(t, tournaments, activity) : undefined;
  if (international) {
    nextSeasonPending.push(...international.reasons);
    nextSeasonPending.push(...continentalProjection([t.id], t.season ?? 0, "libertadores", tournaments, activity).reasons);
    if (international.entries.some(entry => entry.status !== "confirmed")) nextSeasonPending.push("Hay clasificaciones internacionales provisionales o pendientes para preparar la edición de destino.");
  }
  const progression = projectSeasonProgression([t.id], tournaments, activity);
  nextSeasonPending.push(...progression.dependencies.filter(d => d.sourceId === t.id || !ownDependencyIds.has(d.sourceId))
    .map(d => `${d.reason}: ${d.sourceId} → ${d.targetId}`));
  if (t.archived) warnings.push("La competición está archivada: confirmar su revisión no la desarchiva ni modifica permisos de edición.");
  const affectedIds = new Set([t.id, ...ownDependencyIds]);
  const foundation = canonical({tournament: t, universeId, scenario: sourceScenario(t, activity),
    activity: activity.filter(event => affectedIds.has(event.tournamentId) && !["season-closure-confirmed", "association-recorded", "club-affiliation-recorded", "library-restored"].includes(event.action))
      .map(event => ({id: event.id, action: event.action, occurredAt: event.occurredAt})),
    dependencies: [...ownDependencyIds].sort().map(id => ({id, tournament: tournaments.find(source => source.id === id) ?? null}))});
  const history = activity.filter(event => event.action === "season-closure-confirmed" && event.tournamentId === t.id);
  // Activity is append ordered. An obsolete last confirmation never revives an older one.
  const latest = history.at(-1);
  const confirmed = !!latest && isSeasonClosureRecord(latest.after) && latest.after.universeId === universeId
    && latest.after.foundation === foundation && latest.after.championTeamId === honours.awards.find(award => award.label === "Campeón")?.teamId && !blockers.length;
  const state: ClosureState = confirmed ? "Cierre confirmado" : latest ? "Cierre desactualizado"
    : !overview.total ? "Sin calendario" : overview.played < overview.total ? (overview.played ? "Temporada en disputa" : "Partidos pendientes")
    : blockers.length ? "Decisiones deportivas pendientes" : "Lista para revisión final";
  const matchdays = t.matchdays.map((day, index) => ({index, phase: day.phaseName ?? `Rueda ${day.leg}`,
    label: `${day.phaseName ?? `Rueda ${day.leg}`} · Jornada ${day.number}`,
    complete: day.fixtures.length > 0 && day.fixtures.every(fixture => isValidPlayedFixture(t, day, fixture))}));
  const phases = [...new Set(matchdays.map(day => day.phase))].map((label,index) => ({index,label,complete:matchdays.filter(day=>day.phase===label).every(day=>day.complete)}));
  const dependencyIds = new Set([...ownDependencyIds, ...(international?.dependencyIds ?? []), ...progression.dependencies.flatMap(d=>[d.sourceId,d.targetId])]);
  dependencyIds.delete(t.id);
  const dependencies = [...dependencyIds].map(id=>({id, name:tournaments.find(source=>source.id===id)?.name ?? id,
    available:tournaments.some(source=>source.id===id), kind:ownDependencyIds.has(id)?"Fundamento de esta edición":"Preparación o antecedente"}));
  return {tournament: t, overview, integrity, honours, tables, division, relegated, averages, international, progression,matchdays,phases,dependencies,
    resolutions: t.officialResolutions ?? [], blockers: [...new Set(blockers)], warnings: [...new Set(warnings)],
    nextSeasonPending: [...new Set(nextSeasonPending)], foundation, history, latest, confirmed, state,
    canConfirm: !blockers.length && !confirmed};
}
