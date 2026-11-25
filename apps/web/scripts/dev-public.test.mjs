import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFile, access } from "node:fs/promises";
import { createServer as createHttpServer, get as httpGet } from "node:http";
import { startPublicDevelopment, waitForHttp, stopTunnel, httpDiagnostic, coreFsPrefix } from "./dev-public.mjs";

const sessions = [];
afterEach(async () => { for (const s of sessions.splice(0)) await s.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });
function child() {
  const c = new EventEmitter(); c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.exitCode = null; c.signalCode = null;
  c.kill = vi.fn(signal => { c.signalCode = signal; c.emit("exit", null, signal); return true; }); return c;
}
function fixture(overrides = {}) {
  const signals = new EventEmitter(), tunnel = child(), httpServer = new EventEmitter();
  httpServer.address = () => ({ address: "127.0.0.1", port: 5199 });
  const server = { httpServer, listen: vi.fn(), close: vi.fn(async () => { httpServer.emit("close"); }) };
  const options = { checkClient: vi.fn(async () => {}), createViteServer: vi.fn(async () => server),
    spawnProcess: vi.fn(() => tunnel), checkHttp: vi.fn(async () => {}), signals,
    logger: { log: vi.fn(), error: vi.fn() }, ...overrides };
  return { options, server, signals, tunnel, async start() { const s = await startPublicDevelopment(options); sessions.push(s); return s; } };
}
const announce = (c, url = "https://test-session.trycloudflare.com") => c.stderr.write(`INF | ${url} |\n`);

describe("temporary public development lifecycle", () => {
  it("waits for the actual Vite port, uses a native client and only announces a checked URL", async () => {
    let finish; const pending = new Promise(resolve => { finish = resolve; });
    const f = fixture({ checkHttp: vi.fn(url => url.startsWith("https:") ? pending : Promise.resolve()) });
    const s = await f.start();
    expect(f.options.checkHttp.mock.calls[0][0]).toBe("http://127.0.0.1:5199");
    expect(f.options.spawnProcess.mock.calls[0][1]).toContain("http://127.0.0.1:5199");
    expect(f.options.spawnProcess.mock.calls[0][2]).toMatchObject({ shell: false, windowsHide: true });
    expect(f.options.logger.log.mock.calls.flat().join(" ")).not.toContain("URL PÚBLICA LISTA");
    f.tunnel.stderr.write("INF | https://test-session.trycloud"); f.tunnel.stderr.write("flare.com |\n");
    await Promise.resolve();
    expect(f.options.logger.log.mock.calls.flat().join(" ")).not.toContain("URL PÚBLICA LISTA");
    finish(); expect(await s.ready).toBe("https://test-session.trycloudflare.com");
    expect(f.options.logger.log.mock.calls.flat().join(" ")).toContain("URL PÚBLICA LISTA PARA COMPARTIR");
    expect(f.options.createViteServer.mock.calls[0][0]).toMatchObject({ envDir: false, envPrefix: [], publicDir: false,
      server: { host: "127.0.0.1", allowedHosts: [".trycloudflare.com"] } });
  });
  it("does not install the client, start Vite or invent a URL if the client check fails", async () => {
    const f = fixture({ checkClient: async () => { throw new Error("No se encontró cloudflared"); } });
    await expect(f.start()).rejects.toThrow("No se encontró cloudflared");
    expect(f.options.createViteServer).not.toHaveBeenCalled(); expect(f.options.spawnProcess).not.toHaveBeenCalled();
    expect(f.signals.listenerCount("SIGINT")).toBe(0);
  });
  it("closes Vite after a listen error without starting Cloudflare", async () => {
    const f = fixture(); f.server.listen.mockRejectedValue(new Error("Puerto no disponible"));
    await expect(f.start()).rejects.toThrow("Puerto no disponible");
    expect(f.server.close).toHaveBeenCalledOnce(); expect(f.options.spawnProcess).not.toHaveBeenCalled();
  });
  it("closes Vite if its local readiness check fails", async () => {
    const f = fixture({ checkHttp: async () => { throw new Error("Vite no responde"); } });
    await expect(f.start()).rejects.toThrow("Vite no responde"); expect(f.server.close).toHaveBeenCalledOnce();
  });
  it.each(["SIGINT", "SIGTERM", "SIGHUP"])("closes both resources once on %s and removes handlers", async signal => {
    const f = fixture(); const s = await f.start(); f.signals.emit(signal); f.signals.emit(signal);
    expect(await s.done).toBe(0); expect(f.server.close).toHaveBeenCalledOnce(); expect(f.tunnel.kill).toHaveBeenCalledOnce();
    expect(f.signals.listenerCount(signal)).toBe(0);
  });
  it("stops the tunnel if Vite closes unexpectedly", async () => {
    const f = fixture(); const s = await f.start(); f.server.httpServer.emit("close");
    expect(await s.done).toBe(1); expect(f.tunnel.kill).toHaveBeenCalledOnce();
  });
  it.each(["error", "exit"])("closes the server after a cloudflared %s", async event => {
    const f = fixture(); const s = await f.start();
    if (event === "exit") { f.tunnel.exitCode = 1; f.tunnel.emit("exit", 1, null); }
    else f.tunnel.emit("error", new Error("ENOENT"));
    expect(await s.done).toBe(1); expect(f.server.close).toHaveBeenCalledOnce();
  });
  it("rejects non-Cloudflare log URLs and closes after the generation deadline", async () => {
    const f = fixture({ urlTimeoutMs: 15 }); const s = await f.start(); announce(f.tunnel, "https://trycloudflare.com.example.org");
    await expect(s.ready).rejects.toThrow("Cloudflare no generó"); expect(await s.done).toBe(1);
    expect(f.options.checkHttp).toHaveBeenCalledTimes(1);
  });
  it("does not claim public availability when HTTPS cannot reach this server", async () => {
    const f = fixture({ checkHttp: async url => { if (url.startsWith("https:")) throw new Error("Conexión bloqueada"); } });
    const s = await f.start(); announce(f.tunnel); await expect(s.ready).rejects.toThrow("Conexión bloqueada");
    expect(f.server.close).not.toHaveBeenCalled(); expect(f.tunnel.kill).not.toHaveBeenCalled();
    expect(f.options.logger.log.mock.calls.flat().join(" ")).toContain("siguen activos");
    expect(f.options.logger.log.mock.calls.flat().join(" ")).not.toContain("URL PÚBLICA LISTA");
    f.signals.emit("SIGINT"); expect(await s.done).toBe(0);
  });
  it("isolates existing Cloudflare credentials/configuration and removes its temporary config", async () => {
    vi.stubEnv("TUNNEL_TOKEN", "test-secret-never-used");
    const f = fixture(); const s = await f.start(); const [, args, options] = f.options.spawnProcess.mock.calls[0];
    const file = args[args.indexOf("--config") + 1]; expect(await readFile(file, "utf8")).toBe("{}\n");
    expect(options.env.TUNNEL_TOKEN).toBeUndefined(); await s.close(); await expect(access(file)).rejects.toThrow();
  });
  it("handles cancellation while Vite is still being created", async () => {
    const f = fixture(); let finish; f.options.createViteServer = () => new Promise(resolve => { finish = resolve; });
    const pending = f.start(); await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    f.signals.emit("SIGINT"); finish(f.server); const s = await pending;
    expect(await s.done).toBe(0); expect(f.server.close).toHaveBeenCalledOnce(); expect(f.options.spawnProcess).not.toHaveBeenCalled();
  });
});

it("forces termination if the native child ignores a graceful stop", async () => {
  vi.useFakeTimers(); const c = child(); c.kill.mockImplementation(signal => {
    if (signal === "SIGKILL") { c.signalCode = signal; c.emit("exit", null, signal); }
    return true;
  });
  const stopped = stopTunnel(c); await vi.advanceTimersByTimeAsync(3001); await stopped;
  expect(c.kill.mock.calls.map(call => call[0])).toEqual(["SIGTERM", "SIGKILL"]);
});

it("does not accept an unrelated HTTP 200 as readiness", async () => {
  const abort = new AbortController(); const fetcher = vi.fn(async () => new Response("unrelated server"));
  await expect(waitForHttp("http://127.0.0.1:1234", { signal: abort.signal, marker: "expected", timeoutMs: 10, fetcher })).rejects.toThrow("No respondió Cancha");
});

it("serves the real application on a free port and denies other hosts and project files", async () => {
  vi.stubEnv("VITE_CANCHA_PRIVATE_PROBE", "test-only-not-public");
  const occupied = createHttpServer(); await new Promise(resolve => occupied.listen(0, "127.0.0.1", resolve));
  const port = occupied.address().port;
  let server;
  const f = fixture({ createViteServer: async options => {
    const { createServer } = await import("vite");
    server = await createServer({ ...options, logLevel: "silent", server: { ...options.server, port } }); return server;
  }, checkHttp: waitForHttp });
  let s;
  try {
    s = await f.start(); const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    expect(server.httpServer.address().port).not.toBe(port);
    expect(server.config.env.VITE_CANCHA_PRIVATE_PROBE).toBeUndefined();
    // /graphql existe en la configuración de Vite (fase 5D), pero el acceso temporal no lo expone: la lista de abajo lo exige 403.
    // Las fuentes oficiales ya no son proxies de Vite: las sirve el plugin con @cancha/official-source-proxy (fase 6).
    expect(Object.keys(server.config.server.proxy)).toEqual(["/graphql"]);
    expect(server.config.plugins.map(plugin => plugin.name)).toContain("cancha-official-sources");
    const sourcePost = await fetch(base + "/official-source/ligas/", { method: "POST" });
    expect(sourcePost.status).toBe(405);
    expect(await sourcePost.text()).toBe("Las fuentes oficiales sólo admiten consultas GET.");
    expect((await fetch(base)).status).toBe(200);
    const statusForHost = host => new Promise((resolve, reject) => {
      httpGet(base, { headers: { Host: host } }, response => { response.resume(); resolve(response.statusCode); }).on("error", reject);
    });
    expect(server.config.server.allowedHosts).toContain(".trycloudflare.com");
    expect(await statusForHost("unrelated.example.org")).toBe(403);
    expect(await statusForHost("generated.trycloudflare.com")).toBe(200);
    for (const path of ["/.env", "/package.json", "/README.md", "/docs/source-incidents.md", "/scripts/dev-public.mjs", "/@fs/C:/Windows/win.ini", "/graphql", "/src/test-utils/fixtures/live/anfa-pending.json", coreFsPrefix + "domain/services/second-division-test-fixtures.ts", coreFsPrefix + "test-utils/season-closure-fixtures.ts"]) {
      expect((await fetch(base + path)).status, path).toBe(403);
    }
    const queue = [base + "/src/main.tsx"], visited = new Set();
    while (queue.length) {
      const url = queue.shift(); if (visited.has(url)) continue; visited.add(url);
      expect(visited.size).toBeLessThan(250);
      const response = await fetch(url); expect(response.status, url).toBe(200);
      const code = await response.text();
      for (const match of code.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)["']([^"']+)["']/g)) {
        if (!/^(?:\/|\.\.?\/)/.test(match[1])) continue;
        if (!/\.(?:[cm]?[jt]sx?|css)(?:\?|$)/.test(match[1]) && !match[1].startsWith("/@")) continue;
        const dependency = new URL(match[1], url);
        if (dependency.origin === base && !visited.has(dependency.href)) queue.push(dependency.href);
      }
    }
    expect(visited.size).toBeGreaterThan(60);
    expect((await fetch(base + "/@vite/client")).status).toBe(200);
  } finally { await s?.close(); if (!s) await server?.close(); await new Promise(resolve => occupied.close(resolve)); }
}, 20000);

it("reports a native child that cannot be terminated instead of assuming it closed", async () => {
  vi.useFakeTimers(); const c = child(); c.kill.mockImplementation(() => false);
  const stopped = expect(stopTunnel(c)).rejects.toThrow("no confirmó su cierre");
  await vi.advanceTimersByTimeAsync(5001); await stopped;
});
it("does not print a successful shutdown when Vite reports a close failure", async () => {
  const f = fixture(); const s = await f.start(); f.server.close.mockRejectedValue(new Error("Error de cierre"));
  await s.close(); expect(await s.done).toBe(1);
  expect(f.tunnel.kill).toHaveBeenCalledOnce();
  expect(f.options.logger.log.mock.calls.flat().join(" ")).not.toContain("Vite y cloudflared cerrados");
  expect(f.options.logger.error.mock.calls.flat().join(" ")).toContain("Cierre incompleto");
});

const probeUrl = "https://probe.trycloudflare.com";
const probeOptions = () => ({ signal: new AbortController().signal, marker: "test-marker", timeoutMs: 100, retryMs: 1 });
const validResponse = () => new Response("Cancha", { headers: { "X-Cancha-Dev": "test-marker" } });
it("accepts a verified HTTPS response without disabling TLS", async () => {
  const fetcher = vi.fn(async () => validResponse());
  await waitForHttp(probeUrl, { ...probeOptions(), fetcher });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][1]).toEqual({ signal: expect.any(AbortSignal), redirect: "manual" });
});
it("recovers from a temporary DNS failure", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed", { cause: { code: "EAI_AGAIN" } })).mockImplementation(async () => validResponse());
  const onAttempt = vi.fn();
  await waitForHttp(probeUrl, { ...probeOptions(), fetcher, onAttempt });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(onAttempt).toHaveBeenCalledWith({ attempts: 1, diagnostic: expect.stringContaining("DNS:") });
});
it("bounds stalled requests and reports timeout", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn((url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const timeoutSignal = ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
    return controller.signal;
  };
  const pending = waitForHttp(probeUrl, { ...probeOptions(), timeoutMs: 50, requestTimeoutMs: 10, retryMs: 1, fetcher, timeoutSignal, now: vi.now });
  const outcome = pending.then(() => undefined, error => error);
  await vi.advanceTimersByTimeAsync(50);
  expect(await outcome).toMatchObject({ message: expect.stringContaining("timeout:") });
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(fetcher.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
});
it.each([302, 403, 502, 503])("reports invalid HTTP %s", async status => {
  const fetcher = async () => new Response(null, { status });
  await expect(waitForHttp(probeUrl, { ...probeOptions(), timeoutMs: 10, fetcher })).rejects.toThrow("HTTP " + status);
});
it.each([["ENOTFOUND", "DNS:"], ["CERT_HAS_EXPIRED", "TLS:"], ["ECONNREFUSED", "conexión:"], ["ETIMEDOUT", "timeout:"]])("diagnoses %s", (code, category) => {
  expect(httpDiagnostic(new TypeError("fetch failed", { cause: { code } }))).toContain(category);
});
it("cancels a pending HTTPS check with Ctrl+C", async () => {
  let signal;
  const f = fixture({ checkHttp: async (url, options) => {
    if (!url.startsWith("https:")) return;
    signal = options.signal;
    await new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  } });
  const s = await f.start(); announce(f.tunnel);
  expect(signal.aborted).toBe(false); f.signals.emit("SIGINT");
  expect(await s.done).toBe(0); expect(signal.aborted).toBe(true);
  expect(f.server.close).toHaveBeenCalledOnce(); expect(f.tunnel.kill).toHaveBeenCalledOnce();
});
