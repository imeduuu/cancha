import type { ActivityAction, ActivityEvent } from "../../domain/entities/activity-event";
import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";

export interface ActivityEventInput {
  readonly action: ActivityAction;
  readonly summary: string;
  readonly entityId?: string;
  readonly entityType?: ActivityEvent["entityType"];
  readonly before?: unknown;
  readonly after?: unknown;
  readonly note?: string;
}

export function createActivityEvent(
  tournament: Pick<Tournament, "id" | "competitionId" | "name" | "season">,
  input: ActivityEventInput,
  now: () => Date = () => new Date(),
): ActivityEvent {
  const occurredAt = now().toISOString();
  if (!Number.isFinite(Date.parse(occurredAt))) {
    throw new Error("No se pudo registrar la actividad: la fecha no es válida.");
  }
  return {
    id: crypto.randomUUID(),
    occurredAt,
    action: input.action,
    tournamentId: tournament.id,
    ...(tournament.competitionId ? { competitionId: tournament.competitionId } : {}),
    tournamentName: tournament.name,
    ...(tournament.season !== undefined ? { season: tournament.season } : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(input.entityType ? { entityType: input.entityType } : {}),
    summary: input.summary,
    ...(input.before !== undefined ? { before: input.before } : {}),
    ...(input.after !== undefined ? { after: input.after } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };
}

export function saveWithActivity(
  repository: TournamentRepository,
  tournament: Tournament,
  event: ActivityEvent,
): void {
  if (!repository.saveWithActivity) {
    throw new Error(
      "No se guardaron los cambios: el repositorio no garantiza la escritura coordinada con el historial.",
    );
  }
  const previousResolutions = tournament.officialResolutions?.some(item => item.invalidation)
    ? repository.findAll().find(t => t.id === tournament.id)?.officialResolutions : undefined;
  const invalidated = tournament.officialResolutions?.filter(item => item.invalidation
    && !previousResolutions?.find(old => old.id === item.id)?.invalidation);
  const enriched = invalidated?.length ? { ...event,
    note: [event.note, `Se invalidaron las resoluciones dependientes: ${invalidated.map(item => item.id).join(", ")}.`].filter(Boolean).join(" "),
    after: { change: event.after, invalidatedOfficialResolutions: invalidated },
  } : event;
  repository.saveWithActivity(tournament, enriched);
}

export function recordActivity(
  repository: TournamentRepository,
  event: ActivityEvent,
): void {
  if (!repository.recordActivity) {
    throw new Error("No se pudo registrar la actividad: el repositorio no admite historial.");
  }
  repository.recordActivity(event);
}

/**
 * Evento que documenta una operación rechazada (p. ej. una importación inválida).
 * Se conserva aunque la operación que lo produjo no escriba nada más.
 */
export function isRejectionEvent(event: ActivityEvent): boolean {
  return event.outcome === "rejected";
}

export function recordRejectedImport(
  repository: TournamentRepository,
  reason: string,
  tournament?: Pick<Tournament, "id" | "competitionId" | "name" | "season">,
): void {
  const snapshot = tournament ?? { id: "library", name: "Biblioteca" };
  const event: ActivityEvent = {
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    action: "tournament-import-rejected",
    tournamentId: snapshot.id,
    ...(snapshot.competitionId ? { competitionId: snapshot.competitionId } : {}),
    tournamentName: snapshot.name,
    ...(snapshot.season !== undefined ? { season: snapshot.season } : {}),
    entityType: "tournament",
    outcome: "rejected",
    summary: `Se rechazó una importación: ${reason.trim().slice(0, 300)}`,
  };
  recordActivity(repository, event);
}
