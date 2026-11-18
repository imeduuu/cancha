import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { closureLeague } from "@cancha/core/test-utils/season-closure-fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TOURNAMENT_REPOSITORY_FACTORY,
  type TournamentRepositoryFactory,
} from "./infrastructure/persistence/tournament-persistence.module.js";
import { replicaSetStartupTimeoutMs, startTestReplicaSet, type TestReplicaSet } from "./test-utils/mongo-replica-set.js";

let replicaSet: TestReplicaSet;
let app: INestApplication;
const databaseName = `app_${process.pid}_${Date.now()}`;

beforeAll(async () => {
  replicaSet = await startTestReplicaSet();
  // ConfigModule valida process.env al importar AppModule; las variables ya
  // definidas tienen prioridad sobre un .env local.
  Object.assign(process.env, { NODE_ENV: "test", MONGODB_URI: replicaSet.uri, MONGODB_DB: databaseName });
  const { AppModule } = await import("./app.module.js");
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, "127.0.0.1");
}, replicaSetStartupTimeoutMs);

afterAll(async () => {
  await app?.close();
  await replicaSet?.stop();
});

describe("AppModule con MongoDB real (replica set)", () => {
  it("GET /health responde 200 con Mongo arriba", async () => {
    const response = await fetch(`${(await app.getUrl()).replace("[::1]", "127.0.0.1")}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", mongo: { status: "up" } });
  });

  it("crea los índices al arrancar y la fábrica entrega repositorios independientes", async () => {
    const create = app.get<TournamentRepositoryFactory>(TOURNAMENT_REPOSITORY_FACTORY);
    const first = create();
    expect(create()).not.toBe(first);

    await first.save(closureLeague("desde-app"));
    expect((await create().findAll()).map(({ id }) => id)).toEqual(["desde-app"]);

    await expect.poll(async () =>
      (await replicaSet.client.db(databaseName).collection("activity").indexes()).map(({ name }) => name),
    ).toEqual(expect.arrayContaining(["seq_unique", "tournament_seq"]));
  });
});
