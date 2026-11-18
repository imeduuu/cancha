import { isActivityEvent, type ActivityAction, type ActivityEvent } from "../../domain/entities/activity-event";
import type { Tournament } from "../../domain/entities/tournament";
import type { LibraryChanges } from "../services/in-memory-library";
import { getTournamentStorageIssue } from "./tournament-storage";

/**
 * Acciones cuyo `tournamentId` no identifica un torneo de la biblioteca, y por eso
 * quedan exentas de exigir que exista: un rechazo de importación usa "library" o
 * el id del torneo rechazado (que nunca se guardó), y una incidencia de fuente usa
 * el `competitionId` de la fuente oficial. Lista cerrada: agregar una acción aquí
 * es una decisión explícita, no un arreglo para que pase un envío.
 */
export const libraryLevelActivityActions = [
  "tournament-import-rejected",
  "source-incident-reviewed",
] as const satisfies readonly ActivityAction[];

export function isLibraryLevelActivityAction(action: string): boolean {
  return (libraryLevelActivityActions as readonly string[]).includes(action);
}

/** Lo que ya existe en la biblioteca del usuario contra la que se valida el envío. */
export interface LoadedLibraryIds {
  readonly tournamentIds: ReadonlySet<string>;
  readonly activityIds: ReadonlySet<string>;
}

const allowedKeys = new Set(["saved", "deleted", "events", "activeTournament"]);

function fail(reason: string): never {
  throw new Error(`No se guardaron los cambios: ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function storageIssue(tournament: Tournament): string | undefined {
  try {
    return getTournamentStorageIssue(tournament);
  } catch {
    return "El formato de los datos no es válido.";
  }
}

/** ¿Contiene `value`, a cualquier profundidad, algo con la forma de un torneo completo? */
export function carriesTournamentSnapshot(value: unknown, depth = 0): boolean {
  if (depth > 32 || typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return value.some(item => carriesTournamentSnapshot(item, depth + 1));
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string" && Array.isArray(record.teams) && Array.isArray(record.matchdays)) return true;
  return Object.values(record).some(item => carriesTournamentSnapshot(item, depth + 1));
}

/**
 * Valida un conjunto de cambios que llega de un cliente (fase 5, C3) contra la
 * biblioteca cargada del usuario, y lo devuelve normalizado: sin los eventos cuyo
 * id ya está registrado (la actividad sólo se agrega; un id conocido se ignora y
 * nunca reemplaza al guardado). Lanza `Error` con el motivo, sin escrituras.
 *
 * No admite `replaceLibrary` ni `replaceActivity`: reemplazar la biblioteca sólo
 * se hace restaurando un respaldo.
 */
export function validateLibraryChanges(changes: unknown, loaded: LoadedLibraryIds): LibraryChanges {
  if (!isRecord(changes)) fail("el envío no tiene el formato esperado.");
  if ("replaceLibrary" in changes || "replaceActivity" in changes) {
    fail("reemplazar la biblioteca o el historial sólo se puede restaurando un respaldo.");
  }
  const unknownKey = Object.keys(changes).find(key => !allowedKeys.has(key));
  if (unknownKey !== undefined) fail(`el campo "${unknownKey}" no es válido.`);
  const { saved, deleted, events, activeTournament } = changes;
  if (!Array.isArray(saved) || !Array.isArray(deleted) || !Array.isArray(events)) {
    fail("saved, deleted y events deben ser listas.");
  }

  const savedIds = new Set<string>();
  for (const tournament of saved as unknown[]) {
    if (!isRecord(tournament) || typeof tournament.id !== "string" || tournament.id.length === 0) {
      fail("un torneo no tiene identificador.");
    }
    if (savedIds.has(tournament.id)) fail("la selección contiene torneos duplicados.");
    savedIds.add(tournament.id);
    const issue = storageIssue(tournament as unknown as Tournament);
    if (issue) {
      const name = typeof tournament.name === "string" && tournament.name ? tournament.name : tournament.id;
      fail(`"${name}": ${issue}`);
    }
  }

  const deletedIds = new Set<string>();
  for (const id of deleted as unknown[]) {
    if (typeof id !== "string" || id.length === 0) fail("un torneo eliminado no tiene identificador.");
    if (deletedIds.has(id)) fail("un torneo se eliminó dos veces.");
    if (!loaded.tournamentIds.has(id)) fail(`no se encontró el campeonato "${id}" que se quiere eliminar.`);
    if (savedIds.has(id)) fail(`el campeonato "${id}" no puede guardarse y eliminarse a la vez.`);
    deletedIds.add(id);
  }

  const eventIds = new Set<string>();
  const newEvents: ActivityEvent[] = [];
  for (const event of events as unknown[]) {
    if (!isActivityEvent(event)) fail("un evento de actividad no es válido.");
    if (eventIds.has(event.id)) fail("el historial contiene eventos repetidos.");
    eventIds.add(event.id);
    if (loaded.activityIds.has(event.id)) continue;
    if (isLibraryLevelActivityAction(event.action)) {
      if (carriesTournamentSnapshot(event.before) || carriesTournamentSnapshot(event.after)) {
        fail(`un evento "${event.action}" no puede incluir un torneo completo.`);
      }
    } else if (!loaded.tournamentIds.has(event.tournamentId) && !savedIds.has(event.tournamentId)) {
      fail(`un evento "${event.action}" se refiere a un campeonato que no existe ("${event.tournamentId}").`);
    }
    newEvents.push(event);
  }

  let active: LibraryChanges["activeTournament"];
  if (activeTournament !== undefined) {
    if (!isRecord(activeTournament) || !(activeTournament.id === null || typeof activeTournament.id === "string")) {
      fail("el torneo activo no tiene el formato esperado.");
    }
    const id = activeTournament.id as string | null;
    const exists = id !== null && (savedIds.has(id) || (loaded.tournamentIds.has(id) && !deletedIds.has(id)));
    if (id !== null && !exists) fail(`el torneo activo "${id}" no existe.`);
    active = { id };
  }

  return {
    saved: saved as Tournament[],
    deleted: [...deletedIds],
    events: newEvents,
    ...(active ? { activeTournament: active } : {}),
  };
}
