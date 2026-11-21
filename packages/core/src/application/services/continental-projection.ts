import type { Tournament } from "../../domain/entities/tournament";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { ContinentalCup, ContinentalEntry, ContinentalPlan } from "../../domain/entities/continental-plan";
import { calculateInternationalQualifications, type InternationalQualification } from "../../domain/services/international-qualification";
import { calculateStandings } from "../../domain/services/standings";
import { classifyContinentalPosition } from "../../domain/services/placement-classification";
import { normalizeTeamName } from "../../domain/services/team-name";
import { canonical, continentalDestination } from "../../domain/services/continental-plan";
import { competitionIdentity } from "./competition-center";
import { isLocalScenario } from "./champion-tier";

export const entryKey = (e: ContinentalEntry) => JSON.stringify([e.sourceTournamentId, e.originTournamentId, e.sourceTeamId, e.destination]);
export function sourceScenario(t: Tournament, activity: readonly ActivityEvent[]): ContinentalEntry["scenario"] {
  if (isLocalScenario(t, activity)) return "local";
  return t.sourceUrl ? "provider" : "unknown";
}
export function continentalSourceSnapshot(id: string, tournaments: readonly Tournament[], activity: readonly ActivityEvent[]) {
  const t = tournaments.find(t => t.id === id);
  return canonical(t ? { id, competitionId: t.competitionId, season: t.season, teams: t.teams, legs: t.legs,
    format: t.format, competitionType: t.competitionType, matchdays: t.matchdays, knockoutStages: t.knockoutStages,
    tieBreakers: t.tieBreakers, pointsSystem: t.pointsSystem, competitionRules: t.competitionRules,
    placementRules: t.placementRules, importCoverage: t.importCoverage, matchRegulations: t.matchRegulations,
    scenario: sourceScenario(t,activity) } : { id, missing: true });
}
export function nationalContinentalProjection(source: Tournament, tournaments: readonly Tournament[], activity: readonly ActivityEvent[]) {
  const reasons: string[] = [];
  const annualArgentina = competitionIdentity(source) === "arg-liga-profesional" && source.season === 2026;
  const tableSource = annualArgentina ? { ...source, matchdays: source.matchdays.filter(d =>
    d.phaseName?.includes("Fase regular") || d.phaseName?.includes("Fase de grupos")) } : source;
  const rules = source.competitionRules;
  if (!annualArgentina && new Set(source.teams.map(t => t.groupName).filter(Boolean)).size > 1) {
    return { entries: [] as ContinentalEntry[], qualificationRoutes: [] as InternationalQualification[], reasons: ["No hay una tabla anual única registrada para estas zonas; no se combinan sus cupos."], dependencyIds: [source.id] };
  }
  const standings = calculateStandings(tableSource);
  const explicitRules = rules?.internationalQualification;
  const baseSlots = standings.flatMap((_row,index) => {
    const destination = source.placementRules && classifyContinentalPosition(index + 1, source.placementRules);
    return destination ? [{destination,position:index+1}] : [];
  });
  const calculated = calculateInternationalQualifications(standings, tableSource, tournaments,
    explicitRules ?? {verification:"provisional",slots:baseSlots},rules?.verification.placements ?? "provisional");
  const qualifications = calculated.qualifications;
  reasons.push(...calculated.pendingReasons);
  if (!explicitRules) reasons.push("Solo hay cupos base por posición o no hay una regla internacional registrada. No se infieren campeones ni corrimientos.");
  const annualMismatch = source.season === undefined || !!rules && rules.season !== source.season;
  if (annualMismatch) reasons.push("La temporada de origen falta o es incompatible con el reglamento.");
  const conditional = rules?.conditionalPlacements?.filter(c => c.status !== "verified") ?? [];
  reasons.push(...conditional.map(c => c.description));
  const entries: ContinentalEntry[] = [];
  for (const q of qualifications) {
    if (!continentalDestination(q.destination)) { reasons.push(`Destino sin vinculación continental registrada: ${q.destination}.`); continue; }
    const origin = tournaments.find(t => t.id === (q.originTournamentId ?? source.id)) ?? source;
    const team = origin.teams.find(t => t.id === q.teamId);
    if (!team) { reasons.push(`Identidad de club no disponible: ${q.teamId}.`); continue; }
    entries.push({ sourceTournamentId: source.id, originTournamentId: origin.id, sourceTournamentName: source.name, originTournamentName: origin.name,
      ...(source.competitionId ? {sourceCompetitionId:source.competitionId}: {}), sourceSeason: source.season ?? 0,
      sourceTeamId: q.teamId, teamName: team.name, clubIdentity: normalizeTeamName(team.averageIdentity ?? team.name),
      destination: q.destination, status: annualMismatch || origin.season !== source.season || conditional.some(c => c.status === "pending")
        ? "pending" : conditional.length && q.status === "confirmed" ? "provisional" : q.status,
      scenario: sourceScenario(source,activity) === "local" || sourceScenario(origin,activity) === "local" ? "local" : sourceScenario(origin,activity) });
  }
  return { entries, qualificationRoutes: qualifications, reasons: [...new Set(reasons)], dependencyIds: [...new Set([source.id,
    ...(rules?.internationalQualification?.cupChampions?.map(c => c.sourceTournamentId) ?? [])])] };
}
export function continentalProjection(sourceIds: readonly string[], qualifyingSeason: number, cup: ContinentalCup,
  tournaments: readonly Tournament[], activity: readonly ActivityEvent[]) {
  const reasons: string[] = [];
  const allEntries: ContinentalEntry[] = [];
  const dependencies = new Set<string>();
  for (const id of sourceIds) {
    const source = tournaments.find(t => t.id === id);
    if (!source) { reasons.push(`Origen no disponible: ${id}.`); continue; }
    const result = nationalContinentalProjection(source,tournaments,activity);
    dependencies.add(source.id); result.dependencyIds.forEach(id => dependencies.add(id));
    if (source.season !== qualifyingSeason) { reasons.push(`${source.name}: temporada de origen incompatible con ${qualifyingSeason}.`); continue; }
    reasons.push(...result.reasons.map(r => `${source.name}: ${r}`)); allEntries.push(...result.entries);
  }
  const conflicts = new Set<string>();
  for (const entry of allEntries) {
    const duplicates = allEntries.filter(e => e.clubIdentity === entry.clubIdentity || e.sourceTeamId === entry.sourceTeamId);
    if (duplicates.length > 1) {
      duplicates.forEach(e => conflicts.add(entryKey(e)));
      reasons.push(`Identidad repetida, ambigua o con cupos incompatibles: ${entry.teamName}. Revisa los orígenes; no se fusionan clubes por nombre.`);
    }
  }
  return { entries: allEntries.filter(e => continentalDestination(e.destination) === cup), reasons: [...new Set(reasons)],
    conflicts: [...conflicts], dependencies: [...dependencies].map(tournamentId => ({ tournamentId, snapshot: continentalSourceSnapshot(tournamentId,tournaments,activity) })) };
}
export function continentalPlanState(plan: ContinentalPlan, tournaments: readonly Tournament[], activity: readonly ActivityEvent[]) {
  return plan.requiresReview || plan.dependencies.some(d => d.snapshot !== continentalSourceSnapshot(d.tournamentId,tournaments,activity))
    ? "Desactualizada · requiere nueva revisión" : "Dependencias vigentes · planificación local";
}
/** Nominal comparison only: never establishes identities or changes published rosters. */
export function continentalRosterDifferences(entries: readonly ContinentalEntry[], cup: Tournament) {
  const planned = new Set(entries.map(e => e.clubIdentity));
  const published = new Set(cup.teams.map(t => normalizeTeamName(t.averageIdentity ?? t.name)));
  return { missing: entries.filter(e => !published.has(e.clubIdentity)).map(e => e.teamName),
    added: cup.teams.filter(t => !planned.has(normalizeTeamName(t.averageIdentity ?? t.name))).map(t => t.name),
    nominal: entries.filter(e => published.has(e.clubIdentity)).map(e => e.teamName) };
}
