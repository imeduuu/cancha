import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { officialSourceMessages } from "@cancha/official-source-proxy";
import { startFakeOfficialSource, type FakeOfficialSource } from "../test-utils/fake-official-source.js";
import { startGraphqlApp, type GraphqlTestApp } from "../test-utils/graphql-app.js";
import { OFFICIAL_SOURCE_TARGETS } from "./official-sources.tokens.js";

let origin: FakeOfficialSource;
let api: GraphqlTestApp;
const http = () => request(api.app.getHttpServer());

beforeAll(async () => {
  origin = await startFakeOfficialSource();
  api = await startGraphqlApp("official_sources", {}, [{ provide: OFFICIAL_SOURCE_TARGETS, useValue: origin.targets }]);
});

afterAll(async () => {
  await api?.stop();
  await origin?.stop();
});

beforeEach(() => { origin.hits.length = 0; });

describe("proxy de fuentes oficiales en la API", () => {
  it.each(["/official-source", "/third-division-source", "/argentina-cup-source", "/brazil-cup-source"])(
    "%s responde sin sesión con el contenido del origen",
    async prefix => {
      const response = await http().get(`${prefix}/ok?j=2`);
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(response.text).toBe("<p>/ok?j=2</p>");
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(origin.hits.map(hit => hit.url)).toEqual(prefix === "/official-source" ? ["/ok?j=2"] : []);
    },
  );

  it.each([
    ["/official-source", "/"],
    ["/official-source/", "/"],
    ["/official-source?j=1", "/?j=1"],
    ["/third-division-source/?j=1", "/?j=1"],
    ["/argentina-cup-source/ok/", "/ok/"],
    ["/brazil-cup-source/ok/?j=3&x=1", "/ok/?j=3&x=1"],
  ])("%s (prefijo solo o barra final) llega al proxy y pide %s al origen", async (path, upstream) => {
    const response = await http().get(path);
    expect(response.status).toBe(200);
    expect(response.text).toBe(`<p>${upstream}</p>`);
  });

  it("no reenvía la cookie de sesión ni el access token al origen", async () => {
    const response = await http().get("/official-source/ok?privado")
      .set("Authorization", `Bearer ${api.session.accessToken}`)
      .set("Cookie", api.session.refreshCookie)
      .set("RSC", "1");
    expect(response.status).toBe(200);
    expect(origin.hits[0].headers.authorization).toBeUndefined();
    expect(origin.hits[0].headers.cookie).toBeUndefined();
    expect(origin.hits[0].headers.rsc).toBeUndefined();
  });

  it("reenvía RSC: 1 hacia Copa do Brasil", async () => {
    await http().get("/brazil-cup-source/ok?rsc").set("RSC", "1");
    expect(origin.hits[0].headers.rsc).toBe("1");
  });

  it("sirve la segunda consulta desde la caché", async () => {
    const first = await http().get("/third-division-source/ok?cache=1");
    const second = await http().get("/third-division-source/ok?cache=1");
    expect(first.headers["x-cancha-source-cache"]).toBe("miss");
    expect(second.headers["x-cancha-source-cache"]).toBe("hit");
    expect(origin.hits).toHaveLength(1);
  });

  it.each(["post", "put", "delete", "patch"] as const)("%s responde 405", async method => {
    const response = await http()[method]("/official-source/ok");
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe("GET");
    expect(origin.hits).toEqual([]);
  });

  it.each(["/official-source/%2e%2e/ok", "/official-source/a%2f..%2fok", "/official-source//evil.example/ok", "/official-source/a@evil.example"])(
    "rechaza %s con 400",
    async path => {
      const response = await http().get(path);
      expect(response.status).toBe(400);
      expect(response.text).toBe(officialSourceMessages.invalidPath);
      expect(origin.hits).toEqual([]);
    },
  );

  it("una ruta parecida a un prefijo no llega al proxy", async () => {
    const response = await http().get("/official-sourcex/ok");
    expect(response.status).toBe(404);
    expect(origin.hits).toEqual([]);
  });

  it("un error del origen responde 502 en español y no queda en caché", async () => {
    const first = await http().get("/official-source/fail");
    expect(first.status).toBe(502);
    expect(first.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(first.text).toBe("La fuente oficial respondió con HTTP 500.");
    await http().get("/official-source/fail");
    expect(origin.hits).toHaveLength(4);
  });

  it("no sigue una redirección hacia otro host", async () => {
    const response = await http().get("/official-source/redirect-foreign");
    expect(response.status).toBe(502);
    expect(response.text).toBe(officialSourceMessages.foreignRedirect);
  });
});
