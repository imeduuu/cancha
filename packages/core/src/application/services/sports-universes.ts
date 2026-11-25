import { DomainError } from "../../domain/domain-error.js";
import {isAssociationRecord,isClubAffiliationRecord} from "../../domain/entities/club-affiliation";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { SportsUniverseLibrary } from "../../domain/entities/sports-universe";
import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { seasonOrigins } from "./competition-center";

export function emptySportsUniverseLibrary(): SportsUniverseLibrary {
  return { version: 1, activeUniverseId: null, universes: [], assignments: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSportsUniverseLibrary(
  value: unknown,
  tournamentIds?: ReadonlySet<string>,
): value is SportsUniverseLibrary {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.universes)
    || !isRecord(value.assignments)
    || (value.activeUniverseId !== null && typeof value.activeUniverseId !== "string")) {
    return false;
  }
  const universeIds = new Set<string>();
  const names = new Set<string>();
  for (const universe of value.universes) {
    if (!isRecord(universe) || typeof universe.id !== "string" || !universe.id.trim()
      || typeof universe.name !== "string" || !universe.name.trim() || universe.name.length > 80
      || (universe.description !== undefined
        && (typeof universe.description !== "string" || universe.description.length > 500))
      || universeIds.has(universe.id)
      || names.has(universe.name.trim().toLocaleLowerCase("es"))) {
      return false;
    }
    universeIds.add(universe.id);
    names.add(universe.name.trim().toLocaleLowerCase("es"));
  }
  if (value.activeUniverseId !== null && !universeIds.has(value.activeUniverseId)) return false;
  for (const [tournamentId, universeId] of Object.entries(value.assignments)) {
    if (!tournamentId.trim() || typeof universeId !== "string" || !universeIds.has(universeId)
      || (tournamentIds && !tournamentIds.has(tournamentId))) {
      return false;
    }
  }
  return true;
}

export function validateSportsUniverseLibrary(
  value: unknown,
  tournamentIds?: ReadonlySet<string>,
): SportsUniverseLibrary {
  if (!isSportsUniverseLibrary(value, tournamentIds)) {
    throw new DomainError("Los datos de universos deportivos no son válidos.");
  }
  return value;
}

export function tournamentsInUniverse(
  tournaments: readonly Tournament[],
  library: SportsUniverseLibrary,
  universeId = library.activeUniverseId,
): Tournament[] {
  return tournaments.filter(({ id }) => universeId === null
    ? library.assignments[id] === undefined
    : library.assignments[id] === universeId);
}

export function activityInUniverse(
  activity: readonly ActivityEvent[],
  tournamentIds: ReadonlySet<string>,
  universeId: string | null,
  allTournamentIds: ReadonlySet<string> = tournamentIds,
): ActivityEvent[] {
  return activity.filter((event) => event.action==="association-recorded" || event.action==="club-affiliation-recorded"
    ? (isAssociationRecord(event.after) || isClubAffiliationRecord(event.after)) && event.after.universeId===universeId
    : event.universeId !== undefined
    ? event.universeId === universeId
    : tournamentIds.has(event.tournamentId)
      || (universeId === null && !allTournamentIds.has(event.tournamentId))
      || (event.action === "season-created"
        && !!event.after
        && typeof event.after === "object"
        && "tournamentIds" in event.after
        && Array.isArray(event.after.tournamentIds)
        && event.after.tournamentIds.some((id) =>
          typeof id === "string" && tournamentIds.has(id))));
}

export function createScopedTournamentRepository(
  repository: TournamentRepository,
  universeId: string | null,
  getLibrary: () => SportsUniverseLibrary,
): TournamentRepository {
  function assertCurrentScope(): SportsUniverseLibrary {
    const library = getLibrary();
    if (library.activeUniverseId !== universeId) {
      throw new DomainError("El universo activo cambió. Revisa nuevamente antes de guardar.");
    }
    return library;
  }

  function assertWritableTournament(tournamentId: string): void {
    const library = assertCurrentScope();
    const existing = repository.findAll().find(({ id }) => id === tournamentId);
    if (existing && (library.assignments[tournamentId] ?? null) !== universeId) {
      throw new DomainError("El torneo ya no pertenece al universo activo. Revisa nuevamente antes de guardar.");
    }
  }

  function assertWritableEvent(event: ActivityEvent): void {
    const library = assertCurrentScope();
    assertWritableTournament(event.tournamentId);
    if (event.universeId !== undefined && event.universeId !== universeId) {
      throw new DomainError("El evento pertenece a otro universo. Revisa nuevamente antes de guardar.");
    }
    const exists = repository.findAll().some(({ id }) => id === event.tournamentId);
    const assignedUniverse = library.assignments[event.tournamentId] ?? null;
    if (exists && assignedUniverse !== universeId) {
      throw new DomainError("El evento ya no pertenece al universo activo. Revisa nuevamente antes de guardar.");
    }
  }

  return {
    findAll: () => tournamentsInUniverse(repository.findAll(), getLibrary(), universeId),
    save: (tournament) => {
      assertWritableTournament(tournament.id);
      repository.save(tournament);
    },
    ...(repository.saveWithActivity ? {
      saveWithActivity: (tournament: Tournament, event: ActivityEvent) => {
        assertWritableTournament(tournament.id);
        assertWritableEvent(event);
        repository.saveWithActivity!(tournament, event);
      },
    } : {}),
    ...(repository.saveManyWithActivity ? {
      saveManyWithActivity: (tournaments: readonly Tournament[], event: ActivityEvent) => {
        tournaments.forEach(({ id }) => assertWritableTournament(id));
        assertWritableEvent(event);
        repository.saveManyWithActivity!(tournaments, event);
      },
    } : {}),
    ...(repository.recordActivity ? {
      recordActivity: (event: ActivityEvent) => {
        assertWritableEvent(event);
        repository.recordActivity!(event);
      },
    } : {}),
    ...(repository.findActivity
      ? { findActivity: () => {
        const library = getLibrary();
        const allTournaments = repository.findAll();
        const tournaments = tournamentsInUniverse(allTournaments, library, universeId);
        const ids = new Set(tournaments.map(({ id }) => id));
        return activityInUniverse(
          repository.findActivity!(),
          ids,
          universeId,
          new Set(allTournaments.map(({ id }) => id)),
        );
      } }
      : {}),
  };
}

export function createSportsUniverse(
  library: SportsUniverseLibrary,
  name: string,
  description: string,
  createId: () => string = () => crypto.randomUUID(),
): SportsUniverseLibrary {
  const cleanName = name.trim();
  const cleanDescription = description.trim();
  if (!cleanName || cleanName.length > 80 || cleanDescription.length > 500) {
    throw new DomainError("Ingresa un nombre de hasta 80 caracteres y una descripción de hasta 500.");
  }
  if (library.universes.some(({ name: existing }) =>
    existing.trim().toLocaleLowerCase("es") === cleanName.toLocaleLowerCase("es"))) {
    throw new DomainError(`Ya existe un universo llamado "${cleanName}".`);
  }
  const id = createId();
  if (!id.trim() || library.universes.some((universe) => universe.id === id)) {
    throw new DomainError("No se pudo generar un identificador único para el universo.");
  }
  return {
    ...library,
    activeUniverseId: id,
    universes: [...library.universes, {
      id,
      name: cleanName,
      ...(cleanDescription ? { description: cleanDescription } : {}),
    }],
  };
}

export function renameSportsUniverse(
  library: SportsUniverseLibrary,
  universeId: string,
  name: string,
  description: string,
): SportsUniverseLibrary {
  const cleanName = name.trim();
  const cleanDescription = description.trim();
  if (!cleanName || cleanName.length > 80 || cleanDescription.length > 500) {
    throw new DomainError("Ingresa un nombre de hasta 80 caracteres y una descripción de hasta 500.");
  }
  if (!library.universes.some(({ id }) => id === universeId)) {
    throw new DomainError("No se encontró el universo que quieres editar.");
  }
  if (library.universes.some((universe) => universe.id !== universeId
    && universe.name.trim().toLocaleLowerCase("es") === cleanName.toLocaleLowerCase("es"))) {
    throw new DomainError(`Ya existe un universo llamado "${cleanName}".`);
  }
  return {
    ...library,
    universes: library.universes.map((universe) => {
      if (universe.id !== universeId) return universe;
      const { description: _description, ...metadata } = universe;
      return {
        ...metadata,
        name: cleanName,
        ...(cleanDescription ? { description: cleanDescription } : {}),
      };
    }),
  };
}

export function deleteSportsUniverse(
  library: SportsUniverseLibrary,
  universeId: string,
): SportsUniverseLibrary {
  if (!library.universes.some(({ id }) => id === universeId)) {
    throw new DomainError("No se encontró el universo que quieres eliminar.");
  }
  const assignments = Object.fromEntries(
    Object.entries(library.assignments).filter(([, assignedId]) => assignedId !== universeId),
  );
  return {
    ...library,
    activeUniverseId: library.activeUniverseId === universeId ? null : library.activeUniverseId,
    universes: library.universes.filter(({ id }) => id !== universeId),
    assignments,
  };
}

function referencedTournamentIds(
  tournament: Tournament,
  activity: readonly ActivityEvent[],
): string[] {
  return [
    ...seasonOrigins(tournament, activity),
    ...(tournament.competitionRules?.internationalQualification?.cupChampions ?? [])
      .map(({ sourceTournamentId }) => sourceTournamentId),
    ...(tournament.continentalPlans ?? []).flatMap((plan) => [
      ...plan.sourceTournamentIds,
      ...plan.dependencies.map(({ tournamentId }) => tournamentId),
      ...plan.entries.map(({ originTournamentId }) => originTournamentId),
    ]),
    ...(tournament.nationalCupPlanning?.regulations ?? []).flatMap((regulation) =>
      regulation.criteria.flatMap(({ sourceTournamentId }) =>
        sourceTournamentId ? [sourceTournamentId] : [])),
    ...(tournament.nationalCupPlanning?.reviews ?? []).flatMap((review) =>
      review.dependencies.map(({ tournamentId }) => tournamentId)),
  ];
}

export function validateSportsUniverseRelations(
  library: unknown,
  tournaments: readonly Tournament[],
  activity: readonly ActivityEvent[],
): SportsUniverseLibrary {
  const validated = validateSportsUniverseLibrary(
    library,
    new Set(tournaments.map(({ id }) => id)),
  );
  const tournamentById = new Map(tournaments.map((tournament) => [tournament.id, tournament]));
  for (const tournament of tournaments) {
    const targetUniverse = validated.assignments[tournament.id] ?? null;
    for (const referencedId of referencedTournamentIds(tournament, activity)) {
      const referenced = tournamentById.get(referencedId);
      if (!referenced) continue;
      const referencedUniverse = validated.assignments[referencedId] ?? null;
      if (targetUniverse !== referencedUniverse) {
        throw new DomainError(
          `No se reorganizaron los torneos: "${tournament.name}" mantiene una relación con "${referenced.name}". Incorpora o retira juntas las temporadas relacionadas.`,
        );
      }
    }
  }
  return validated;
}

export function setTournamentUniverseAssignments(
  library: SportsUniverseLibrary,
  tournamentIds: readonly string[],
  universeId: string | null,
  tournaments: readonly Tournament[],
  activity: readonly ActivityEvent[],
): SportsUniverseLibrary {
  const ids = [...new Set(tournamentIds)];
  if (ids.length !== tournamentIds.length || ids.length === 0) {
    throw new DomainError("Selecciona al menos un torneo sin repetirlo.");
  }
  if (universeId !== null && !library.universes.some(({ id }) => id === universeId)) {
    throw new DomainError("No se encontró el universo seleccionado.");
  }
  const tournamentById = new Map(tournaments.map((tournament) => [tournament.id, tournament]));
  if (ids.some((id) => !tournamentById.has(id))) {
    throw new DomainError("No se reorganizaron los torneos porque alguno ya no está en la biblioteca.");
  }

  const assignments = { ...library.assignments };
  for (const id of ids) {
    if (universeId === null) delete assignments[id];
    else assignments[id] = universeId;
  }
  const next = { ...library, assignments };
  return validateSportsUniverseRelations(next, tournaments, activity);
}

export function mergeSportsUniverseLibraries(
  current: SportsUniverseLibrary,
  incoming: SportsUniverseLibrary | undefined,
  importedTournamentIds: ReadonlySet<string>,
  resultingTournamentIds: ReadonlySet<string>,
): SportsUniverseLibrary {
  if (!incoming) return current;
  const universes = [...current.universes];
  const byId = new Map(universes.map((universe) => [universe.id, universe]));
  for (const universe of incoming.universes) {
    const existing = byId.get(universe.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(universe)) {
      throw new DomainError(`El universo "${universe.name}" ya existe con otros metadatos.`);
    }
    if (!existing) {
      if (universes.some(({ name }) => name.trim().toLocaleLowerCase("es")
        === universe.name.trim().toLocaleLowerCase("es"))) {
        throw new DomainError(`Ya existe un universo llamado "${universe.name}".`);
      }
      universes.push(universe);
      byId.set(universe.id, universe);
    }
  }
  const assignments = { ...current.assignments };
  for (const [tournamentId, targetId] of Object.entries(incoming.assignments)) {
    if (importedTournamentIds.has(tournamentId) && resultingTournamentIds.has(tournamentId)) {
      assignments[tournamentId] = targetId;
    }
  }
  const next = validateSportsUniverseLibrary({
    version: 1,
    activeUniverseId: current.activeUniverseId,
    universes,
    assignments,
  }, resultingTournamentIds);
  return next;
}

/**
 * Regla única (localStorage, réplica en memoria y servidor) para reatribuir el
 * historial cuando cambian los universos: los eventos de un torneo que cambió de
 * universo pasan al nuevo (o quedan sin universo), y los de un universo eliminado
 * pierden su `universeId`. Sólo cambia `universeId`; el resto de cada evento queda
 * igual. Las asociaciones y afiliaciones conservan el universo que declararon y,
 * por eso, impiden eliminar ese universo.
 *
 * Devuelve los mismos objetos cuando no hay nada que reatribuir.
 */
export function reattributeActivityToUniverses(
  previous: SportsUniverseLibrary,
  next: SportsUniverseLibrary,
  events: readonly ActivityEvent[],
): ActivityEvent[] {
  const changedTournamentIds = new Set([
    ...Object.keys(previous.assignments),
    ...Object.keys(next.assignments),
  ].filter((id) => (previous.assignments[id] ?? null) !== (next.assignments[id] ?? null)));
  const remainingUniverseIds = new Set(next.universes.map(({ id }) => id));
  const removedUniverseIds = new Set(previous.universes
    .map(({ id }) => id)
    .filter((id) => !remainingUniverseIds.has(id)));
  if (changedTournamentIds.size === 0 && removedUniverseIds.size === 0) return [...events];
  if (events.some((event) => (event.action === "association-recorded" || event.action === "club-affiliation-recorded")
    && isRecord(event.after) && typeof event.after.universeId === "string" && removedUniverseIds.has(event.after.universeId))) {
    throw new DomainError("No se eliminó el universo: conserva asociaciones o afiliaciones históricas. No se trasladan automáticamente a otra partida.");
  }
  return events.map((event) => {
    // Metadata retains its declared universe even when a tournament is moved.
    if (event.action === "association-recorded" || event.action === "club-affiliation-recorded") return event;
    const after = event.after;
    const referencedIds = [event.tournamentId];
    if (event.action === "season-created" && isRecord(after) && Array.isArray(after.tournamentIds)) {
      referencedIds.push(...after.tournamentIds.filter((id): id is string => typeof id === "string"));
    }
    const affectedId = referencedIds.find((id) => changedTournamentIds.has(id));
    const removesOldUniverse = !!event.universeId && removedUniverseIds.has(event.universeId);
    if (!affectedId && !removesOldUniverse) return event;
    const newUniverseId = affectedId ? next.assignments[affectedId] : undefined;
    const { universeId: _oldUniverseId, ...unassignedEvent } = event;
    void _oldUniverseId;
    return newUniverseId ? { ...unassignedEvent, universeId: newUniverseId } : unassignedEvent;
  });
}

/** `universeId` de cada evento que `reattributeActivityToUniverses` cambió (null = quedó sin universo). */
export function activityUniverseChanges(
  before: readonly ActivityEvent[],
  after: readonly ActivityEvent[],
): Record<string, string | null> {
  const changes: Record<string, string | null> = {};
  after.forEach((event, index) => {
    const original = before[index];
    if (original && original.id === event.id && original.universeId !== event.universeId) {
      changes[event.id] = event.universeId ?? null;
    }
  });
  return changes;
}

/**
 * Universos resultantes de restaurar un respaldo, igual en todos los adaptadores:
 * reemplazar toma los del respaldo (o ninguno); agregar los fusiona con los
 * actuales y sólo asigna los torneos importados. Valida sus relaciones.
 */
export function restoredSportsUniverses(input: {
  readonly mode: "merge" | "replace";
  readonly current: SportsUniverseLibrary;
  readonly restored?: SportsUniverseLibrary;
  readonly importedTournamentIds: ReadonlySet<string>;
  readonly tournaments: readonly Tournament[];
  readonly activity: readonly ActivityEvent[];
}): SportsUniverseLibrary {
  const resultingTournamentIds = new Set(input.tournaments.map(({ id }) => id));
  const candidate = input.mode === "replace"
    ? validateSportsUniverseLibrary(input.restored ?? emptySportsUniverseLibrary(), resultingTournamentIds)
    : mergeSportsUniverseLibraries(input.current, input.restored, input.importedTournamentIds, resultingTournamentIds);
  return validateSportsUniverseRelations(candidate, input.tournaments, input.activity);
}
