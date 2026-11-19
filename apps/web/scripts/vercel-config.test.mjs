import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { officialSourcePrefixes } from "@cancha/official-source-proxy";

// apps/web/vercel.json (fase 8C, docs/deployment.md): la web en Vercel reenvía a
// la API /graphql y las rutas del proxy de fuentes oficiales (mismo origen para la
// cookie y sin CORS para los importadores) y sirve index.html para el resto (SPA).
const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const apiRewrites = config.rewrites.slice(0, -1);
const apiOrigins = new Set(apiRewrites.map(rewrite => new URL(rewrite.destination).origin));

describe("vercel.json", () => {
  it("instala desde la raíz del monorepo sólo el workspace de la web y construye en apps/web", () => {
    expect(config.installCommand).toBe("cd ../.. && npm ci -w @cancha/web");
    expect(config.buildCommand).toBe("npm run build");
    expect(config.outputDirectory).toBe("dist");
  });

  it("reenvía /graphql y cada prefijo del proxy de fuentes oficiales a una sola API", () => {
    const expected = [
      { source: "/graphql", path: "/graphql" },
      ...officialSourcePrefixes.map(prefix => ({ source: `${prefix}/:path*`, path: `${prefix}/:path*` })),
    ];
    expect(apiRewrites.map(rewrite => rewrite.source)).toEqual(expected.map(entry => entry.source));
    for (const [index, rewrite] of apiRewrites.entries()) {
      const destination = new URL(rewrite.destination);
      expect(destination.protocol).toBe("https:");
      expect(destination.pathname).toBe(expected[index].path);
      expect(destination.search + destination.hash).toBe("");
    }
    expect(apiOrigins.size).toBe(1);
  });

  it("deja el fallback de la SPA al final (Vercel aplica la primera regla que coincide)", () => {
    expect(config.rewrites.at(-1)).toEqual({ source: "/(.*)", destination: "/index.html" });
  });

  it("el marcador de la URL de la API es evidente hasta que se reemplaza", () => {
    const [origin] = apiOrigins;
    // Si ya se reemplazó, debe ser una URL https real (no localhost).
    if (origin.includes("REEMPLAZAR")) expect(origin).toBe("https://reemplazar-url-de-la-api.onrender.com");
    else expect(new URL(origin).hostname).not.toMatch(/^(localhost|127\.0\.0\.1)$/);
  });
});
