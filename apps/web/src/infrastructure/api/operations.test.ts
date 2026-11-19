import { readFileSync } from "node:fs";
import { buildSchema, parse, validate } from "graphql";
import { describe, expect, it } from "vitest";
import { operations } from "./operations";

// Esquema publicado por la API; su propia prueba (schema-snapshot.e2e.test.ts) lo mantiene igual al real.
const schema = buildSchema(readFileSync(new URL("../../../../api/schema.graphql", import.meta.url), "utf8"));

function problems(document: string): string[] {
  return validate(schema, parse(document)).map(({ message }) => message);
}

describe("operaciones GraphQL de la web contra el esquema de la API", () => {
  for (const [name, document] of Object.entries(operations)) {
    it(`${name} es válida`, () => {
      expect(problems(document)).toEqual([]);
    });
  }

  it("detecta un tipo, campo o argumento que no existe", () => {
    expect(problems(operations.restoreBackup.replace("RestoreMode!", "RestoreModeInput!"))).not.toEqual([]);
    expect(problems("query { librarySnapshot noExiste }")).not.toEqual([]);
    expect(problems("mutation ($v: Int!) { deleteSaveCheckpoint(id: \"x\", version: $v) }")).not.toEqual([]);
  });
});
