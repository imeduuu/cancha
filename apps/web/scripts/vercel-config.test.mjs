import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { convertRewrites } from "@vercel/routing-utils";
import { officialSourcePrefixes } from "@cancha/official-source-proxy";

// apps/web/vercel.json (fase 8C, docs/deployment.md): la web en Vercel reenvía a
// la API /graphql y las rutas del proxy de fuentes oficiales (mismo origen para la
// cookie y sin CORS para los importadores) y sirve index.html para el resto (SPA).
const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const apiRewrites = config.rewrites.slice(0, -1);
const apiOrigins = new Set(apiRewrites.map(rewrite => new URL(rewrite.destination).origin));
const [apiOrigin] = apiOrigins;

// Simula el enrutamiento de Vercel: @vercel/routing-utils es la librería con la que
// Vercel compila `rewrites` a expresiones regulares (`src`/`dest` con $1…). Gana la
// primera regla que coincide con la ruta (sin la query), y la query original pasa al
// destino: se comprobó en producción (una query nueva llega a la API como "miss").
const routes = convertRewrites(config.rewrites);
function route(url) {
  const [pathname, query] = url.split(/\?(.*)/s);
  for (const { src, dest } of routes) {
    const match = new RegExp(src).exec(pathname);
    if (!match) continue;
    const destination = dest.replace(/\$(\d+)/g, (_, group) => match[Number(group)] ?? "");
    return query === undefined ? destination : `${destination}?${query}`;
  }
  return undefined;
}

describe("vercel.json", () => {
  it("instala desde la raíz del monorepo sólo el workspace de la web y construye en apps/web", () => {
    expect(config.installCommand).toBe("cd ../.. && npm ci -w @cancha/web");
    expect(config.buildCommand).toBe("npm run build");
    expect(config.outputDirectory).toBe("dist");
  });

  it("reenvía /graphql y cada prefijo del proxy de fuentes oficiales a una sola API https", () => {
    expect(apiRewrites).toHaveLength(1 + officialSourcePrefixes.length);
    expect(apiOrigins.size).toBe(1);
    expect(new URL(apiOrigin).protocol).toBe("https:");
    expect(route("/graphql")).toBe(`${apiOrigin}/graphql`);
    expect(route("/graphql/")).toBe(`${apiOrigin}/graphql`);
  });

  describe.each(officialSourcePrefixes)("%s", prefix => {
    it.each([
      ["/ligas/liga-de-primera-mercado-libre", "subruta sin barra final"],
      ["/ligas/liga-de-primera-mercado-libre/", "subruta con barra final"],
      ["/competition/campeonato-de-ascenso-caixun-2026/", "otra subruta con barra final"],
      ["/assets/php/calendario_ta.php?j=3&x=1", "subruta con query"],
      ["/ligas/a/?j=3", "barra final y query"],
      ["/", "raíz del prefijo con barra"],
      ["", "prefijo sin barra"],
      ["?j=1", "prefijo sin barra con query"],
    ])("%s (%s) llega a la API con la misma ruta y la misma query", path => {
      expect(route(`${prefix}${path}`)).toBe(`${apiOrigin}${prefix}${path}`);
    });

    it("una ruta que sólo empieza como el prefijo queda en la SPA", () => {
      expect(route(`${prefix}x/ok`)).toBe("/index.html");
      expect(route(`${prefix}x`)).toBe("/index.html");
    });
  });

  it("deja el fallback de la SPA al final (Vercel aplica la primera regla que coincide)", () => {
    expect(config.rewrites.at(-1)).toEqual({ source: "/(.*)", destination: "/index.html" });
    expect(route("/")).toBe("/index.html");
    expect(route("/torneos/abc/")).toBe("/index.html");
    expect(route("/graphqlx")).toBe("/index.html");
  });

  it("el marcador de la URL de la API es evidente hasta que se reemplaza", () => {
    // Si ya se reemplazó, debe ser una URL https real (no localhost).
    if (apiOrigin.includes("REEMPLAZAR")) expect(apiOrigin).toBe("https://reemplazar-url-de-la-api.onrender.com");
    else expect(new URL(apiOrigin).hostname).not.toMatch(/^(localhost|127\.0\.0\.1)$/);
  });
});
