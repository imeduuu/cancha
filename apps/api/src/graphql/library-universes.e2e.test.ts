import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import type { SportsUniverseLibrary } from "@cancha/core/domain/entities/sports-universe";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { createTournamentBackup } from "@cancha/core/application/services/tournament-archive";
import { emptySportsUniverseLibrary } from "@cancha/core/application/services/sports-universes";
import { scenarioUniverseIds, universeReattributionScenario } from "@cancha/core/test-utils/universe-reattribution-fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replicaSetStartupTimeoutMs } from "../test-utils/mongo-replica-set.js";
import { startGraphqlApp, type GraphqlTestApp, type TestSession } from "../test-utils/graphql-app.js";

let api: GraphqlTestApp;

beforeAll(async () => { api = await startGraphqlApp("library_universes"); }, replicaSetStartupTimeoutMs);
afterAll(async () => { await api?.stop(); });

interface LibrarySnapshot {
  tournaments: Tournament[];
  activity: ActivityEvent[];
  activeTournamentId: string | null;
  universes: SportsUniverseLibrary;
  libraryVersion: number;
}

/** Cada prueba trabaja con un usuario nuevo: la biblioteca de partida es exactamente la del escenario. */
let serial = 0;
const newUser = () => api.register(`universos-${++serial}@cancha.test`);

async function gql<T>(session: TestSession, query: string, variables?: Record<string, unknown>) {
  return api.gqlWith<T>({ token: session.accessToken }, query, variables);
}

async function snapshot(session: TestSession): Promise<LibrarySnapshot> {
  const response = await gql<{ librarySnapshot: LibrarySnapshot }>(session, "{ librarySnapshot }");
  expect(response.errors).toBeUndefined();
  return response.data!.librarySnapshot;
}

async function restoreReplace(session: TestSession, backup: unknown): Promise<void> {
  const response = await gql(session, `mutation R($backup: String!) { restoreBackup(backup: $backup, mode: REPLACE) { added } }`,
    { backup: JSON.stringify(backup) });
  expect(response.errors).toBeUndefined();
}

function commit(session: TestSession, changes: unknown, version: number) {
  return gql<{ commitLibraryChanges: { committed: boolean; libraryVersion: number } }>(session,
    `mutation C($changes: JSON!, $version: Int!) { commitLibraryChanges(changes: $changes, expectedLibraryVersion: $version) { committed libraryVersion } }`,
    { changes, version });
}

/** Usuario nuevo con la biblioteca de partida del escenario de referencia. */
async function seededScenario() {
  const scenario = universeReattributionScenario();
  const session = await newUser();
  await restoreReplace(session, createTournamentBackup(scenario.tournaments, undefined, scenario.activity, scenario.before));
  return { scenario, session };
}

const withoutUniverse = (events: readonly ActivityEvent[]) => events.map(({ universeId: _u, ...rest }) => { void _u; return rest; });

describe("universos deportivos en el servidor (fase 5C)", () => {
  it("equivalencia con localStorage: el cambio de referencia deja los universeId esperados", async () => {
    const { scenario, session } = await seededScenario();
    const before = await snapshot(session);
    expect(before.universes).toEqual(scenario.before);

    const response = await commit(session, { saved: [], deleted: [], events: [], universes: scenario.after }, before.libraryVersion);
    expect(response.errors).toBeUndefined();

    const after = await snapshot(session);
    expect(after.universes).toEqual(scenario.after);
    expect(scenarioUniverseIds(scenario, after.activity)).toEqual(scenario.expectedUniverseIds);
  });

  it("la reatribución sólo modifica universeId: el resto de cada evento queda idéntico", async () => {
    const { scenario, session } = await seededScenario();
    const before = await snapshot(session);
    await commit(session, { saved: [], deleted: [], events: [], universes: scenario.after }, before.libraryVersion);
    const after = await snapshot(session);
    expect(after.activity.map(({ id }) => id)).toEqual(before.activity.map(({ id }) => id));
    expect(withoutUniverse(after.activity)).toEqual(withoutUniverse(before.activity));
    expect(after.tournaments).toEqual(before.tournaments);
  });

  it("un cliente no puede enviar activityUniverseIds ni universos inválidos: VALIDATION sin escribir nada", async () => {
    const { scenario, session } = await seededScenario();
    const before = await snapshot(session);
    for (const changes of [
      { saved: [], deleted: [], events: [], activityUniverseIds: { "evento-c": "universo-uno" } },
      { saved: [], deleted: [], events: [], universes: { version: 1, activeUniverseId: "no-existe", universes: [], assignments: {} } },
      // Eliminar un torneo asignado sin retirar su asignación.
      { saved: [], deleted: [scenario.tournaments[0].id], events: [] },
    ]) {
      const response = await commit(session, changes, before.libraryVersion);
      expect(response.errors![0].extensions?.code).toBe("VALIDATION");
      expect(await snapshot(session)).toEqual(before);
    }
  });

  it("eliminar un torneo asignado retirando la asignación en el mismo envío", async () => {
    const { scenario, session } = await seededScenario();
    const before = await snapshot(session);
    const [a] = scenario.tournaments;
    const assignments = { ...scenario.before.assignments };
    delete assignments[a.id];
    const response = await commit(session, { saved: [], deleted: [a.id], events: [], universes: { ...scenario.before, assignments } }, before.libraryVersion);
    expect(response.errors).toBeUndefined();
    expect((await snapshot(session)).universes.assignments).not.toHaveProperty(a.id);
  });

  it("deleteTournament retira la asignación y deja el universo en el evento, como localStorage", async () => {
    const { scenario, session } = await seededScenario();
    const [a] = scenario.tournaments;
    const response = await gql(session, `mutation { deleteTournament(tournamentId: "${a.id}", expectedVersion: 1) }`);
    expect(response.errors).toBeUndefined();
    const after = await snapshot(session);
    expect(after.universes.assignments).not.toHaveProperty(a.id);
    expect(after.activity.at(-1)).toMatchObject({ action: "tournament-deleted", tournamentId: a.id, universeId: "universo-uno" });
  });

  it("exportLibrary incluye los universos y REPLACE los restaura en otra cuenta", async () => {
    const { scenario, session } = await seededScenario();
    const exported = (await gql<{ exportLibrary: { extensions?: { sportsUniverses?: SportsUniverseLibrary } } }>(session, "{ exportLibrary }")).data!.exportLibrary;
    expect(exported.extensions?.sportsUniverses).toEqual(scenario.before);

    const other = await newUser();
    await restoreReplace(other, exported);
    expect((await snapshot(other)).universes).toEqual(scenario.before);
  });

  it("un punto de guardado conserva los universos", async () => {
    const { scenario, session } = await seededScenario();
    const created = await gql<{ createSaveCheckpoint: { id: string } }>(session,
      `mutation { createSaveCheckpoint(name: "Con universos", description: "") { id } }`);
    expect(created.errors).toBeUndefined();
    const content = await gql<{ saveCheckpointContent: { extensions?: { sportsUniverses?: SportsUniverseLibrary } } }>(session,
      `query P($id: ID!) { saveCheckpointContent(id: $id) }`, { id: created.data!.createSaveCheckpoint.id });
    expect(content.data!.saveCheckpointContent.extensions?.sportsUniverses).toEqual(scenario.before);
  });

  it("aislamiento: los universos de un usuario no aparecen en otro", async () => {
    await seededScenario();
    const other = await newUser();
    expect((await snapshot(other)).universes).toEqual(emptySportsUniverseLibrary());
  });
});
