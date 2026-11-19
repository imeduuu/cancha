import { defineConfig } from "tsdown";

// Compila el proxy para Node (apps/api usa dist/). Vite y verify:live leen src/
// mediante la condición "source", como con @cancha/core.
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  target: "es2022",
  dts: true,
  outDir: "dist",
  clean: true,
  exports: false,
});
