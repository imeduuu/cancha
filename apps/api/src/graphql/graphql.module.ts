import { ApolloDriver, type ApolloDriverConfig } from "@nestjs/apollo";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GraphQLModule } from "@nestjs/graphql";
import type { ApiEnvironment, NodeEnvironment } from "../config/env.validation.js";
import { LibraryModule } from "../library/library.module.js";
import { createFormatError } from "./graphql-errors.js";
import { LibraryResolver } from "./library.resolver.js";

/**
 * Opciones de Apollo. GraphiQL (landing page), introspección y stack traces
 * sólo en desarrollo; en test y producción, ninguno de los tres.
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
