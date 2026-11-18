import { defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// Las pruebas leen @cancha/core desde src/ (condición "source"), igual que la web:
// no necesitan el build de core. El build de la API (nest build) sí usa dist/.
const conditions = ["source", ...defaultServerConditions];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    environment: "node",
    // Un solo replica set de MongoDB en memoria para toda la corrida (ver el archivo).
    // La primera corrida descarga ahí el binario de mongod (~80 MB).
    globalSetup: ["./src/test-utils/mongo-global-setup.ts"],
  },
});
