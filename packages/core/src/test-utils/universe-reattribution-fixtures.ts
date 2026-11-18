import type { ActivityEvent } from "../domain/entities/activity-event";
import type { SportsUniverseLibrary } from "../domain/entities/sports-universe";
import type { Tournament } from "../domain/entities/tournament";
import { createActivityEvent } from "../application/services/activity-log";
import { closureLeague } from "./season-closure-fixtures";

/**
 * Escenario único de reatribución de universos. La prueba de equivalencia lo
 * aplica en localStorage (web) y en el servidor (API) y exige en ambos los mismos
 * `universeId`: `expectedUniverseIds`. Ninguna de las dos lo calcula con la otra.
 *
 * Antes: a y b en "uno", c en "dos", d sin universo.
 * Después: a pasa a "dos", b queda sin universo, se elimina "uno" y se crea "tres".
 */
export interface UniverseReattributionScenario {
  readonly tournaments: Tournament[];
  readonly activity: ActivityEvent[];
  readonly before: SportsUniverseLibrary;
  readonly after: SportsUniverseLibrary;
  /** universeId esperado de cada evento después del cambio (null = sin universo). */
  readonly expectedUniverseIds: Readonly<Record<string, string | null>>;
}

const occurredAt = () => new Date("2026-02-01T12:00:00.000Z");

function eventFor(tournament: Tournament, id: string, universeId?: string): ActivityEvent {
  return {
    ...createActivityEvent(tournament, {
      action: "regulations-updated",
      entityType: "tournament",
      summary: `Se actualizó el reglamento de ${tournament.name}.`,
      after: { nota: "sin cambios de universo" },
    }, occurredAt),
    id,
    ...(universeId ? { universeId } : {}),
  };
}

export function universeReattributionScenario(): UniverseReattributionScenario {
  const [a, b, c, d] = ["a", "b", "c", "d"].map(suffix => ({
    ...closureLeague(`universo-${suffix}`),
    name: `Liga ${suffix.toUpperCase()}`,
  }));
  const uno = { id: "universo-uno", name: "Partida uno" };
  const dos = { id: "universo-dos", name: "Partida dos" };
  const tres = { id: "universo-tres", name: "Partida tres", description: "Creada en el cambio." };
  return {
    tournaments: [a, b, c, d],
    activity: [
      eventFor(a, "evento-a", uno.id),
      eventFor(b, "evento-b", uno.id),
      eventFor(c, "evento-c", dos.id),
      eventFor(d, "evento-d"),
      eventFor(d, "evento-d-viejo-uno", uno.id),
    ],
    before: {
      version: 1,
      activeUniverseId: null,
      universes: [uno, dos],
      assignments: { [a.id]: uno.id, [b.id]: uno.id, [c.id]: dos.id },
    },
    after: {
      version: 1,
      activeUniverseId: null,
      universes: [dos, tres],
      assignments: { [a.id]: dos.id, [c.id]: dos.id },
    },
    expectedUniverseIds: {
      "evento-a": dos.id,
      "evento-b": null,
      "evento-c": dos.id,
      "evento-d": null,
      "evento-d-viejo-uno": null,
    },
  };
}

/** universeId de cada evento del escenario en un historial (null = sin universo). */
export function scenarioUniverseIds(
  scenario: UniverseReattributionScenario,
  activity: readonly ActivityEvent[],
): Record<string, string | null> {
  const ids = new Set(Object.keys(scenario.expectedUniverseIds));
  return Object.fromEntries(activity.filter(({ id }) => ids.has(id)).map(event => [event.id, event.universeId ?? null]));
}
