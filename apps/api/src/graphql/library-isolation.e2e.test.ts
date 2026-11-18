import { GraphQLSchemaHost } from "@nestjs/graphql";
import { isInputObjectType, isObjectType } from "graphql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replicaSetStartupTimeoutMs } from "../test-utils/mongo-replica-set.js";
import { startGraphqlApp, type GraphqlResponse, type GraphqlTestApp, type TestSession } from "../test-utils/graphql-app.js";

/**
 * Aislamiento entre usuarios: lo más importante de la fase 4B. A y B tienen
 * torneos con el mismo nombre y, además, B importa un archivo de A conservando
 * su id, así que ambos tienen un torneo con el mismo id en su propia biblioteca.
 */
let api: GraphqlTestApp;
let alice: TestSession;
let bob: TestSession;

beforeAll(async () => {
  api = await startGraphqlApp("isolation");
  alice = api.session;
  bob = await api.register("bob@cancha.test");
}, replicaSetStartupTimeoutMs);
afterAll(async () => { await api?.stop(); });

const as = <T = Record<string, never>>(session: TestSession, query: string, variables?: Record<string, unknown>) =>
  api.gqlWith<T>({ token: session.accessToken }, query, variables);
const codeOf = (response: GraphqlResponse<unknown>) => response.errors?.[0]?.extensions?.code;

interface Backup { tournaments: { id: string; name: string }[]; activity: { id: string }[] }
const exportLibrary = async (session: TestSession) =>
  (await as<{ exportLibrary: Backup }>(session, "{ exportLibrary }")).data!.exportLibrary;
const libraryOf = async (session: TestSession) =>
  (await as<{ library: { libraryVersion: number; activeTournamentId: string | null } }>(
    session, "{ library { libraryVersion activeTournamentId } }")).data!.library;

async function create(session: TestSession, name: string) {
  const response = await as<{ createTournament: { id: string; version: number; matchdays: { fixtures: { id: string }[] }[] } }>(session, `
    mutation Create($input: CreateTournamentInput!) { createTournament(input: $input) { id version matchdays { fixtures { id } } } }
  `, { input: { name, teamNames: ["Norte", "Sur", "Este", "Oeste"], legs: 2, tieBreakers: ["goalDifference"] } });
  expect(response.errors).toBeUndefined();
  return response.data!.createTournament;
}

describe("aislamiento de la biblioteca entre usuarios", () => {
  let aliceOnly: Awaited<ReturnType<typeof create>>;
  let shared: Awaited<ReturnType<typeof create>>;

  beforeAll(async () => {
    aliceOnly = await create(alice, "Liga Clásica");
    shared = await create(alice, "Copa Compartida");
    await as(alice, `mutation { setActiveTournament(tournamentId: "${aliceOnly.id}") { libraryVersion } }`);
    await create(bob, "Liga Clásica");
    const archive = (await as<{ exportTournament: unknown }>(alice, `{ exportTournament(id: "${shared.id}") }`)).data!.exportTournament;
    const imported = await as<{ importTournament: { id: string } }>(bob, `
      mutation Import($archive: String!) { importTournament(archive: $archive, decision: ADD) { id } }
    `, { archive: JSON.stringify(archive) });
    expect(imported.errors).toBeUndefined();
    expect(imported.data!.importTournament.id).toBe(shared.id);
  });

  it("cada uno lista sólo lo suyo, aunque haya nombres e ids iguales", async () => {
    const list = async (session: TestSession) =>
      (await as<{ tournaments: { id: string; name: string }[] }>(session, "{ tournaments { id name } }")).data!.tournaments;
    const aliceList = await list(alice);
    const bobList = await list(bob);
    expect(aliceList.map(({ name }) => name).sort()).toEqual(["Copa Compartida", "Liga Clásica"]);
    expect(bobList.map(({ name }) => name).sort()).toEqual(["Copa Compartida", "Liga Clásica"]);
    expect(bobList.map(({ id }) => id)).not.toContain(aliceOnly.id);
    expect(bobList.filter(({ id }) => id === shared.id)).toHaveLength(1);

    const bobActivity = (await as<{ activity: { tournamentId: string }[] }>(bob, "{ activity { tournamentId } }")).data!.activity;
    expect(bobActivity.map(({ tournamentId }) => tournamentId)).not.toContain(aliceOnly.id);
    const filtered = await as<{ activity: unknown[] }>(bob, `{ activity(tournamentId: "${aliceOnly.id}") { id } }`);
    expect(filtered.data!.activity).toEqual([]);
  });

  it("ninguna operación de B alcanza un torneo de A: NOT_FOUND y A queda intacto", async () => {
    const before = await exportLibrary(alice);
    const aliceLibrary = await libraryOf(alice);
    const id = aliceOnly.id;
    const fixtureId = aliceOnly.matchdays[0].fixtures[0].id;

    const attempts: Record<string, string> = {
      tournament: `{ tournament(id: "${id}") { id } }`,
      exportTournament: `{ exportTournament(id: "${id}") }`,
      updateMatchResult: `mutation { updateMatchResult(tournamentId: "${id}", expectedVersion: 1, fixtureId: "${fixtureId}",
        result: { homeGoals: 1, awayGoals: 0 }) { id } }`,
      simulateMatchday: `mutation { simulateMatchday(tournamentId: "${id}", expectedVersion: 1, matchdayIndex: 0) { simulatedCount } }`,
      simulateLeg: `mutation { simulateLeg(tournamentId: "${id}", expectedVersion: 1, leg: 1) { simulatedCount } }`,
      simulateChampionship: `mutation { simulateChampionship(tournamentId: "${id}", expectedVersion: 1) { simulatedCount } }`,
      renameTournament: `mutation { renameTournament(tournamentId: "${id}", expectedVersion: 1, name: "Robada") { id } }`,
      duplicateTournament: `mutation { duplicateTournament(tournamentId: "${id}", expectedVersion: 1, mode: COPY) { id } }`,
      setTournamentArchived: `mutation { setTournamentArchived(tournamentId: "${id}", expectedVersion: 1, archived: true) { id } }`,
      deleteTournament: `mutation { deleteTournament(tournamentId: "${id}", expectedVersion: 1) }`,
      setActiveTournament: `mutation { setActiveTournament(tournamentId: "${id}") { activeTournamentId } }`,
    };
    for (const [operation, query] of Object.entries(attempts)) {
      const response = await as(bob, query);
      expect({ operation, code: codeOf(response) }).toEqual({ operation, code: "NOT_FOUND" });
      expect(JSON.stringify(response)).not.toContain("Liga Clásica");
    }
    expect((await as<{ activeTournament: unknown }>(bob, "{ activeTournament { id } }")).data!.activeTournament).toBeNull();

    expect(await exportLibrary(alice)).toEqual({ ...before, exportedAt: expect.any(String) });
    expect(await libraryOf(alice)).toEqual(aliceLibrary);
  });

  it("con el mismo id, B sólo cambia su propia copia", async () => {
    const aliceCopy = (await as<{ exportTournament: { tournament: unknown } }>(alice, `{ exportTournament(id: "${shared.id}") }`))
      .data!.exportTournament.tournament;

    const renamed = await as<{ renameTournament: { name: string; version: number } }>(bob,
      `mutation { renameTournament(tournamentId: "${shared.id}", expectedVersion: 1, name: "Copa de B") { name version } }`);
    expect(renamed.data!.renameTournament).toEqual({ name: "Copa de B", version: 2 });
    const simulated = await as(bob, `mutation { simulateChampionship(tournamentId: "${shared.id}", expectedVersion: 2) { simulatedCount } }`);
    expect(simulated.errors).toBeUndefined();
    expect((await as(bob, `mutation { deleteTournament(tournamentId: "${shared.id}", expectedVersion: 3) }`)).errors).toBeUndefined();

    const after = await as<{ tournament: { name: string; version: number; playedMatches: number }; exportTournament: { tournament: unknown } }>(
      alice, `{ tournament(id: "${shared.id}") { name version playedMatches } exportTournament(id: "${shared.id}") }`);
    expect(after.data!.tournament).toEqual({ name: "Copa Compartida", version: 1, playedMatches: 0 });
    expect(after.data!.exportTournament.tournament).toEqual(aliceCopy);
  });

  it("restaurar con REPLACE sólo reemplaza la biblioteca, el historial y el torneo activo propios", async () => {
    const aliceBefore = await exportLibrary(alice);
    const aliceLibrary = await libraryOf(alice);
    const emptyBackup = { format: "cancha-backup", version: 7, exportedAt: new Date().toISOString(), tournaments: [], activity: [] };

    const restored = await as<{ restoreBackup: { added: number } }>(bob, `
      mutation Restore($backup: String!) { restoreBackup(backup: $backup, mode: REPLACE) { added } }
    `, { backup: JSON.stringify(emptyBackup) });
    expect(restored.errors).toBeUndefined();

    expect((await exportLibrary(bob)).tournaments).toEqual([]);
    expect(await exportLibrary(alice)).toEqual({ ...aliceBefore, exportedAt: expect.any(String) });
    expect(await libraryOf(alice)).toEqual(aliceLibrary);
    expect(aliceLibrary.activeTournamentId).toBe(aliceOnly.id);
  });

  it("la versión de biblioteca es independiente por usuario", async () => {
    const aliceVersion = (await libraryOf(alice)).libraryVersion;
    const bobVersion = (await libraryOf(bob)).libraryVersion;
    await create(bob, "Otra de B");
    await create(bob, "Y otra más");
    expect((await libraryOf(alice)).libraryVersion).toBe(aliceVersion);
    expect((await libraryOf(bob)).libraryVersion).toBe(bobVersion + 2);

    // Una mutación de A con la versión que A leyó no ve conflicto por las escrituras de B.
    const renamed = await as(alice, `mutation { renameTournament(tournamentId: "${aliceOnly.id}", expectedVersion: 1, name: "Liga de A") { id } }`);
    expect(renamed.errors).toBeUndefined();
  });

  it("el esquema no acepta un userId del cliente en ninguna operación", () => {
    const schema = api.app.get(GraphQLSchemaHost).schema;
    const names = new Set<string>();
    for (const type of Object.values(schema.getTypeMap())) {
      if (type.name.startsWith("__")) continue;
      if (isObjectType(type)) {
        for (const field of Object.values(type.getFields())) field.args.forEach(arg => names.add(arg.name));
      }
      if (isInputObjectType(type)) Object.keys(type.getFields()).forEach(name => names.add(name));
    }
    expect([...names].filter(name => /user|owner/i.test(name))).toEqual([]);
  });
}, 60_000);
