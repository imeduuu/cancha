import { defaultClientConditions, defaultServerConditions, defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const officialSourceProxy = {
  "/official-source": {
    target: "https://www.campeonatochileno.cl",
    changeOrigin: true,
    secure: true,
    rewrite: (path: string) => path.replace(/^\/official-source/, ""),
  },
  "/third-division-source": {
    target: "https://anfaterceradivision.cl",
    changeOrigin: true,
    secure: true,
    rewrite: (path: string) => path.replace(/^\/third-division-source/, ""),
  },
  "/argentina-cup-source": {
    target: "https://www.copaargentina.org",
    changeOrigin: true,
    secure: true,
    rewrite: (path: string) => path.replace(/^\/argentina-cup-source/, ""),
  },
  "/brazil-cup-source": {
    target: "https://www.cbf.com.br",
    changeOrigin: true,
    secure: true,
    rewrite: (path: string) => path.replace(/^\/brazil-cup-source/, ""),
  },
};

// La API (apps/api) detrás del mismo origen, como hará el rewrite de Vercel en
// producción: la cookie `cancha_refresh` (Path=/graphql) y el access token viajan
// sin CORS de por medio. Sin rewrite: la API sirve en /graphql. Sólo se usa con
// sesión; sin sesión la web no hace ninguna petición a /graphql.
const apiProxy = {
  "/graphql": {
    target: process.env.CANCHA_API_URL ?? "http://127.0.0.1:3000",
    changeOrigin: false,
    secure: true,
  },
};

const proxy = { ...officialSourceProxy, ...apiProxy };

// @cancha/core se lee desde src/ con la condición "source": la web no necesita
// el build de core (dist/ es sólo para Node/apps/api).
export const coreSourceResolve = {
  resolve: { conditions: ["source", ...defaultClientConditions] },
  ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
};

export default defineConfig({
  ...coreSourceResolve,
  plugins: [react()],
  server: { host: "127.0.0.1", proxy },
  preview: { host: "127.0.0.1", proxy },
});
