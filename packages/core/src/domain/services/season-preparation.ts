import type { Tournament, SeasonPreparation } from "../entities/tournament";

export const divisionCompetitions = {
  "arg-liga-profesional": "argentina-primera",
  "arg-primera-nacional": "argentina-nacional",
  "brasileirao-serie-a": "brasil-primera",
  "brasileirao-serie-b": "brasil-serie-b",
} as const;
export function seasonCompetition(t: Tournament): keyof typeof divisionCompetitions | undefined {
  const id = t.competitionId ?? t.id.replace(/-\d{4}$/, "");
  return Object.prototype.hasOwnProperty.call(divisionCompetitions, id) ? id as keyof typeof divisionCompetitions : undefined;
}
export function isSeasonPreparation(value: unknown): value is SeasonPreparation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const names = (x: unknown): x is string[] => Array.isArray(x) && x.every(n => typeof n === "string" && n.trim().length > 0)
    && new Set(x).size === x.length;
  const https = (x: unknown) => { try { return typeof x === "string" && new URL(x).protocol === "https:"; } catch { return false; } };
  return v.schemaVersion === 1 && names(v.sourceTournamentIds) && names(v.plannedParticipants)
    && Array.isArray(v.calendarReviews) && v.calendarReviews.every(item => item && typeof item === "object"
      && typeof item.at === "string" && Number.isFinite(Date.parse(item.at)) && https(item.sourceUrl)
      && names(item.publishedParticipants) && names(item.missing) && names(item.added)
      && (item.discrepancyReason === undefined || typeof item.discrepancyReason === "string")
      && (!(item.missing.length || item.added.length) || (typeof item.discrepancyReason === "string" && item.discrepancyReason.trim().length > 0)));
}

export function hasPendingAnnualRules(t: Tournament): boolean {
  return !!seasonCompetition(t) && (t.season ?? 0) > 2026
    && (t.competitionRules?.season !== t.season || t.competitionRules?.verification.standings !== "verified"
      || t.competitionRules?.verification.placements !== "verified");
}
