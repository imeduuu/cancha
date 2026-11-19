import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MONGO_DATABASE } from "../database/database.tokens.js";
import { replicaSetStartupTimeoutMs } from "../test-utils/mongo-replica-set.js";
import { startGraphqlApp, type GraphqlResponse, type GraphqlTestApp, type TestSession } from "../test-utils/graphql-app.js";
import { saveCheckpointCollectionName } from "./mongo-save-checkpoint-store.js";

let api: GraphqlTestApp;
let alice: TestSession;
let bob: TestSession;

beforeAll(async () => {
  api = await startGraphqlApp("checkpoints");
  alice = api.session;
  bob = await api.register("bob@cancha.test");
}, replicaSetStartupTimeoutMs);
afterAll(async () => { await api?.stop(); });

const as = <T = Record<string, never>>(session: TestSession, query: string, variables?: Record<string, unknown>) =>
  api.gqlWith<T>({ token: session.accessToken }, query, variables);
const codeOf = (response: GraphqlResponse<unknown>) => response.errors?.[0]?.extensions?.code;
const checkpoints = () => api.app.get<Db>(MONGO_DATABASE).collection(saveCheckpointCollectionName);

const FIELDS = "id name description createdAt tournamentCount activityCount universeCount sizeBytes version revision backupVersion digest";
interface Checkpoint {
  id: string; name: string; version: number; tournamentCount: number; activityCount: number; sizeBytes: number;
  universeCount: number; revision: number; backupVersion: number; digest: string;
}
interface Backup { tournaments: { id: string; name: string }[]; activity: { id: string; action: string }[] }

async function createTournament(session: TestSession, name: string) {
  const response = await as<{ createTournament: { id: string; version: number } }>(session, `
    mutation Create($input: CreateTournamentInput!) { createTournament(input: $input) { id version } }
  `, { input: { name, teamNames: ["Norte", "Sur", "Este", "Oeste"], legs: 1, tieBreakers: ["goalDifference"] } });
  expect(response.errors).toBeUndefined();
  return response.data!.createTournament;
}
async function createCheckpoint(session: TestSession, name: string, description?: string) {
  const response = await as<{ createSaveCheckpoint: Checkpoint }>(session, `
    mutation Create($name: String!, $description: String) { createSaveCheckpoint(name: $name, description: $description) { ${FIELDS} } }
  `, { name, description });
  expect(response.errors).toBeUndefined();
  return response.data!.createSaveCheckpoint;
}
const preview = (session: TestSession, id: string) => as<{
  saveCheckpointPreview: { checkpoint: Checkpoint; libraryVersion: number; comparison: Record<string, unknown> };
}>(session, `{ saveCheckpointPreview(id: "${id}") { checkpoint { ${FIELDS} } libraryVersion comparison } }`);
const restore = (session: TestSession, id: string, version: number, libraryVersion: number) =>
  as<{ restoreSaveCheckpoint: { added: number; skipped: number; libraryVersion: number } }>(session, `
    mutation { restoreSaveCheckpoint(id: "${id}", expectedVersion: ${version}, expectedLibraryVersion: ${libraryVersion}) {
      added skipped libraryVersion } }`);
const exportLibrary = async (session: TestSession) =>
  (await as<{ exportLibrary: Backup }>(session, "{ exportLibrary }")).data!.exportLibrary;
const list = async (session: TestSession) =>
  (await as<{ saveCheckpoints: Checkpoint[] }>(session, `{ saveCheckpoints { ${FIELDS} } }`)).data!.saveCheckpoints;

describe("puntos de guardado en el servidor", () => {
  it("crear → cambiar la biblioteca → vista previa → restaurar deja la biblioteca como en el punto", async () => {
    const liga = await createTournament(alice, "Liga del punto");
    await as(alice, `mutation { simulateChampionship(tournamentId: "${liga.id}", expectedVersion: 1) { simulatedCount } }`);
    const original = await exportLibrary(alice);

    const point = await createCheckpoint(alice, "Antes de los cambios", "Temporada simulada");
    expect(point).toMatchObject({
      name: "Antes de los cambios", version: 1, tournamentCount: 1, activityCount: original.activity.length,
      universeCount: 0, revision: 1, backupVersion: 7,
    });
    expect(point.digest).toMatch(/^[a-f0-9]{64}$/);
    expect((await list(alice)).map(({ id }) => id)).toEqual([point.id]);

    await as(alice, `mutation { renameTournament(tournamentId: "${liga.id}", expectedVersion: 2, name: "Renombrada") { id } }`);
    await createTournament(alice, "Nueva después del punto");

    const shown = await preview(alice, point.id);
    expect(shown.errors).toBeUndefined();
    expect(shown.data!.saveCheckpointPreview.checkpoint.version).toBe(1);
    expect(shown.data!.saveCheckpointPreview.comparison).toMatchObject({
      sharedTournamentIds: [liga.id], changedTournamentIds: [liga.id], checkpointOnlyIds: [],
    });
    expect(shown.data!.saveCheckpointPreview.comparison.currentOnlyIds).toHaveLength(1);

    const libraryVersion = shown.data!.saveCheckpointPreview.libraryVersion;
    const restored = await restore(alice, point.id, 1, libraryVersion);
    expect(restored.errors).toBeUndefined();
    expect(restored.data!.restoreSaveCheckpoint).toEqual({ added: 1, skipped: 0, libraryVersion: libraryVersion + 1 });

    const after = await exportLibrary(alice);
    expect(after.tournaments).toEqual(original.tournaments);
    expect(after.activity.map(({ id }) => id)).toEqual([...original.activity.map(({ id }) => id), expect.any(String)]);
    expect(after.activity.at(-1)).toMatchObject({ action: "library-restored" });

    const content = await as<{ saveCheckpointContent: Backup }>(alice, `{ saveCheckpointContent(id: "${point.id}") }`);
    expect(content.data!.saveCheckpointContent).toMatchObject({ format: "cancha-backup", version: 7, tournaments: original.tournaments });
  });

  it("restaurar con una versión de biblioteca vieja es CONFLICT y no escribe nada", async () => {
    const point = await createCheckpoint(alice, "Para conflicto de biblioteca");
    const libraryVersion = (await preview(alice, point.id)).data!.saveCheckpointPreview.libraryVersion;
    await createTournament(alice, "Cambio entre vista previa y confirmación");
    const before = await exportLibrary(alice);

    const response = await restore(alice, point.id, 1, libraryVersion);
    expect(response.errors?.[0]?.extensions).toMatchObject({
      code: "CONFLICT", expectedLibraryVersion: libraryVersion, currentLibraryVersion: libraryVersion + 1,
    });
    expect(await exportLibrary(alice)).toEqual({ ...before, exportedAt: expect.any(String) });
  });

  it("restaurar un punto que cambió o fue eliminado es CONFLICT / NOT_FOUND, sin escribir nada", async () => {
    const point = await createCheckpoint(alice, "Para cambiar");
    const libraryVersion = (await preview(alice, point.id)).data!.saveCheckpointPreview.libraryVersion;
    const before = await exportLibrary(alice);

    await checkpoints().updateOne({ _id: { userId: alice.userId, id: point.id } as never }, { $inc: { _version: 1 } });
    const changed = await restore(alice, point.id, 1, libraryVersion);
    expect(changed.errors?.[0]?.extensions).toMatchObject({ code: "CONFLICT", checkpointId: point.id, expectedVersion: 1, currentVersion: 2 });

    expect((await as(alice, `mutation { deleteSaveCheckpoint(id: "${point.id}", expectedVersion: 2) }`)).errors).toBeUndefined();
    expect(codeOf(await restore(alice, point.id, 2, libraryVersion))).toBe("NOT_FOUND");
    expect(await exportLibrary(alice)).toEqual({ ...before, exportedAt: expect.any(String) });
  });

  it("eliminar con una versión vieja es CONFLICT; con la vigente lo elimina", async () => {
    const point = await createCheckpoint(alice, "Para eliminar");
    await checkpoints().updateOne({ _id: { userId: alice.userId, id: point.id } as never }, { $inc: { _version: 1 } });
    const stale = await as(alice, `mutation { deleteSaveCheckpoint(id: "${point.id}", expectedVersion: 1) }`);
    expect(stale.errors?.[0]?.extensions).toMatchObject({ code: "CONFLICT", currentVersion: 2 });
    expect((await as(alice, `mutation { deleteSaveCheckpoint(id: "${point.id}", expectedVersion: 2) }`)).errors).toBeUndefined();
    expect((await list(alice)).map(({ id }) => id)).not.toContain(point.id);
  });

  it("un punto alterado en la base no pasa la verificación (VALIDATION) y no se restaura", async () => {
    const point = await createCheckpoint(alice, "Para alterar");
    const libraryVersion = (await preview(alice, point.id)).data!.saveCheckpointPreview.libraryVersion;
    const stored = await checkpoints().findOne({ _id: { userId: alice.userId, id: point.id } as never });
    await checkpoints().updateOne({ _id: stored!._id }, { $set: { content: String(stored!.content).replace("Liga del punto", "Liga alterada") } });
    const before = await exportLibrary(alice);

    for (const response of [
      await preview(alice, point.id),
      await as(alice, `{ saveCheckpointContent(id: "${point.id}") }`),
      await restore(alice, point.id, 1, libraryVersion),
    ]) {
      expect(response.errors?.[0]).toMatchObject({ message: expect.stringMatching(/huella SHA-256 no coincide/), extensions: { code: "VALIDATION" } });
    }
    expect(await exportLibrary(alice)).toEqual({ ...before, exportedAt: expect.any(String) });
  });

  it("valida el nombre en español", async () => {
    const response = await as(alice, `mutation { createSaveCheckpoint(name: "   ") { id } }`);
    expect(response.errors?.[0]).toMatchObject({ message: expect.stringMatching(/Nombre: es obligatorio/), extensions: { code: "VALIDATION" } });
  });

  describe("aislamiento entre usuarios", () => {
    it("B no puede listar, ver, descargar, restaurar ni eliminar los puntos de A (NOT_FOUND)", async () => {
      const point = await createCheckpoint(alice, "Privado de A");
      const aliceBefore = await exportLibrary(alice);
      const bobLibraryVersion = (await as<{ library: { libraryVersion: number } }>(bob, "{ library { libraryVersion } }"))
        .data!.library.libraryVersion;

      expect((await list(bob)).map(({ id }) => id)).not.toContain(point.id);
      for (const response of [
        await preview(bob, point.id),
        await as(bob, `{ saveCheckpointContent(id: "${point.id}") }`),
        await restore(bob, point.id, 1, bobLibraryVersion),
        await as(bob, `mutation { deleteSaveCheckpoint(id: "${point.id}", expectedVersion: 1) }`),
      ]) {
        expect(codeOf(response)).toBe("NOT_FOUND");
        expect(JSON.stringify(response)).not.toContain("Privado de A");
      }
      expect((await list(alice)).map(({ id }) => id)).toContain(point.id);
      expect(await exportLibrary(alice)).toEqual({ ...aliceBefore, exportedAt: expect.any(String) });
    });

    it("restaurar un punto propio sólo reemplaza la biblioteca propia", async () => {
      await createTournament(bob, "Torneo de B");
      const point = await createCheckpoint(bob, "Punto de B");
      await createTournament(bob, "Otro de B");
      const aliceBefore = await exportLibrary(alice);

      const libraryVersion = (await preview(bob, point.id)).data!.saveCheckpointPreview.libraryVersion;
      expect((await restore(bob, point.id, 1, libraryVersion)).errors).toBeUndefined();

      expect((await exportLibrary(bob)).tournaments.map(({ name }) => name)).toEqual(["Torneo de B"]);
      expect(await exportLibrary(alice)).toEqual({ ...aliceBefore, exportedAt: expect.any(String) });
    });
  });
}, 60_000);
