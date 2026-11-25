import { DomainError } from "../domain-error.js";
import type { ContinentalCup, ContinentalPlan } from "../entities/continental-plan";
import type { Tournament } from "../entities/tournament";
export function continentalDestination(destination: string): ContinentalCup | undefined {
  if (["conmebol-libertadores", "libertadores", "libertadores-qualifying"].includes(destination)) return "libertadores";
  if (["conmebol-sudamericana", "sudamericana"].includes(destination)) return "sudamericana";
  return undefined;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim();
const year = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
export function isHttpsReference(v: unknown): v is string {
  try { const u = new URL(String(v)); return typeof v === "string" && u.protocol === "https:" && !u.username && !u.password; } catch { return false; }
}
export function isContinentalPlan(v: unknown): v is ContinentalPlan {
  if (!record(v) || v.schemaVersion !== 1 || !text(v.id) || !text(v.at) || !Number.isFinite(Date.parse(v.at))
    || !["libertadores", "sudamericana"].includes(String(v.cup)) || !year(v.edition) || !year(v.qualifyingSeason)
    || v.edition < v.qualifyingSeason || !isHttpsReference(v.sourceUrl) || !text(v.note)
    || (v.pendingReasons !== undefined && (!Array.isArray(v.pendingReasons) || !v.pendingReasons.every(text)))
    || !["incorporated", "review"].includes(String(v.mode)) || (v.requiresReview !== undefined && typeof v.requiresReview !== "boolean")
    || !Array.isArray(v.sourceTournamentIds) || !v.sourceTournamentIds.length || !v.sourceTournamentIds.every(text)
    || new Set(v.sourceTournamentIds).size !== v.sourceTournamentIds.length || !Array.isArray(v.dependencies)
    || !v.dependencies.every(d => record(d) && text(d.tournamentId) && text(d.snapshot) && (() => {
      try { const parsed: unknown = JSON.parse(d.snapshot as string); return record(parsed) && parsed.id === d.tournamentId; } catch { return false; }
    })()) || new Set(v.dependencies.map(d => d.tournamentId)).size !== v.dependencies.length
    || !v.sourceTournamentIds.every(id => (v.dependencies as {tournamentId:string}[]).some(d => d.tournamentId === id))
    || !Array.isArray(v.entries)) return false;
  return v.entries.every(e => record(e) && text(e.sourceTournamentId) && (v.sourceTournamentIds as string[]).includes(e.sourceTournamentId)
    && text(e.sourceTournamentName) && text(e.originTournamentName) && (e.sourceCompetitionId === undefined || text(e.sourceCompetitionId))
    && text(e.originTournamentId) && (v.dependencies as {tournamentId:string}[]).some(d => d.tournamentId === e.originTournamentId)
    && e.sourceSeason === v.qualifyingSeason && text(e.sourceTeamId) && text(e.teamName) && text(e.clubIdentity)
    && text(e.destination) && continentalDestination(e.destination) === v.cup
    && ["confirmed", "provisional", "pending"].includes(String(e.status))
    && ["local", "provider", "unknown"].includes(String(e.scenario))
    && (e.targetTeamId === undefined || text(e.targetTeamId)))
    && new Set(v.entries.map(e => `${e.sourceTournamentId}:${e.originTournamentId}:${e.sourceTeamId}:${e.destination}`)).size === v.entries.length
    && new Set(v.entries.map(e => e.clubIdentity)).size === v.entries.length
    && new Set(v.entries.flatMap(e => e.targetTeamId ? [e.targetTeamId] : [])).size === v.entries.filter(e => e.targetTeamId).length
    && (v.mode !== "incorporated" || v.entries.length > 0 && v.entries.every(e => e.status !== "pending" && text(e.targetTeamId)));
}
export function validateContinentalPlans(t: Tournament): string[] {
  if (t.continentalPlans === undefined) return [];
  return Array.isArray(t.continentalPlans) && t.continentalPlans.every(isContinentalPlan)
    && new Set(t.continentalPlans.map(p => p.id)).size === t.continentalPlans.length
    && t.continentalPlans.every(p => p.edition === t.season && (p.requiresReview || (t.competitionId ?? t.id.replace(/-\d{4}$/, "")) === `conmebol-${p.cup}`))
    ? [] : ["Registro de clasificación continental inválido o incompatible con la edición."];
}
/** Canonical serialization keeps dependency checks stable across JSON v7 round trips. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function mergeContinentalPlanHistory(previous: readonly ContinentalPlan[] | undefined, incoming: readonly ContinentalPlan[] | undefined): readonly ContinentalPlan[] | undefined {
  if (!previous) return incoming;
  const merged=[...previous];
  for (const record of incoming ?? []) {
    const old=merged.find(p => p.id === record.id);
    if (old && canonical(old) !== canonical(record)) throw new DomainError("Una revisión continental existente no puede sobrescribirse; registra una nueva revisión.");
    if (!old) merged.push(record);
  }
  return merged;
}
