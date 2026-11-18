import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replicaSetStartupTimeoutMs, startTestReplicaSet, type TestReplicaSet } from "../test-utils/mongo-replica-set.js";

let replicaSet: TestReplicaSet;
let app: INestApplication;
const databaseName = `graphql_${process.pid}_${Date.now()}`;

beforeAll(async () => {
  replicaSet = await startTestReplicaSet();
  Object.assign(process.env, { NODE_ENV: "test", MONGODB_URI: replicaSet.uri, MONGODB_DB: databaseName });
  const { AppModule } = await import("../app.module.js");
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
}, replicaSetStartupTimeoutMs);

afterAll(async () => {
  await app?.close();
  await replicaSet?.stop();
});

interface GraphqlError { message: string; extensions?: Record<string, unknown> }
interface GraphqlResponse<T> { data?: T | null; errors?: GraphqlError[] }

async function gql<T = Record<string, never>>(query: string, variables: Record<string, unknown> = {}) {
  const response = await request(app.getHttpServer()).post("/graphql").send({ query, variables });
  return response.body as GraphqlResponse<T>;
}

const TOURNAMENT_FIELDS = `
  id name version playedMatches totalMatches status
  matchdays { index number leg fixtures { id homeTeamName awayTeamName result { homeGoals awayGoals } } }
  standings { position teamName played wins draws losses goalsFor goalsAgainst points }
`;

interface TournamentPayload {
  id: string;
  name: string;
  version: number;
  playedMatches: number;
  totalMatches: number;
  status: string;
  matchdays: { index: number; leg: number; fixtures: { id: string; result: { homeGoals: number; awayGoals: number } | null }[] }[];
  standings: { position: number; teamName: string; played: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number; points: number }[];
}

async function createLeague(name: string, teamNames = ["Club Uno", "Club Dos", "Club Tres", "Club Cuatro"]) {
  return gql<{ createTournament: TournamentPayload }>(`
    mutation Create($input: CreateTournamentInput!) { createTournament(input: $input) { ${TOURNAMENT_FIELDS} } }
  `, { input: { name, teamNames, legs: 2, tieBreakers: ["goalDifference", "goalsFor"] } });
}

describe("API GraphQL (supertest + replica set en memoria)", () => {
  it("flujo crear -> simular fecha -> simular campeonato -> consultar tabla", async () => {
    const created = await createLeague("Liga GraphQL");
    expect(created.errors).toBeUndefined();
    const tournament = created.data!.createTournament;
    expect(tournament).toMatchObject({ name: "Liga GraphQL", version: 1, playedMatches: 0, totalMatches: 12 });

    const matchday = await gql<{ simulateMatchday: { simulatedCount: number; tournament: TournamentPayload } }>(`
      mutation { simulateMatchday(tournamentId: "${tournament.id}", expectedVersion: 1, matchdayIndex: 0) {
        simulatedCount tournament { ${TOURNAMENT_FIELDS} } } }
    `);
    expect(matchday.errors).toBeUndefined();
    expect(matchday.data!.simulateMatchday.simulatedCount).toBe(2);
    expect(matchday.data!.simulateMatchday.tournament).toMatchObject({ version: 2, playedMatches: 2 });

    const championship = await gql<{ simulateChampionship: { simulatedCount: number } }>(`
      mutation { simulateChampionship(tournamentId: "${tournament.id}", expectedVersion: 2) { simulatedCount } }
    `);
    expect(championship.errors).toBeUndefined();
    expect(championship.data!.simulateChampionship.simulatedCount).toBe(10);

    const queried = await gql<{ tournament: TournamentPayload }>(`{ tournament(id: "${tournament.id}") { ${TOURNAMENT_FIELDS} } }`);
    expect(queried.errors).toBeUndefined();
    const final = queried.data!.tournament;
    expect(final).toMatchObject({ version: 3, playedMatches: 12, totalMatches: 12, status: "Finalizado" });
    expect(final.matchdays.flatMap(({ fixtures }) => fixtures).every(({ result }) => result !== null)).toBe(true);
    expect(final.standings.map(({ position }) => position)).toEqual([1, 2, 3, 4]);
    expect(final.standings.every(({ played }) => played === 6)).toBe(true);
    const goalsFor = final.standings.reduce((sum, row) => sum + row.goalsFor, 0);
    const goalsAgainst = final.standings.reduce((sum, row) => sum + row.goalsAgainst, 0);
    expect(goalsFor).toBe(goalsAgainst);
    for (const row of final.standings) expect(row.points).toBe(row.wins * 3 + row.draws);
    const points = final.standings.map(({ points: value }) => value);
    expect(points).toEqual([...points].sort((a, b) => b - a));

    const listed = await gql<{ tournaments: { id: string; version: number; status: string }[] }>(
      "{ tournaments { id version status } }");
    expect(listed.data!.tournaments).toContainEqual({ id: tournament.id, version: 3, status: "Finalizado" });

    const activity = await gql<{ activity: { action: string }[] }>(
      `{ activity(tournamentId: "${tournament.id}") { action } }`);
    expect(activity.data!.activity.map(({ action }) => action))
      .toEqual(["matches-simulated", "matches-simulated", "tournament-created"]);
  });

  it("un conflicto de versión es CONFLICT con la versión vigente y no escribe", async () => {
    const { id } = (await createLeague("Liga en disputa")).data!.createTournament;
    const rename = (name: string) => gql<{ renameTournament: { name: string; version: number } }>(`
      mutation { renameTournament(tournamentId: "${id}", expectedVersion: 1, name: "${name}") { name version } }
    `);

    const first = await rename("Primer nombre");
    const second = await rename("Segundo nombre");

    expect(first.data!.renameTournament).toEqual({ name: "Primer nombre", version: 2 });
    expect(second.data ?? null).toBeNull();
    expect(second.errors).toHaveLength(1);
    expect(second.errors![0].message).toMatch(/otro cliente lo modificó \(versión esperada 1, versión actual 2\)/);
    expect(second.errors![0].extensions).toEqual({ code: "CONFLICT", tournamentId: id, expectedVersion: 1, currentVersion: 2 });
    const current = await gql<{ tournament: { name: string; version: number } }>(`{ tournament(id: "${id}") { name version } }`);
    expect(current.data!.tournament).toEqual({ name: "Primer nombre", version: 2 });
  });

  it("un error de dominio es VALIDATION con el mensaje en español y sin stack trace", async () => {
    const before = await gql<{ library: { libraryVersion: number } }>("{ library { libraryVersion } }");

    const response = await createLeague("Liga incompleta", ["Club Solitario"]);

    expect(response.data ?? null).toBeNull();
    expect(response.errors).toHaveLength(1);
    expect(response.errors![0].extensions).toEqual({ code: "VALIDATION" });
    expect(response.errors![0].message).toMatch(/equipos/i);
    expect(JSON.stringify(response)).not.toMatch(/stacktrace|\.ts:\d+/);
    const after = await gql<{ library: { libraryVersion: number } }>("{ library { libraryVersion } }");
    expect(after.data!.library.libraryVersion).toBe(before.data!.library.libraryVersion);
  });

  it("NOT_FOUND para un torneo inexistente, también en mutaciones", async () => {
    const query = await gql(`{ tournament(id: "no-existe") { id } }`);
    expect(query.errors![0]).toMatchObject({
      message: 'No se encontró el campeonato "no-existe".',
      extensions: { code: "NOT_FOUND" },
    });
    const mutation = await gql(`mutation { renameTournament(tournamentId: "no-existe", expectedVersion: 1, name: "X") { id } }`);
    expect(mutation.errors![0].extensions).toEqual({ code: "NOT_FOUND" });
  });

  it("biblioteca: duplicar, archivar, torneo activo y eliminar", async () => {
    const { id } = (await createLeague("Liga original")).data!.createTournament;

    const copy = await gql<{ duplicateTournament: { id: string; name: string; version: number } }>(`
      mutation { duplicateTournament(tournamentId: "${id}", expectedVersion: 1, mode: RESET) { id name version } }
    `);
    expect(copy.errors).toBeUndefined();
    const copyId = copy.data!.duplicateTournament.id;
    expect(copyId).not.toBe(id);
    expect(copy.data!.duplicateTournament.version).toBe(1);

    const archived = await gql<{ setTournamentArchived: { archived: boolean; version: number } }>(`
      mutation { setTournamentArchived(tournamentId: "${copyId}", expectedVersion: 1, archived: true) { archived version } }
    `);
    expect(archived.data!.setTournamentArchived).toEqual({ archived: true, version: 2 });
    const visible = await gql<{ tournaments: { id: string }[] }>("{ tournaments(includeArchived: false) { id } }");
    expect(visible.data!.tournaments.map(({ id: listed }) => listed)).not.toContain(copyId);

    const active = await gql<{ setActiveTournament: { activeTournamentId: string } }>(`
      mutation { setActiveTournament(tournamentId: "${id}") { activeTournamentId libraryVersion } }
    `);
    expect(active.data!.setActiveTournament.activeTournamentId).toBe(id);
    const activeQuery = await gql<{ activeTournament: { id: string } }>("{ activeTournament { id } }");
    expect(activeQuery.data!.activeTournament.id).toBe(id);
    const missing = await gql(`mutation { setActiveTournament(tournamentId: "no-existe") { activeTournamentId } }`);
    expect(missing.errors![0].extensions).toEqual({ code: "NOT_FOUND" });

    const deleted = await gql<{ deleteTournament: boolean }>(`
      mutation { deleteTournament(tournamentId: "${copyId}", expectedVersion: 2) }
    `);
    expect(deleted.data!.deleteTournament).toBe(true);
    const gone = await gql(`{ tournament(id: "${copyId}") { id } }`);
    expect(gone.errors![0].extensions).toEqual({ code: "NOT_FOUND" });
    const activity = await gql<{ activity: { action: string }[] }>(`{ activity(tournamentId: "${copyId}", limit: 1) { action } }`);
    expect(activity.data!.activity).toEqual([{ action: "tournament-deleted" }]);
  });

  it("los errores de la consulta conservan el código de GraphQL", async () => {
    const response = await gql(`{ tournament(id: 5, extra: true) { id } }`);
    expect(response.errors![0].extensions?.code).toBe("GRAPHQL_VALIDATION_FAILED");
  });

  it("fuera de desarrollo no hay introspección ni landing page", async () => {
    const introspection = await gql("{ __schema { queryType { name } } }");
    expect(introspection.errors![0].message).toMatch(/introspection/i);

    const landing = await request(app.getHttpServer()).get("/graphql").set("Accept", "text/html");
    expect(landing.text).not.toMatch(/graphiql/i);
    expect(landing.status).toBeGreaterThanOrEqual(400);
  });
}, 60_000);
