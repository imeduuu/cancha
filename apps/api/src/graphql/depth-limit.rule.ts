import {
  GraphQLError,
  Kind,
  type ASTVisitor,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
} from "graphql";

/**
 * Profundidad máxima de una consulta (la raíz cuenta como 1). La más profunda
 * que admite el esquema hoy es
 * `{ tournament { matchdays { fixtures { result { penalties { homeGoals } } } } } }` (6).
 */
export const graphqlMaxDepth = 10;

/**
 * Regla de validación: rechaza operaciones cuya selección anidada supera
 * `maxDepth`. Sigue fragmentos (con protección contra ciclos). Se valida antes
 * de ejecutar nada. `ignoreIntrospection` excluye `__schema`/`__type`: la
 * consulta estándar de GraphiQL llega a 15 niveles. Sólo se activa en
 * desarrollo, el único entorno con introspección habilitada.
 */
export function depthLimitRule(maxDepth: number, { ignoreIntrospection = false } = {}) {
  return (context: ValidationContext): ASTVisitor => {
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const definition of context.getDocument().definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition);
    }

    const depthOf = (selectionSet: SelectionSetNode | undefined, depth: number, visiting: ReadonlySet<string>): number => {
      if (!selectionSet) return depth;
      let deepest = depth;
      for (const selection of selectionSet.selections) {
        if (deepest > maxDepth) return deepest;
        if (selection.kind === Kind.FIELD) {
          if (ignoreIntrospection && selection.name.value.startsWith("__")) continue;
          const next = selection.selectionSet ? depthOf(selection.selectionSet, depth + 1, visiting) : depth;
          deepest = Math.max(deepest, next);
        } else if (selection.kind === Kind.INLINE_FRAGMENT) {
          deepest = Math.max(deepest, depthOf(selection.selectionSet, depth, visiting));
        } else {
          const name = selection.name.value;
          const fragment = fragments.get(name);
          if (!fragment || visiting.has(name)) continue;
          deepest = Math.max(deepest, depthOf(fragment.selectionSet, depth, new Set([...visiting, name])));
        }
      }
      return deepest;
    };

    return {
      OperationDefinition(operation) {
        // La raíz cuenta como nivel 1: `{ me { id } }` tiene profundidad 2.
        const depth = depthOf(operation.selectionSet, 1, new Set());
        if (depth > maxDepth) {
          const name = operation.name ? ` "${operation.name.value}"` : "";
          context.reportError(new GraphQLError(
            `La consulta${name} supera la profundidad máxima permitida (${maxDepth}).`,
            { nodes: [operation], extensions: { code: "GRAPHQL_VALIDATION_FAILED" } },
          ));
        }
      },
    };
  };
}
