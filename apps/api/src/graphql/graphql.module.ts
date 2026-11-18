import { ApolloDriver, type ApolloDriverConfig } from "@nestjs/apollo";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GraphQLModule } from "@nestjs/graphql";
import type { ApiEnvironment, NodeEnvironment } from "../config/env.validation.js";
import { LibraryModule } from "../library/library.module.js";
import { depthLimitRule, graphqlMaxDepth } from "./depth-limit.rule.js";
import { createFormatError } from "./graphql-errors.js";
import { LibraryResolver } from "./library.resolver.js";

/**
 * Opciones de Apollo. GraphiQL (landing page), introspección y stack traces
 * sólo en desarrollo; en test y producción, ninguno de los tres. El contexto
 * lleva req/res de Express (sesión y cookie del refresh token) y toda
 * operación pasa por el límite de profundidad.
 */
export function createGraphqlOptions(nodeEnv: NodeEnvironment): ApolloDriverConfig {
  const development = nodeEnv === "development";
  return {
    path: "/graphql",
    autoSchemaFile: true,
    sortSchema: true,
    graphiql: development,
    introspection: development,
    includeStacktraceInErrorResponses: development,
    formatError: createFormatError(development),
    context: ({ req, res }: { req: unknown; res: unknown }) => ({ req, res }),
    validationRules: [depthLimitRule(graphqlMaxDepth, { ignoreIntrospection: development })],
  };
}

@Module({
  imports: [
    LibraryModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnvironment, true>) =>
        createGraphqlOptions(config.get("NODE_ENV", { infer: true })),
    }),
  ],
  providers: [LibraryResolver],
})
export class ApiGraphqlModule {}
