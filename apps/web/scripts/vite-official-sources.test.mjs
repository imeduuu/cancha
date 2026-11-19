import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// El plugin de vite.config.ts sirve las fuentes oficiales con @cancha/official-source-proxy
// en dev y preview (fase 6B). Sin red: sólo casos que el proxy resuelve antes de consultar
// el origen. La política completa se prueba en packages/official-source-proxy.
const root = fileURLToPath(new URL("../", import.meta.url));
let close;

afterEach(async () => { await close?.(); close = undefined; });

/** GET con la ruta tal cual: fetch (y http.get con una URL) normalizan `%2e%2e` y `//`. */
const rawGet = (base, path) => new Promise((resolve, reject) => {
  const { hostname, port } = new URL(base);
  httpGet({ host: hostname, port, path }, response => {
    let text = "";
    response.setEncoding("utf8");
    response.on("data", chunk => { text += chunk; });
    response.on("end", () => resolve({ status: response.statusCode, text }));
  }).on("error", reject);
});

async function checkSources(base) {
  const post = await fetch(`${base}/official-source/ligas/`, { method: "POST" });
  expect(post.status).toBe(405);
  expect(post.headers.get("allow")).toBe("GET");
  expect(await post.text()).toBe("Las fuentes oficiales sólo admiten consultas GET.");

  const escape = await rawGet(base, "/third-division-source/%2e%2e/secreto");
  expect(escape).toEqual({ status: 400, text: "Ruta de fuente oficial no válida." });

  const foreign = await rawGet(base, "/brazil-cup-source//evil.example/x");
  expect(foreign.status).toBe(400);

  // Un prefijo parecido no es una fuente: sigue su camino normal en Vite.
  const lookalike = await fetch(`${base}/official-sourcex/ligas/`);
  expect(await lookalike.text()).not.toContain("fuente oficial");
}

describe("plugin de fuentes oficiales de Vite", () => {
  it("responde en el servidor de desarrollo sin la API", async () => {
    const { createServer } = await import("vite");
    const server = await createServer({ root, logLevel: "silent", server: { port: 0, host: "127.0.0.1", hmr: false, ws: false } });
    close = () => server.close();
    await server.listen();
    expect(Object.keys(server.config.server.proxy)).toEqual(["/graphql"]);
    await checkSources(`http://127.0.0.1:${server.httpServer.address().port}`);
  });

  it("responde en vite preview", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "cancha-preview-"));
    await writeFile(join(outDir, "index.html"), "<!doctype html><title>Cancha</title>");
    const { preview } = await import("vite");
    const server = await preview({ root, logLevel: "silent", build: { outDir }, preview: { port: 0, host: "127.0.0.1" } });
    close = async () => { await server.close(); await rm(outDir, { recursive: true, force: true }); };
    await checkSources(`http://127.0.0.1:${server.httpServer.address().port}`);
  });
});
