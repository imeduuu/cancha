import { defineConfig } from "vite";
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

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", proxy: officialSourceProxy },
  preview: { host: "127.0.0.1", proxy: officialSourceProxy },
});
