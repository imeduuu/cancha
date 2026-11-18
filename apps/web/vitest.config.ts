import { defineConfig } from "vitest/config";
import { coreSourceResolve } from "./vite.config";

export default defineConfig({
  ...coreSourceResolve,
  test: {
    environment: "node",
    // Los recorridos de App con jsdom duran varios segundos con la suite completa y la máquina cargada
    // (carga diferida de paneles); el límite de 5 s producía timeouts intermitentes.
    // Ver docs/vitest-stability-audit.md.
    testTimeout: 15_000,
    // Lo usan npm test y test:flows (ambos leen esta configuración).
    setupFiles: ["./src/test-utils/setup-jest-dom.ts"],
  },
});
