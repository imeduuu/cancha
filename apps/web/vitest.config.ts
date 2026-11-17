import { defineConfig } from "vitest/config";
import { coreSourceResolve } from "./vite.config";

export default defineConfig({
  ...coreSourceResolve,
  test: {
    environment: "node",
  },
});
