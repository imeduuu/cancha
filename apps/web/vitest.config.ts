import { defineConfig } from "vitest/config";
import { coreSourceResolve } from "./vite.config";

export default defineConfig({
  ...coreSourceResolve,
  test: {
    environment: "node",
    // Lo usan npm test y test:flows (ambos leen esta configuración).
    setupFiles: ["./src/test-utils/setup-jest-dom.ts"],
  },
});
