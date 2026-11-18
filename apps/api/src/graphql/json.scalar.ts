import { GraphQLScalarType, Kind, type ValueNode } from "graphql";

function literal(node: ValueNode, variables: Record<string, unknown> | null | undefined): unknown {
  switch (node.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return node.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(node.value);
    case Kind.NULL:
      return null;
    case Kind.LIST:
      return node.values.map(value => literal(value, variables));
    case Kind.OBJECT:
      return Object.fromEntries(node.fields.map(field => [field.name.value, literal(field.value, variables)]));
    case Kind.VARIABLE:
      return variables?.[node.name.value];
    default:
      return undefined;
  }
}

/**
 * Valor JSON arbitrario. Se usa para el documento completo del torneo (el
 * cliente ya tiene los tipos de core) y para `before`/`after` de la actividad,
 * que en el dominio son `unknown`.
 */
export const JsonScalar = new GraphQLScalarType({
  name: "JSON",
  description: "Valor JSON arbitrario (objeto, lista, texto, número, booleano o null).",
  serialize: value => value,
  parseValue: value => value,
  parseLiteral: (node, variables) => literal(node, variables),
});
