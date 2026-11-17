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

// @cancha/core se lee desde src/ con la condición "source": la web no necesita
// el build de core (dist/ es sólo para Node/apps/api).
export const coreSourceResolve = {
  resolve: { conditions: ["source", ...defaultClientConditions] },
  ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
};

export default defineConfig({
  ...coreSourceResolve,
  plugins: [react()],
  server: { host: "127.0.0.1", proxy: officialSourceProxy },
  preview: { host: "127.0.0.1", proxy: officialSourceProxy },
});
