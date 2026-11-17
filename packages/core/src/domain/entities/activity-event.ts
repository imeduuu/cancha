import {isAssociationRecord,isClubAffiliationRecord} from "./club-affiliation";
import {isDrawConfiguration} from "./draw-configuration";
import { isSourceIncident } from "./source-incident";
import { isSeasonClosureRecord } from "./season-closure";
import { isStageDrawRecord } from "./stage-draw";
export type ActivityAction =
  | "association-recorded"
  | "club-affiliation-recorded"
  | "draw-configuration-recorded"
  | "stage-draw-confirmed"
  | "season-closure-confirmed"
  | "source-incident-reviewed"
  | "match-result-updated"
  | "match-schedule-updated"
  | "match-operational-state-updated"
  | "match-details-updated"
  | "match-goal-scorers-updated"
  | "regulations-updated"
  | "roster-updated"
  | "tournament-created"
  | "tournament-renamed"
  | "matches-simulated"
  | "tournament-duplicated"
  | "season-created"
  | "calendar-programmed"
  | "tournament-archived"
  | "tournament-restored"
  | "tournament-imported"
  | "tournament-import-rejected"
  | "tournament-deleted"
  | "library-restored"
  | "official-resolution-recorded"
  | "official-resolution-revoked"
  | "official-resolution-invalidated";
export interface ActivityEvent {
  readonly id: string;
  readonly occurredAt: string;
  readonly action: ActivityAction;
  readonly tournamentId: string;
  readonly universeId?: string;
  readonly competitionId?: string;
  readonly tournamentName: string;
  readonly season?: number;
  readonly entityId?: string;
  readonly entityType?: "match" | "tournament" | "season";
  readonly summary: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly note?: string;
  readonly imported?: boolean;
  readonly outcome?: "completed" | "rejected";
}
const activityActions: readonly ActivityAction[] = [
  "association-recorded",
  "club-affiliation-recorded",
  "draw-configuration-recorded",
  "stage-draw-confirmed",
  "season-closure-confirmed",
  "source-incident-reviewed",
  "match-result-updated",
  "match-schedule-updated",
  "match-operational-state-updated",
  "match-details-updated",
  "match-goal-scorers-updated",
  "regulations-updated",
  "roster-updated",
  "tournament-created",
  "tournament-renamed",
  "matches-simulated",
  "tournament-duplicated",
  "season-created",
  "calendar-programmed",
  "tournament-archived",
  "tournament-restored",
  "tournament-imported",
  "tournament-import-rejected",
  "tournament-deleted",
  "library-restored",
  "official-resolution-recorded",
  "official-resolution-revoked",
  "official-resolution-invalidated",
];
export function isActivityEvent(value: unknown): value is ActivityEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (event.action!=="association-recorded" || (isAssociationRecord(event.after) && event.after.tournamentId===event.tournamentId && event.entityId===event.after.association.id && (event.universeId===undefined || event.universeId===event.after.universeId)))
    && (event.action!=="club-affiliation-recorded" || (isClubAffiliationRecord(event.after) && event.after.tournamentId===event.tournamentId && event.after.competitionId===event.competitionId && event.after.season===event.season && event.entityId===event.after.occurrenceKey && (event.universeId===undefined || event.universeId===event.after.universeId)))
    && (event.action !== "draw-configuration-recorded" || (isDrawConfiguration(event.after) && event.after.tournamentId===event.tournamentId && event.after.competitionId===event.competitionId && event.after.season===event.season && event.after.stage===event.entityId))
    && (event.action !== "stage-draw-confirmed" || isStageDrawRecord(event.after))
    && (event.action !== "season-closure-confirmed" || isSeasonClosureRecord(event.after))
    && (event.action !== "source-incident-reviewed" || (isSourceIncident(event.after)
    && event.tournamentId === event.after.competitionId && event.season === event.after.season
    && event.entityId === event.after.id))
    && typeof event.id === "string" && event.id.length > 0
    && typeof event.occurredAt === "string" && Number.isFinite(Date.parse(event.occurredAt))
    && typeof event.action === "string" && activityActions.includes(event.action as ActivityAction)
    && typeof event.tournamentId === "string" && event.tournamentId.length > 0
    && (event.universeId === undefined
      || typeof event.universeId === "string" && event.universeId.length > 0)
    && (event.competitionId === undefined || typeof event.competitionId === "string")
    && typeof event.tournamentName === "string" && event.tournamentName.length > 0
    && typeof event.summary === "string" && event.summary.length > 0
    && (event.season === undefined || Number.isSafeInteger(event.season))
    && (event.entityId === undefined || typeof event.entityId === "string")
    && (event.entityType === undefined
      || event.entityType === "match"
      || event.entityType === "tournament"
      || event.entityType === "season")
    && (event.note === undefined || typeof event.note === "string")
    && (event.imported === undefined || typeof event.imported === "boolean")
    && (event.outcome === undefined
      || event.outcome === "completed"
      || event.outcome === "rejected");
}
