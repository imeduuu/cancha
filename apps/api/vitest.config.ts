import { fileURLToPath } from "node:url";
import { defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// Las pruebas leen @cancha/core desde src/ (condición "source"), igual que la web:
// no necesitan el build de core. El build de la API (nest build) sí usa dist/.
const conditions = ["source", ...defaultServerConditions];

// graphql 16 no declara "exports": Vite elegiría su "module" (index.mjs) para el
// código de la API, mientras Node carga index.js (CJS) para @nestjs/graphql y
// @apollo/server. Dos instancias de graphql rompen los instanceof (escalares,
// GraphQLError), así que en las pruebas se usa la misma entrada que en Node.
const graphqlEntry = fileURLToPath(import.meta.resolve("graphql"));

export default defineConfig({
  resolve: { conditions, alias: [{ find: /^graphql$/, replacement: graphqlEntry }] },
  ssr: { resolve: { conditions } },
  test: {
    environment: "node",
    // Un solo replica set de MongoDB en memoria para toda la corrida (ver el archivo).
    // La primera corrida descarga ahí el binario de mongod (~80 MB).
    globalSetup: ["./src/test-utils/mongo-global-setup.ts"],
  },
});
