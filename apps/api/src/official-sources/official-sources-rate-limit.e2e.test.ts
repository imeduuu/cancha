import request from "supertest";
import { afterAll, beforeAll, expect, it } from "vitest";
import { officialSourceMessages } from "@cancha/official-source-proxy";
import { startFakeOfficialSource, type FakeOfficialSource } from "../test-utils/fake-official-source.js";
import { startGraphqlApp, type GraphqlTestApp } from "../test-utils/graphql-app.js";
import { OFFICIAL_SOURCE_TARGETS } from "./official-sources.tokens.js";

// Sin TRUST_PROXY (0): X-Forwarded-For no cuenta y el límite se aplica por la IP
// de la conexión. Una app por archivo porque ConfigModule lee process.env al importar.
let origin: FakeOfficialSource;
let api: GraphqlTestApp;

beforeAll(async () => {
  origin = await startFakeOfficialSource();
  api = await startGraphqlApp("official_sources_rate", { OFFICIAL_SOURCE_RATE_LIMIT: "2" }, [
    { provide: OFFICIAL_SOURCE_TARGETS, useValue: origin.targets },
  ]);
});

afterAll(async () => {
  await api?.stop();
  await origin?.stop();
});

it("sin TRUST_PROXY ignora un X-Forwarded-For falso y limita por la IP real", async () => {
  const call = (forwardedFor: string) =>
    request(api.app.getHttpServer()).get("/official-source/ok").set("X-Forwarded-For", forwardedFor);
  expect((await call("203.0.113.1")).status).toBe(200);
  expect((await call("203.0.113.2")).status).toBe(200);
  const limited = await call("203.0.113.3");
  expect(limited.status).toBe(429);
  expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  expect(limited.text).toBe(officialSourceMessages.rateLimited);
  // Tampoco sin cabecera: el contador es el de la conexión real.
  expect((await request(api.app.getHttpServer()).get("/official-source/ok")).status).toBe(429);
});
