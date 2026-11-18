import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { startTestReplicaSet, type TestReplicaSet } from "./mongo-replica-set.js";

export interface GraphqlError { message: string; extensions?: Record<string, unknown> }
export interface GraphqlResponse<T> { data?: T | null; errors?: GraphqlError[] }

export interface GraphqlTestApp {
  readonly app: INestApplication;
  gql<T = Record<string, never>>(query: string, variables?: Record<string, unknown>): Promise<GraphqlResponse<T>>;
  stop(): Promise<void>;
}

/**
 * AppModule completo (NODE_ENV=test) sobre una base nueva del replica set
 * compartido, con un cliente GraphQL de supertest. Una app por archivo de
 * prueba: ConfigModule lee process.env al importar AppModule.
 */
export async function startGraphqlApp(prefix: string): Promise<GraphqlTestApp> {
  const replicaSet: TestReplicaSet = await startTestReplicaSet();
  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGODB_URI: replicaSet.uri,
    MONGODB_DB: `${prefix}_${process.pid}_${Date.now()}`,
  });
  const { AppModule } = await import("../app.module.js");
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  return {
    app,
    async gql<T>(query: string, variables: Record<string, unknown> = {}) {
      const response = await request(app.getHttpServer()).post("/graphql").send({ query, variables });
      return response.body as GraphqlResponse<T>;
    },
    async stop() {
      await app.close();
      await replicaSet.stop();
    },
  };
}
