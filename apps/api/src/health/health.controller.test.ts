import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import { MONGO_DATABASE } from "../database/database.tokens.js";
import { HealthModule } from "./health.module.js";
import { mongoPingTimeoutMs, type HealthReport, type PingableDatabase } from "./health.service.js";

let app: INestApplication | undefined;

async function startWith(database: PingableDatabase): Promise<string> {
  // Sustituye al DatabaseModule global por una base falsa con el mismo token.
  const fakeDatabaseModule = {
    module: class FakeDatabaseModule {},
    global: true,
    providers: [{ provide: MONGO_DATABASE, useValue: database }],
    exports: [MONGO_DATABASE],
  };
  const moduleRef = await Test.createTestingModule({ imports: [fakeDatabaseModule, HealthModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, "127.0.0.1");
  return `${await app.getUrl()}/health`.replace("[::1]", "127.0.0.1");
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /health", () => {
  it("responde 200 con la app y Mongo arriba", async () => {
    const commands: unknown[] = [];
    const url = await startWith({ command: async command => { commands.push(command); return { ok: 1 }; } });

    const response = await fetch(url);
    const body = await response.json() as HealthReport & { mongo: { latencyMs: number } };

    expect(response.status).toBe(200);
    expect(commands).toEqual([{ ping: 1 }]);
    expect(body).toMatchObject({ status: "ok", app: { status: "up", version: "0.1.0" }, mongo: { status: "up" } });
    expect(body.mongo.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.app.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("responde 503 e informa el error cuando Mongo falla", async () => {
    const url = await startWith({ command: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:27017"); } });

    const response = await fetch(url);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "error",
      app: { status: "up" },
      mongo: { status: "down", error: "connect ECONNREFUSED 127.0.0.1:27017" },
    });
  });

  it("responde 503 si Mongo no contesta a tiempo", async () => {
    const url = await startWith({ command: () => new Promise(() => {}) });

    const response = await fetch(url);

    expect(response.status).toBe(503);
    expect((await response.json() as HealthReport).mongo).toEqual({
      status: "down",
      error: `MongoDB no respondió al ping en ${mongoPingTimeoutMs} ms.`,
    });
  });
});
