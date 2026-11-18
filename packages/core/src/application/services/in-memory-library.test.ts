import { describe, expect, it } from "vitest";
import type { Tournament } from "../../domain/entities/tournament";
import { closureLeague } from "../../test-utils/season-closure-fixtures";
import { scenarioUniverseIds, universeReattributionScenario } from "../../test-utils/universe-reattribution-fixtures";
import { createActivityEvent } from "./activity-log";
import { InMemoryTournamentRepository, type InMemoryLibraryState } from "./in-memory-library";
import { emptySportsUniverseLibrary } from "./sports-universes";

function scenarioState(): { state: InMemoryLibraryState; scenario: ReturnType<typeof universeReattributionScenario> } {
  const scenario = universeReattributionScenario();
  return {
    scenario,
    state: {
      tournaments: [...scenario.tournaments],
      activity: [...scenario.activity],
      activeTournamentId: null,
      universes: scenario.before,
    },
  };
}

describe("InMemoryTournamentRepository: universos deportivos", () => {
  it("sin universos en el estado equivale a ninguno y changes() no los informa", () => {
    const repository = new InMemoryTournamentRepository({ tournaments: [], activity: [], activeTournamentId: null });
    expect(repository.getSportsUniverseLibrary()).toEqual(emptySportsUniverseLibrary());
    expect(repository.changes().universes).toBeUndefined();
  });

  it("setSportsUniverseLibrary reatribuye con la regla de core e informa sólo los universeId de eventos existentes", () => {
    const { state, scenario } = scenarioState();
    const repository = new InMemoryTournamentRepository(state);
    repository.setSportsUniverseLibrary(scenario.after);

    expect(scenarioUniverseIds(scenario, repository.findActivity())).toEqual(scenario.expectedUniverseIds);
    const changes = repository.changes();
    expect(changes.universes).toEqual(scenario.after);
    expect(changes.events).toEqual([]);
    expect(changes.activityUniverseIds).toEqual({ "evento-a": "universo-dos", "evento-b": null, "evento-d-viejo-uno": null });
  });

  it("un evento creado en la misma instancia se envía ya reatribuido, no en activityUniverseIds", () => {
    const { state, scenario } = scenarioState();
    const repository = new InMemoryTournamentRepository(state);
    const [a] = scenario.tournaments;
    const fresh = { ...createActivityEvent(a, { action: "regulations-updated", entityType: "tournament", summary: "Nuevo." }), universeId: "universo-uno" };
    repository.recordActivity(fresh);
    repository.setSportsUniverseLibrary(scenario.after);

    const changes = repository.changes();
    expect(changes.events).toEqual([{ ...fresh, universeId: "universo-dos" }]);
    expect(changes.activityUniverseIds).not.toHaveProperty(fresh.id);
  });

  it("deleteById retira la asignación y deja el universo en el evento, como localStorage", () => {
    const { state, scenario } = scenarioState();
    const repository = new InMemoryTournamentRepository(state);
    const [a] = scenario.tournaments;
    repository.deleteById(a.id);

    expect(repository.getSportsUniverseLibrary().assignments).not.toHaveProperty(a.id);
    const changes = repository.changes();
    expect(changes.events.at(-1)).toMatchObject({ action: "tournament-deleted", tournamentId: a.id, universeId: "universo-uno" });
    expect(changes.universes?.assignments).not.toHaveProperty(a.id);
  });

  it("restaurar en modo reemplazar toma los universos del respaldo; en modo agregar los fusiona", () => {
    const { scenario } = scenarioState();
    const replaced = new InMemoryTournamentRepository();
    replaced.importTournaments(scenario.tournaments, "replace", scenario.activity, false, scenario.before);
    expect(replaced.changes()).toMatchObject({ replaceLibrary: true, universes: scenario.before });

    const extra: Tournament = { ...closureLeague("universo-extra"), name: "Liga extra" };
    const merged = new InMemoryTournamentRepository({
      tournaments: [extra], activity: [], activeTournamentId: null, universes: emptySportsUniverseLibrary(),
    });
    merged.importTournaments(scenario.tournaments, "merge", scenario.activity, false, scenario.before);
    expect(merged.getSportsUniverseLibrary().assignments).toEqual(scenario.before.assignments);
    expect(merged.changes().universes?.universes.map(({ id }) => id)).toEqual(["universo-uno", "universo-dos"]);
  });
});
