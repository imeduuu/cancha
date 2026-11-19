import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createOfficialSourceProxy,
  officialSourceMessages,
  officialSourcePrefixes,
  officialSourceTargets,
  type OfficialSourceProxyOptions,
  type OfficialSourceResponse,
  type OfficialSourceTargets,
} from "./index";

/** Origen falso: registra cada consulta que recibe. */
interface OriginHit { readonly url: string; readonly headers: IncomingHttpHeaders }

let origin: Server;
let originUrl: string;
let targets: OfficialSourceTargets;
const hits: OriginHit[] = [];
const hanging: ServerResponse[] = [];
let counter = 0;

function route(url: string, res: ServerResponse): void {
  const path = url.split("?")[0];
  switch (path) {
    case "/ok":
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": "origen=1" });
      res.end(`<p>${url}</p>`);
      return;
    case "/count":
      counter += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ counter }));
      return;
    case "/slow-count":
      counter += 1;
      setTimeout(() => { res.writeHead(200, { "content-type": "text/plain" }); res.end(`n=${counter}`); }, 50);
      return;
    case "/six":
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(url.padEnd(6, "x").slice(0, 6));
      return;
    case "/redirect-same":
      res.writeHead(302, { location: "/ok?from=redirect" });
      res.end();
      return;
    case "/redirect-foreign":
      res.writeHead(302, { location: "https://evil.example/robar" });
      res.end();
      return;
    case "/redirect-escape":
      res.writeHead(301, { location: "//evil.example/robar" });
      res.end();
      return;
    case "/redirect-loop":
      res.writeHead(307, { location: "/redirect-loop" });
      res.end();
      return;
    case "/big-declared":
      res.writeHead(200, { "content-type": "text/plain", "content-length": "1000" });
      res.end("x".repeat(1000));
      return;
    case "/big-stream":
      res.writeHead(200, { "content-type": "text/plain" });
      for (let index = 0; index < 10; index += 1) res.write("x".repeat(100));
      res.end();
      return;
    case "/slow":
      hanging.push(res);
      return;
    case "/fail":
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("error del origen");
      return;
    default:
      res.writeHead(404);
      res.end();
  }
}

beforeAll(async () => {
  origin = createServer((req, res) => {
    hits.push({ url: req.url ?? "", headers: req.headers });
    route(req.url ?? "/", res);
  });
  await new Promise<void>(resolve => origin.listen(0, "127.0.0.1", resolve));
  originUrl = `http://127.0.0.1:${(origin.address() as AddressInfo).port}`;
  targets = Object.fromEntries(officialSourcePrefixes.map(prefix => [prefix, originUrl])) as unknown as OfficialSourceTargets;
});

afterAll(async () => {
  for (const res of hanging) res.destroy();
  origin.closeAllConnections();
  await new Promise<void>(resolve => origin.close(() => resolve()));
});

beforeEach(() => { hits.length = 0; counter = 0; });

function proxyWith(options: OfficialSourceProxyOptions = {}) {
  return createOfficialSourceProxy({ targets, rateLimit: 0, ...options });
}

function body(response: OfficialSourceResponse): string {
  return new TextDecoder().decode(response.body);
}

const get = (url: string, extra: { headers?: IncomingHttpHeaders; clientKey?: string } = {}) => ({ method: "GET", url, ...extra });

describe("destinos fijos", () => {
  it("son los mismos hosts que usaba el proxy de Vite", () => {
    expect(officialSourceTargets).toEqual({
      "/official-source": "https://www.campeonatochileno.cl",
      "/third-division-source": "https://anfaterceradivision.cl",
      "/argentina-cup-source": "https://www.copaargentina.org",
      "/brazil-cup-source": "https://www.cbf.com.br",
    });
  });

  it.each(officialSourcePrefixes)("reenvía %s a su destino conservando ruta y query", async prefix => {
    const response = await proxyWith().respond(get(`${prefix}/ok?j=3&zona=sur`));
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(body(response)).toBe("<p>/ok?j=3&zona=sur</p>");
    expect(hits.map(hit => hit.url)).toEqual(["/ok?j=3&zona=sur"]);
  });

  it("sólo devuelve Content-Type del origen (ninguna cookie del sitio llega al cliente)", async () => {
    const response = await proxyWith().respond(get("/official-source/ok"));
    expect(response.headers).toEqual({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-cancha-source-cache": "miss",
    });
  });

  it("reconoce sólo los cuatro prefijos", () => {
    const proxy = proxyWith();
    expect(proxy.matches("/official-source/ligas/")).toBe(true);
    expect(proxy.matches("/brazil-cup-source/x?y=1")).toBe(true);
    expect(proxy.matches("/official-sourcex/ligas/")).toBe(false);
    expect(proxy.matches("/graphql")).toBe(false);
  });

  it("un prefijo desconocido responde 404 sin consultar ningún origen", async () => {
    const response = await proxyWith().respond(get("/official-sourcex/ok"));
    expect(response.status).toBe(404);
    expect(body(response)).toBe(officialSourceMessages.unknownSource);
    expect(hits).toEqual([]);
  });
});

describe("rutas que intentan escapar del sitio", () => {
  it.each([
    "/official-source/../ok",
    "/official-source/a/../../ok",
    "/official-source/./ok",
    "/official-source/%2e%2e/ok",
    "/official-source/%2E%2E/ok",
    "/official-source/.%2e/ok",
    "/official-source/a%2fb",
    "/official-source/a%5cb",
    "/official-source/a%252e%252e/ok",
    "/official-source/a\\..\\ok",
    "/official-source//evil.example/ok",
    "/official-source/a@b",
    "/official-source/@evil.example/ok",
    "/official-source/a%00b",
    "/official-source/a\nb",
    "/official-source/ok#fragmento",
    "/official-source/%E0%A4%A",
    `/official-source/${"a".repeat(2100)}`,
  ])("rechaza %s con 400 sin tocar el origen", async url => {
    const response = await proxyWith().respond(get(url));
    expect(response.status).toBe(400);
    expect(body(response)).toBe(officialSourceMessages.invalidPath);
    expect(hits).toEqual([]);
  });
});

describe("método y cabeceras", () => {
  it.each(["POST", "PUT", "DELETE", "HEAD", "OPTIONS"])("%s responde 405", async method => {
    const response = await proxyWith().respond({ method, url: "/official-source/ok" });
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe("GET");
    expect(hits).toEqual([]);
  });

  it("no reenvía cookies, Authorization ni otras cabeceras del cliente", async () => {
    await proxyWith().respond(get("/brazil-cup-source/ok", { headers: {
      cookie: "cancha_refresh=secreto",
      authorization: "Bearer token",
      origin: "https://cancha.example",
      referer: "https://cancha.example/",
      "x-forwarded-for": "203.0.113.9",
      "x-custom": "valor",
      host: "evil.example",
    } }));
    const received = hits[0].headers;
    expect(received.cookie).toBeUndefined();
    expect(received.authorization).toBeUndefined();
    expect(received.origin).toBeUndefined();
    expect(received.referer).toBeUndefined();
    expect(received["x-forwarded-for"]).toBeUndefined();
    expect(received["x-custom"]).toBeUndefined();
    expect(received.host).toBe(new URL(originUrl).host);
    expect(received["user-agent"]).toBe("Cancha (importador de fuentes oficiales)");
  });

  it("reenvía RSC: 1 sólo hacia la CBF y la distingue en la caché", async () => {
    const proxy = proxyWith();
    await proxy.respond(get("/brazil-cup-source/ok", { headers: { rsc: "1" } }));
    await proxy.respond(get("/official-source/ok", { headers: { rsc: "1" } }));
    await proxy.respond(get("/brazil-cup-source/ok?otro", { headers: { rsc: "otro" } }));
    expect(hits.map(hit => hit.headers.rsc)).toEqual(["1", undefined, undefined]);
  });

  it("handle responde por un servidor HTTP real", async () => {
    const proxy = proxyWith();
    const server = createServer((req, res) => { void proxy.handle(req, res, { clientKey: req.socket.remoteAddress }); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const { status, headers, text } = await new Promise<{ status: number; headers: IncomingHttpHeaders; text: string }>((resolve, reject) => {
        const call = httpRequest({ host: "127.0.0.1", port, path: "/third-division-source/ok?j=1", headers: { cookie: "a=b" } }, res => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", chunk => { text += chunk; });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
        });
        call.on("error", reject);
        call.end();
      });
      expect(status).toBe(200);
      expect(text).toBe("<p>/ok?j=1</p>");
      expect(headers["set-cookie"]).toBeUndefined();
      expect(headers["x-cancha-source-cache"]).toBe("miss");
      expect(hits[0].headers.cookie).toBeUndefined();
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

describe("redirecciones", () => {
  it("sigue una redirección dentro del mismo sitio", async () => {
    const response = await proxyWith().respond(get("/official-source/redirect-same"));
    expect(response.status).toBe(200);
    expect(body(response)).toBe("<p>/ok?from=redirect</p>");
  });

  it.each(["/official-source/redirect-foreign", "/official-source/redirect-escape"])("%s hacia otro host responde 502", async url => {
    const response = await proxyWith().respond(get(url));
    expect(response.status).toBe(502);
    expect(body(response)).toBe(officialSourceMessages.foreignRedirect);
    expect(hits).toHaveLength(1);
  });

  it("corta tras tres redirecciones", async () => {
    const response = await proxyWith().respond(get("/official-source/redirect-loop"));
    expect(response.status).toBe(502);
    expect(body(response)).toBe(officialSourceMessages.tooManyRedirects);
    expect(hits).toHaveLength(4);
  });
});

describe("límites", () => {
  it("rechaza una respuesta cuyo Content-Length supera el máximo", async () => {
    const response = await proxyWith({ maxResponseBytes: 500 }).respond(get("/official-source/big-declared"));
    expect(response.status).toBe(502);
    expect(body(response)).toBe(officialSourceMessages.tooLarge);
  });

  it("corta una respuesta sin Content-Length al superar el máximo", async () => {
    const response = await proxyWith({ maxResponseBytes: 500 }).respond(get("/official-source/big-stream"));
    expect(response.status).toBe(502);
    expect(body(response)).toBe(officialSourceMessages.tooLarge);
  });

  it("admite una respuesta justo en el máximo", async () => {
    const response = await proxyWith({ maxResponseBytes: 1000 }).respond(get("/official-source/big-stream"));
    expect(response.status).toBe(200);
    expect(response.body.byteLength).toBe(1000);
  });

  it("responde 504 si el origen no contesta a tiempo", async () => {
    const response = await proxyWith({ timeoutMs: 150 }).respond(get("/official-source/slow"));
    expect(response.status).toBe(504);
    expect(body(response)).toBe(officialSourceMessages.timeout);
  });

  it("un origen inaccesible responde 502", async () => {
    const closed = createServer();
    await new Promise<void>(resolve => closed.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
    await new Promise<void>(resolve => closed.close(() => resolve()));
    const proxy = createOfficialSourceProxy({ targets: { ...targets, "/official-source": url }, rateLimit: 0 });
    const response = await proxy.respond(get("/official-source/ok"));
    expect(response.status).toBe(502);
    expect(body(response)).toBe(officialSourceMessages.unreachable);
  });

  it("un error del origen responde 502 en español", async () => {
    const response = await proxyWith().respond(get("/official-source/fail"));
    expect(response.status).toBe(502);
    expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(body(response)).toBe("La fuente oficial respondió con HTTP 500.");
  });
});

describe("caché", () => {
  it("guarda una respuesta correcta y la sirve sin consultar el origen", async () => {
    const proxy = proxyWith();
    const first = await proxy.respond(get("/official-source/count"));
    const second = await proxy.respond(get("/official-source/count"));
    expect(first.headers["x-cancha-source-cache"]).toBe("miss");
    expect(second.headers["x-cancha-source-cache"]).toBe("hit");
    expect(body(second)).toBe(body(first));
    expect(hits).toHaveLength(1);
  });

  it("distingue la query", async () => {
    const proxy = proxyWith();
    await proxy.respond(get("/third-division-source/count?j=1"));
    await proxy.respond(get("/third-division-source/count?j=2"));
    expect(hits).toHaveLength(2);
  });

  it("no guarda errores del origen", async () => {
    const proxy = proxyWith();
    await proxy.respond(get("/official-source/fail"));
    await proxy.respond(get("/official-source/fail"));
    expect(hits).toHaveLength(2);
  });

  it("vence según el TTL", async () => {
    let clock = 1_000;
    const proxy = proxyWith({ cacheTtlMs: 10_000, now: () => clock });
    await proxy.respond(get("/official-source/count"));
    clock += 9_999;
    expect((await proxy.respond(get("/official-source/count"))).headers["x-cancha-source-cache"]).toBe("hit");
    clock += 1;
    expect((await proxy.respond(get("/official-source/count"))).headers["x-cancha-source-cache"]).toBe("miss");
    expect(hits).toHaveLength(2);
  });

  it("con TTL 0 no guarda nada", async () => {
    const proxy = proxyWith({ cacheTtlMs: 0 });
    await proxy.respond(get("/official-source/count"));
    await proxy.respond(get("/official-source/count"));
    expect(hits).toHaveLength(2);
  });

  it("expulsa la entrada menos usada al llegar al límite de entradas", async () => {
    const proxy = proxyWith({ cacheMaxEntries: 2 });
    await proxy.respond(get("/official-source/count?a"));
    await proxy.respond(get("/official-source/count?b"));
    await proxy.respond(get("/official-source/count?a"));
    await proxy.respond(get("/official-source/count?c"));
    expect(hits).toHaveLength(3);
    expect((await proxy.respond(get("/official-source/count?a"))).headers["x-cancha-source-cache"]).toBe("hit");
    expect((await proxy.respond(get("/official-source/count?b"))).headers["x-cancha-source-cache"]).toBe("miss");
  });

  it("expulsa por bytes y no guarda una respuesta mayor que el límite", async () => {
    const proxy = proxyWith({ cacheMaxBytes: 10 });
    await proxy.respond(get("/official-source/six?a"));
    await proxy.respond(get("/official-source/six?b"));
    expect((await proxy.respond(get("/official-source/six?a"))).headers["x-cancha-source-cache"]).toBe("miss");
    const big = proxyWith({ cacheMaxBytes: 5 });
    await big.respond(get("/official-source/six?a"));
    expect((await big.respond(get("/official-source/six?a"))).headers["x-cancha-source-cache"]).toBe("miss");
  });

  it("comparte una sola descarga entre consultas simultáneas", async () => {
    const proxy = proxyWith();
    const [first, second] = await Promise.all([
      proxy.respond(get("/official-source/slow-count")),
      proxy.respond(get("/official-source/slow-count")),
    ]);
    expect(body(first)).toBe("n=1");
    expect(body(second)).toBe("n=1");
    expect(hits).toHaveLength(1);
  });
});

describe("rate limit por cliente", () => {
  it("responde 429 con Retry-After al exceder el límite y no afecta a otro cliente", async () => {
    let clock = 0;
    const proxy = proxyWith({ rateLimit: 2, rateWindowMs: 60_000, now: () => clock });
    const call = (clientKey: string) => proxy.respond(get("/official-source/count", { clientKey }));
    expect((await call("198.51.100.7")).status).toBe(200);
    expect((await call("198.51.100.7")).status).toBe(200);
    const limited = await call("198.51.100.7");
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    expect(body(limited)).toBe(officialSourceMessages.rateLimited);
    expect((await call("198.51.100.8")).status).toBe(200);
    clock += 60_000;
    expect((await call("198.51.100.7")).status).toBe(200);
  });

  it("cuenta también los aciertos de caché", async () => {
    const proxy = proxyWith({ rateLimit: 1 });
    expect((await proxy.respond(get("/official-source/count", { clientKey: "a" }))).status).toBe(200);
    expect((await proxy.respond(get("/official-source/count", { clientKey: "a" }))).status).toBe(429);
    expect(hits).toHaveLength(1);
  });

  it("sin clave de cliente no limita", async () => {
    const proxy = proxyWith({ rateLimit: 1 });
    for (let index = 0; index < 3; index += 1) expect((await proxy.respond(get("/official-source/count"))).status).toBe(200);
  });
});
