import { createSaveCheckpoint } from "@cancha/core/application/services/save-checkpoints";
import type { SaveCheckpoint } from "@cancha/core/domain/entities/save-checkpoint";
import { closureLeague } from "@cancha/core/test-utils/season-closure-fixtures";
import type { Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "../library/library-unit-of-work.js";
import { replicaSetStartupTimeoutMs, startTestReplicaSet, type TestReplicaSet } from "../test-utils/mongo-replica-set.js";
import {
  maximumCheckpointsPerUser,
  MongoSaveCheckpointStore,
  saveCheckpointCollectionName,
  SaveCheckpointVersionConflictError,
} from "./mongo-save-checkpoint-store.js";

let replicaSet: TestReplicaSet;
let database: Db;

beforeAll(async () => { replicaSet = await startTestReplicaSet(); }, replicaSetStartupTimeoutMs);
afterAll(async () => { await replicaSet?.stop(); });
beforeEach(async () => {
  database = replicaSet.freshDatabase();
  await MongoSaveCheckpointStore.ensureIndexes(database);
});

const open = (userId = "user-a") => new MongoSaveCheckpointStore(replicaSet.client, database, userId);
let counter = 0;
const checkpoint = (name = "Punto", at = new Date(Date.UTC(2026, 0, 1, 0, 0, counter))): Promise<SaveCheckpoint> =>
  createSaveCheckpoint({ tournaments: [closureLeague("liga")], activity: [] }, name, "", {
    now: () => at, createId: () => `punto-${++counter}`,
  });

describe("MongoSaveCheckpointStore", () => {
  it("guarda, lista sin contenido (lo más reciente primero) y devuelve el registro con su versión", async () => {
    const store = open();
    const older = await checkpoint("Antiguo", new Date("2026-01-01T00:00:00Z"));
    const newer = await checkpoint("Reciente", new Date("2026-02-01T00:00:00Z"));
    expect(await store.add(older)).toBe(1);
    await store.add(newer);

    const list = await store.list();
    expect(list.map(({ name }) => name)).toEqual(["Reciente", "Antiguo"]);
    expect(list[0]).not.toHaveProperty("content");
    expect(list[0]).toMatchObject({ id: newer.id, version: 1, tournamentCount: 1 });
    expect(await store.get(older.id)).toEqual({ record: older, version: 1 });
    expect(await store.get("no-existe")).toBeUndefined();
    const raw = await database.collection(saveCheckpointCollectionName).findOne({ _id: { userId: "user-a", id: older.id } as never });
    expect(raw).toMatchObject({ _version: 1, name: "Antiguo" });
  });

  it("eliminar es compare-and-set: versión vieja ⇒ conflicto; inexistente ⇒ NotFoundError", async () => {
    const store = open();
    const point = await checkpoint();
    await store.add(point);
    await expect(store.delete(point.id, 2)).rejects.toBeInstanceOf(SaveCheckpointVersionConflictError);
    await store.delete(point.id, 1);
    expect(await store.get(point.id)).toBeUndefined();
    await expect(store.delete(point.id, 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("assertVersion dentro de una transacción falla si el punto cambió o ya no existe", async () => {
    const store = open();
    const point = await checkpoint();
    await store.add(point);
    const inTransaction = (version: number) => replicaSet.client.withSession(session =>
      session.withTransaction(() => store.assertVersion(point.id, version, session)));
    await expect(inTransaction(1)).resolves.toBeUndefined();
    await expect(inTransaction(3)).rejects.toMatchObject({ expectedVersion: 3, actualVersion: 1 });
    await store.delete(point.id, 1);
    await expect(inTransaction(1)).rejects.toMatchObject({ expectedVersion: 1, actualVersion: null });
    // La marca de la restauración no se filtra al registro ni al listado.
    const again = await checkpoint();
    await store.add(again);
    await replicaSet.client.withSession(session => session.withTransaction(() => store.assertVersion(again.id, 1, session)));
    expect((await store.get(again.id))!.record).toEqual(again);
  });

  it(`limita a ${maximumCheckpointsPerUser} puntos por usuario`, async () => {
    const store = open();
    for (let index = 0; index < maximumCheckpointsPerUser; index++) await store.add(await checkpoint(`P${index}`));
    await expect(store.add(await checkpoint("Uno más"))).rejects.toThrow(`ya tienes ${maximumCheckpointsPerUser} puntos`);
    // El tope es por usuario.
    await expect(open("user-b").add(await checkpoint("De B"))).resolves.toBe(1);
  });

  it("aísla por usuario: el mismo id no choca y lo ajeno no se ve ni se elimina", async () => {
    const point = await checkpoint();
    await open("user-a").add(point);
    await open("user-b").add(point);
    await expect(open("user-c").delete(point.id, 1)).rejects.toBeInstanceOf(NotFoundError);
    expect(await open("user-c").get(point.id)).toBeUndefined();
    expect(await open("user-c").list()).toEqual([]);
    await open("user-b").delete(point.id, 1);
    expect((await open("user-a").list()).map(({ id }) => id)).toEqual([point.id]);
  });

  it("el listado usa el índice por usuario", async () => {
    for (const userId of ["user-a", "user-b"]) await open(userId).add(await checkpoint());
    const explained = await database.collection(saveCheckpointCollectionName)
      .find({ "_id.userId": "user-a" }).sort({ createdAt: -1, "_id.id": 1 }).explain("queryPlanner");
    const plan = JSON.stringify(explained.queryPlanner);
    expect(plan).toContain("IXSCAN");
    expect(plan).not.toContain("COLLSCAN");
  });
}, 60_000);
