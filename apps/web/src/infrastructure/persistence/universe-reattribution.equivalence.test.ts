import { beforeEach, describe, expect, it } from "vitest";
import { scenarioUniverseIds, universeReattributionScenario } from "@cancha/core/test-utils/universe-reattribution-fixtures";
import { LocalStorageTournamentRepository } from "./local-storage-tournament-repository";

// Mitad web de la prueba de equivalencia (fase 5C): el mismo escenario se aplica en
// el servidor en apps/api/src/graphql/library-universes.e2e.test.ts, y ambos deben
// dejar exactamente `expectedUniverseIds`.
let storedValues = new Map<string, string>();

beforeEach(() => {
  storedValues = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storedValues.get(key) ?? null,
      setItem: (key: string, value: string) => { storedValues.set(key, String(value)); },
      removeItem: (key: string) => { storedValues.delete(key); },
    },
  });
});

describe("reatribución de universos: equivalencia localStorage ↔ servidor", () => {
  it("el cambio de universos de referencia deja los universeId esperados", () => {
    const scenario = universeReattributionScenario();
    const repository = new LocalStorageTournamentRepository(false);
    // Igual que el servidor: la biblioteca de partida llega restaurando un respaldo.
    repository.importTournaments(scenario.tournaments, "replace", scenario.activity, true, scenario.before);
    const before = repository.findActivity();
    expect(repository.getSportsUniverseLibrary()).toEqual(scenario.before);

    repository.setSportsUniverseLibrary(scenario.after);

    const after = repository.findActivity();
    expect(scenarioUniverseIds(scenario, after)).toEqual(scenario.expectedUniverseIds);
    // Sólo cambia universeId.
    expect(after.map(({ universeId: _u, ...rest }) => { void _u; return rest; }))
      .toEqual(before.map(({ universeId: _u, ...rest }) => { void _u; return rest; }));
  });
});
