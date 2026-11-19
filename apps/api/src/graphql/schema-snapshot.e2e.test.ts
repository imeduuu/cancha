import { readFile, writeFile } from "node:fs/promises";
import { GraphQLSchemaHost } from "@nestjs/graphql";
import { printSchema } from "graphql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replicaSetStartupTimeoutMs } from "../test-utils/mongo-replica-set.js";
import { startGraphqlApp, type GraphqlTestApp } from "../test-utils/graphql-app.js";

/**
 * `apps/api/schema.graphql` es el esquema publicado de la API. La web valida contra
 * él todas sus operaciones (`apps/web/src/infrastructure/api/operations.test.ts`),
 * así que debe coincidir siempre con el esquema real. Para regenerarlo:
 *   UPDATE_GRAPHQL_SCHEMA=1 npm test -w @cancha/api -- src/graphql/schema-snapshot.e2e.test.ts
 */
const schemaFile = new URL("../../schema.graphql", import.meta.url);

let api: GraphqlTestApp;
beforeAll(async () => { api = await startGraphqlApp("schema_snapshot"); }, replicaSetStartupTimeoutMs);
afterAll(async () => { await api?.stop(); });

describe("esquema GraphQL publicado", () => {
  it("apps/api/schema.graphql coincide con el esquema de la API", async () => {
    const live = `${printSchema(api.app.get(GraphQLSchemaHost).schema)}\n`;
    if (process.env.UPDATE_GRAPHQL_SCHEMA === "1") await writeFile(schemaFile, live, "utf8");
    const published = await readFile(schemaFile, "utf8").catch(() => "");
    expect(published.replaceAll("\r\n", "\n"), "apps/api/schema.graphql está desactualizado: regenéralo con UPDATE_GRAPHQL_SCHEMA=1 (ver el comentario de este archivo).")
      .toBe(live);
  });
});
