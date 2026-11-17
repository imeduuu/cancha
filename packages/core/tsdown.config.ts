import { defineConfig } from "tsdown";

// Compila core para Node (apps/api): un .js ESM + .d.ts por módulo, misma
// estructura que src/, para que el mapa "./*" de exports apunte a dist/*.js.
// Vite/Vitest y la web siguen leyendo src/ mediante la condición "source".
export default defineConfig({
  entry: ["src/**/*.ts", "!src/**/*.test.ts", "!src/test-utils/**"],
  format: "esm",
  platform: "neutral",
  target: "es2022",
  unbundle: true,
  dts: true,
  outDir: "dist",
  clean: true,
  // El mapa de exports se mantiene a mano (condición "source").
  exports: false,
});
