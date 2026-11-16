import type { OfficialResolution } from "../entities/official-resolution";
import type { MatchResult, Tournament } from "../entities/tournament";
import { isOfficialReference, sameParticipants } from "./official-resolution-core";
import { isValidKnockoutResult } from "./match-result-validation";
import { programmeConclusionIssue } from "./official-programme";
import { isValidLocalDate } from "./match-scheduling";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const score = (value: unknown): boolean => record(value)
  && [value.homeGoals, value.awayGoals].every(goal => typeof goal === "number" && Number.isInteger(goal) && goal >= 0 && goal <= 99);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text) && new Set(value).size === value.length;

export function isOfficialResolution(value: unknown): value is OfficialResolution {
  if (!record(value) || value.schemaVersion !== 1 || !text(value.id) || !text(value.key)
    || !["brasil-table", "argentina-seeding", "argentina-relegation"].includes(String(value.scope))
    || !strings(value.participantIds) || value.participantIds.length < 2 || !text(value.dependencySnapshot)
    || !["verified", "provisional", "pending"].includes(String(value.verification)) || !date(value.recordedAt)) return false;
  if (!Array.isArray(value.participantNames) || !value.participantNames.every(item => record(item) && text(item.teamId) && text(item.name))
    || !sameParticipants(value.participantIds, value.participantNames.map(item => (item as { teamId: string }).teamId))) return false;
  const country = value.scope === "brasil-table" ? "brasil" : "argentina";
  if (!isOfficialReference(value.source, country)) return false;
  if (value.invalidation !== undefined && (!record(value.invalidation) || !date(value.invalidation.at) || !text(value.invalidation.reason))) return false;
  if (value.supersededBy !== undefined && !text(value.supersededBy)) return false;
  if (value.scope !== "argentina-relegation") return value.programme === undefined
    && strings(value.orderedTeamIds) && sameParticipants(value.participantIds, value.orderedTeamIds);
  if (value.orderedTeamIds !== undefined || !record(value.programme)) return false;
  const programme = value.programme;
  if (!["round-robin", "afa-decision"].includes(String(programme.format)) || !text(programme.description)
    || !Number.isSafeInteger(programme.expectedMatches) || Number(programme.expectedMatches) < 1 || Number(programme.expectedMatches) > 1000
    || !Array.isArray(programme.matches) || programme.matches.length > Number(programme.expectedMatches)) return false;
  if (programme.format === "round-robin"
    && programme.expectedMatches !== value.participantIds.length * (value.participantIds.length - 1) / 2) return false;
  const matchIds = new Set<string>(), pairs = new Set<string>();
  for (const match of programme.matches) {
    if (!record(match) || !text(match.id) || matchIds.has(match.id) || !text(match.homeTeamId) || !text(match.awayTeamId)
      || match.homeTeamId === match.awayTeamId || !value.participantIds.includes(match.homeTeamId)
      || !value.participantIds.includes(match.awayTeamId) || typeof match.neutral !== "boolean"
      || (match.date !== undefined && (typeof match.date !== "string" || !isValidLocalDate(match.date)))
      || (match.venue !== undefined && !text(match.venue))
      || (match.knockoutResolution !== undefined && match.knockoutResolution !== "penalties" && match.knockoutResolution !== "extra-time-then-penalties")) return false;
    const pair = [match.homeTeamId, match.awayTeamId].sort().join("|");
    if (programme.format === "round-robin" && (pairs.has(pair) || !match.neutral || match.knockoutResolution !== undefined)) return false;
    matchIds.add(match.id); pairs.add(pair);
    if (match.result !== undefined) {
      if (!record(match.result) || !score(match.result)
        || (match.result.extraTime !== undefined && !score(match.result.extraTime))
        || (match.result.penalties !== undefined && !score(match.result.penalties))
        || !isValidKnockoutResult(match.result as unknown as MatchResult,
        match.knockoutResolution as "penalties" | "extra-time-then-penalties" | undefined)
        || !isOfficialReference(match.resultSource, "argentina")) return false;
    } else if (match.resultSource !== undefined) return false;
  }
  if (programme.conclusion !== undefined && (!record(programme.conclusion)
    || !strings(programme.conclusion.orderedTeamIds) || !sameParticipants(value.participantIds, programme.conclusion.orderedTeamIds)
    || !isOfficialReference(programme.conclusion.source, "argentina"))) return false;
  return true;
}
export function validateOfficialResolutions(tournament: Tournament): string[] {
  if (tournament.officialResolutions === undefined) return [];
  if (!Array.isArray(tournament.officialResolutions) || !tournament.officialResolutions.every(isOfficialResolution))
    return ["El registro de resoluciones oficiales contiene datos, fuentes o partidos inválidos."];
  const ids = new Set(tournament.officialResolutions.map(item => item.id));
  if (ids.size !== tournament.officialResolutions.length) return ["Hay identificadores de resolución oficial duplicados."];
  for (const item of tournament.officialResolutions) {
    if (item.programme && !item.invalidation && !item.supersededBy) {
      const issue = programmeConclusionIssue(tournament, { ...item, title: item.key }, item.programme);
      if (issue) return [issue];
    }
    if (!item.invalidation && !item.supersededBy && item.participantIds.some(id => !tournament.teams.some(team => team.id === id)))
      return ["Una resolución oficial referencia participantes inexistentes."];
    if (item.supersededBy && (!ids.has(item.supersededBy) || item.supersededBy === item.id))
      return ["Una revisión de resolución oficial tiene una referencia inválida."];
  }
  return [];
}
