import { DomainError } from "../../domain/domain-error.js";
import { isActivityEvent, type ActivityEvent } from "../../domain/entities/activity-event";
import type { Tournament } from "../../domain/entities/tournament";
import { getTournamentStorageIssue } from "../validation/tournament-storage";

/** merge = agregar lo que no existe; replace = reemplazar la biblioteca completa. */
export type LibraryRestoreMode = "merge" | "replace";

export interface LibraryRestoreResult {
  readonly added: number;
  readonly skipped: number;
}

/**
 * Valida un respaldo antes de restaurarlo: estructura (si el adaptador aporta su
 * propia comprobación), las mismas validaciones que un guardado, ids únicos e
 * historial válido. Lanza con el primer problema; no se restaura nada parcial.
 */
export function validateLibraryRestore(
  tournaments: readonly Tournament[],
  activity: readonly ActivityEvent[],
  isTournament: (value: unknown) => boolean = () => true,
): void {
  const incomingIds = new Set<string>();
  for (const tournament of tournaments) {
    if (!isTournament(tournament)) {
      throw new DomainError("No se importó el respaldo: la estructura de uno de los torneos no es válida.");
    }
    const issue = getTournamentStorageIssue(tournament);
    if (issue) throw new DomainError(`No se importó "${tournament.name || tournament.id}": ${issue}`);
    if (incomingIds.has(tournament.id)) {
      throw new DomainError(`No se importó el respaldo: el identificador "${tournament.id}" está duplicado.`);
    }
    incomingIds.add(tournament.id);
  }
  if (!activity.every(isActivityEvent)) {
    throw new DomainError("No se importó el respaldo: el historial contiene eventos inválidos.");
  }
}

export interface LibraryRestoreInput {
  readonly mode: LibraryRestoreMode;
  /** Torneos del respaldo, ya validados con validateLibraryRestore. */
  readonly incoming: readonly Tournament[];
  readonly incomingActivity?: readonly ActivityEvent[];
  /** Biblioteca vigente (válida). Se ignora al reemplazar. */
  readonly existing: readonly Tournament[];
  /** Historial vigente. Se ignora al reemplazar. */
  readonly existingActivity: readonly ActivityEvent[];
  readonly activeTournamentId: string | null;
  /**
   * Torneos entre los que puede quedar el torneo activo (p. ej. los del universo
   * deportivo vigente en la web). Por omisión, todos.
   */
  readonly selectable?: (
    tournaments: readonly Tournament[],
    activity: readonly ActivityEvent[],
    imported: readonly Tournament[],
  ) => readonly Tournament[];
  readonly createId?: () => string;
  readonly now?: () => Date;
}

export interface LibraryRestorePlan extends LibraryRestoreResult {
  /** Biblioteca resultante, en orden de almacenamiento (lo restaurado primero). */
  readonly tournaments: readonly Tournament[];
  /** Torneos del respaldo que se agregan o reemplazan. */
  readonly imported: readonly Tournament[];
  /** Historial resultante: el vigente (sólo al agregar), el del respaldo y el evento library-restored. */
  readonly activity: readonly ActivityEvent[];
  readonly event: ActivityEvent;
  readonly activeTournamentId: string | null;
}

/**
 * Calcula el resultado de restaurar un respaldo, sin escribir nada: lo usan el
 * adaptador de localStorage y el repositorio en memoria del servidor.
 * - merge: agrega los torneos cuyo id no existe (el resto se omite) y conserva
 *   el torneo activo si sigue siendo seleccionable.
 * - replace: la biblioteca y el historial pasan a ser los del respaldo; el
 *   torneo activo es el primero seleccionable.
 */
export function planLibraryRestore(input: LibraryRestoreInput): LibraryRestorePlan {
  const { mode, incoming } = input;
  const existing = mode === "merge" ? input.existing : [];
  const existingIds = new Set(existing.map(({ id }) => id));
  const imported = mode === "replace" ? [...incoming] : incoming.filter(({ id }) => !existingIds.has(id));
  const skipped = mode === "replace" ? 0 : incoming.length - imported.length;
  const tournaments = mode === "replace" ? imported : [...imported, ...existing];
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? (() => crypto.randomUUID());
  const event = {
    id: createId(),
    occurredAt: now().toISOString(),
    action: "library-restored" as const,
    tournamentId: imported[0]?.id ?? "library",
    ...(imported[0]?.competitionId ? { competitionId: imported[0].competitionId } : {}),
    tournamentName: imported[0]?.name ?? "Biblioteca",
    ...(imported[0]?.season !== undefined ? { season: imported[0].season } : {}),
    entityType: "tournament" as const,
    summary: `Se restauró un respaldo (${mode}) con ${imported.length} competiciones agregadas.`,
    after: { mode, added: imported.length, skipped },
  } satisfies ActivityEvent;
  const activity = mode === "merge" ? [...input.existingActivity] : [];
  for (const importedEvent of input.incomingActivity ?? []) {
    if (!activity.some(({ id }) => id === importedEvent.id)) activity.push({ ...importedEvent, imported: true });
  }
  if (!activity.some(({ id }) => id === event.id)) activity.push(event);
  const selectable = input.selectable?.(tournaments, activity, imported) ?? tournaments;
  const current = mode === "merge" ? input.activeTournamentId : null;
  const activeTournamentId = current && selectable.some(({ id }) => id === current)
    ? current
    : selectable[0]?.id ?? null;
  return { tournaments, imported, activity, event, activeTournamentId, added: imported.length, skipped };
}
