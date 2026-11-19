import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defaultClientConditions, defaultServerConditions, defineConfig, runnerImport, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import type { OfficialSourceProxy } from "@cancha/official-source-proxy";

// La API (apps/api) detrás del mismo origen, como hará el rewrite de Vercel en
// producción: la cookie `cancha_refresh` (Path=/graphql) y el access token viajan
// sin CORS de por medio. Sin rewrite: la API sirve en /graphql. Sólo se usa con
// sesión; sin sesión la web no hace ninguna petición a /graphql.
const proxy = {
  "/graphql": {
    target: process.env.CANCHA_API_URL ?? "http://127.0.0.1:3000",
    changeOrigin: false,
    secure: true,
  },
};

// @cancha/core se lee desde src/ con la condición "source": la web no necesita
// el build de core (dist/ es sólo para Node/apps/api).
export const coreSourceResolve = {
  resolve: { conditions: ["source", ...defaultClientConditions] },
  ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
};

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * Fuentes oficiales sin CORS (/official-source, /third-division-source,
 * /argentina-cup-source, /brazil-cup-source) en `dev` y `preview`, con el MISMO
 * proxy cerrado que sirve la API en producción (@cancha/official-source-proxy):
 * una sola política y el modo sin sesión importa con sólo `npm run dev`, sin la
 * API ni MongoDB. El cargador de configuración de Vite no aplica la condición
 * "source", así que el módulo se carga con `runnerImport` (sin build previo).
 * Rate limit por IP de la conexión: a través de dev:public todo llega desde
 * 127.0.0.1 y el límite es compartido. Ver docs/official-source-proxy.md.
 */
export function officialSourcesPlugin(): Plugin {
  let loaded: Promise<OfficialSourceProxy> | undefined;
  const load = () => loaded ??= runnerImport<typeof import("@cancha/official-source-proxy")>("@cancha/official-source-proxy", {
    configFile: false,
    root,
    logLevel: "silent",
    environments: { inline: { resolve: { conditions: ["source", ...defaultServerConditions] } } },
  }).then(({ module }) => module.createOfficialSourceProxy());

  const install = async (middlewares: { use(handler: (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void): void }) => {
    const sources = await load();
    middlewares.use((req, res, next) => {
      if (!req.url || !sources.matches(req.url)) { next(); return; }
      sources.handle(req, res, { clientKey: req.socket.remoteAddress }).catch(next);
    });
  };

  return {
    name: "cancha-official-sources",
    configureServer: server => install(server.middlewares),
    configurePreviewServer: server => install(server.middlewares),
  };
}

export default defineConfig({
  ...coreSourceResolve,
  plugins: [officialSourcesPlugin(), react()],
  server: { host: "127.0.0.1", proxy },
  preview: { host: "127.0.0.1", proxy },
});
