import request from "supertest";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startFakeOfficialSource, type FakeOfficialSource } from "../test-utils/fake-official-source.js";
import { startGraphqlApp, type GraphqlTestApp } from "../test-utils/graphql-app.js";
import { OFFICIAL_SOURCE_TARGETS } from "./official-sources.tokens.js";

// TRUST_PROXY=1: se confía sólo en el último salto (el proxy propio agrega la IP
// real al final de X-Forwarded-For). Lo que el cliente ponga antes es falsificable
// y no cuenta. Una app por archivo porque ConfigModule lee process.env al importar.
let origin: FakeOfficialSource;
let api: GraphqlTestApp;

beforeAll(async () => {
  origin = await startFakeOfficialSource();
  api = await startGraphqlApp("official_sources_proxy", { OFFICIAL_SOURCE_RATE_LIMIT: "2", TRUST_PROXY: "1" }, [
    { provide: OFFICIAL_SOURCE_TARGETS, useValue: origin.targets },
  ]);
});

afterAll(async () => {
  await api?.stop();
  await origin?.stop();
});

const call = (forwardedFor: string) =>
  request(api.app.getHttpServer()).get("/official-source/ok").set("X-Forwarded-For", forwardedFor);

it("con TRUST_PROXY=1 una cadena «falsa, real» cuenta para la IP real", async () => {
  expect((await call("203.0.113.9, 198.51.100.7")).status).toBe(200);
  // Cambiar sólo la parte falsificada no da otro cupo.
  expect((await call("203.0.113.10, 198.51.100.7")).status).toBe(200);
  expect((await call("203.0.113.11, 198.51.100.7")).status).toBe(429);
  expect((await call("198.51.100.7")).status).toBe(429);
  // Otra IP real (el último salto) tiene su propio cupo, aunque repita la parte falsa.
  expect((await call("203.0.113.9, 198.51.100.8")).status).toBe(200);
});
