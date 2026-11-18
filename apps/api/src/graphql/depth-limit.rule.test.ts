import { buildSchema, getIntrospectionQuery, parse, validate } from "graphql";
import { describe, expect, it } from "vitest";
import { depthLimitRule, graphqlMaxDepth } from "./depth-limit.rule.js";

// Esquema recursivo: permite construir consultas tan profundas como se quiera.
const schema = buildSchema(`
  type Node { id: ID, child: Node, other: Node }
  type Query { node: Node }
`);

function nested(depth: number): string {
  // `{ node { id } }` tiene profundidad 2; cada `child { … }` suma 1.
  let selection = "id";
  for (let level = 2; level < depth; level++) selection = `child { ${selection} }`;
  return `{ node { ${selection} } }`;
}

const errorsOf = (query: string, max = 4, options = {}) =>
  validate(schema, parse(query), [depthLimitRule(max, options)]).map(({ message }) => message);

describe("depthLimitRule", () => {
  it("acepta hasta el máximo y rechaza un nivel más, con mensaje en español", () => {
    expect(errorsOf(nested(4))).toEqual([]);
    expect(errorsOf(nested(5))).toEqual(["La consulta supera la profundidad máxima permitida (4)."]);
    expect(errorsOf(`query Profunda ${nested(5).slice(0)}`)).toEqual([
      "La consulta \"Profunda\" supera la profundidad máxima permitida (4).",
    ]);
  });

  it("sigue fragmentos con nombre e inline, y no se cuelga con fragmentos cíclicos", () => {
    const viaFragments = `
      { node { ...A } }
      fragment A on Node { child { ... on Node { child { ...B } } } }
      fragment B on Node { child { id } }
    `;
    expect(errorsOf(viaFragments)).toHaveLength(1);
    const cyclic = "{ node { ...A } } fragment A on Node { child { ...A } }";
    // graphql rechaza el ciclo con su propia regla; aquí sólo importa terminar.
    expect(() => errorsOf(cyclic)).not.toThrow();
  });

  it("cada operación del documento se valida por separado", () => {
    expect(errorsOf(`query Corta { node { id } } query Larga ${nested(6)}`)).toEqual([
      "La consulta \"Larga\" supera la profundidad máxima permitida (4).",
    ]);
  });

  it("la introspección estándar (15 niveles) sólo pasa si se excluye, como en desarrollo", () => {
    const introspection = getIntrospectionQuery();
    expect(errorsOf(introspection, graphqlMaxDepth)).toHaveLength(1);
    expect(errorsOf(introspection, graphqlMaxDepth, { ignoreIntrospection: true })).toEqual([]);
  });
});
