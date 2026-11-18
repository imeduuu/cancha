import type { ActivityEvent } from "../domain/entities/activity-event";
import type { SourceIncident } from "../domain/entities/source-incident";

/**
 * Eventos de las acciones exentas de `libraryLevelActivityActions`, con la misma
 * forma que producen `recordRejectedImport` y las incidencias de fuente. Los usan
 * las pruebas de `validateLibraryChanges` en core y los e2e de la API.
 */
export function importRejectionEvent(tournamentId: string, extra: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    action: "tournament-import-rejected",
    tournamentId,
    tournamentName: tournamentId === "library" ? "Biblioteca" : "Torneo rechazado",
    entityType: "tournament",
    outcome: "rejected",
    summary: "Se rechazó una importación: el archivo está dañado.",
    ...extra,
  };
}

export function sourceIncident(competitionId: string, extra: Record<string, unknown> = {}): SourceIncident {
  return {
    schemaVersion: 1,
    id: `incidencia-${competitionId}`,
    revision: 1,
    competitionId,
    competitionName: "Primera División",
    season: 2026,
    provider: "ANFP",
    sourceUrl: "https://www.campeonatochileno.cl/fixture",
    type: "invalid-source-data",
    reason: "La fuente publicó datos incompletos.",
    detectedAt: "2026-03-01T12:00:00.000Z",
    status: "pending",
    origin: "automatic",
    matches: [],
    corrections: [],
    ...extra,
  } as SourceIncident;
}

export function sourceIncidentEvent(
  competitionId: string,
  extra: Partial<ActivityEvent> = {},
  incidentExtra: Record<string, unknown> = {},
): ActivityEvent {
  const incident = sourceIncident(competitionId, incidentExtra);
  return {
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    action: "source-incident-reviewed",
    tournamentId: competitionId,
    tournamentName: incident.competitionName,
    season: incident.season,
    entityId: incident.id,
    entityType: "tournament",
    summary: `Incidencia de ${incident.provider}: ${incident.status}. ${incident.reason}`,
    after: incident,
    ...extra,
  };
}
