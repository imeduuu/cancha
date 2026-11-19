import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { configureApp } from "../bootstrap.js";
import { startTestReplicaSet, type TestReplicaSet } from "./mongo-replica-set.js";

export interface GraphqlError { message: string; extensions?: Record<string, unknown> }
export interface GraphqlResponse<T> { data?: T | null; errors?: GraphqlError[] }

/** Sesión de prueba: access token y la cookie `cancha_refresh=…` tal como la fijó la API. */
export interface TestSession {
  readonly userId: string;
  readonly email: string;
  readonly accessToken: string;
  readonly refreshCookie: string;
}

export interface GqlRequestOptions {
  /** Access token; null = sin Authorization. */
  readonly token?: string | null;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface GraphqlTestApp {
  readonly app: INestApplication;
  /** Usuario registrado al arrancar; `gql` lo usa por defecto. */
  readonly session: TestSession;
  gql<T = Record<string, never>>(query: string, variables?: Record<string, unknown>): Promise<GraphqlResponse<T>>;
  /** Igual que `gql`, con otro token (o ninguno) y cabeceras extra. Devuelve también la respuesta HTTP. */
  gqlWith<T = Record<string, never>>(
    options: GqlRequestOptions,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<GraphqlResponse<T> & { status: number; setCookie: string[] }>;
  register(email: string, password?: string): Promise<TestSession>;
  login(email: string, password?: string): Promise<TestSession>;
  stop(): Promise<void>;
}

/** Proveedor que una prueba reemplaza (p. ej. los destinos del proxy de fuentes oficiales). */
export interface ProviderOverride {
  readonly provide: unknown;
  readonly useValue: unknown;
}

export const testPassword = "contraseña-de-prueba-segura";

const authFields = "accessToken accessTokenExpiresAt user { id email createdAt }";

/** La cookie `cancha_refresh=valor` de una respuesta (sin atributos), o undefined. */
export function refreshCookieOf(setCookie: readonly string[]): string | undefined {
  return setCookie.map(cookie => cookie.split(";")[0]).find(cookie => /^cancha_refresh=./.test(cookie));
}

/**
 * AppModule completo (NODE_ENV=test) sobre una base nueva del replica set
 * compartido, con la misma configuración HTTP que main.ts y un cliente GraphQL
 * de supertest autenticado. Una app por archivo de prueba: ConfigModule lee
 * process.env al importar AppModule (`env` permite ajustar variables).
 * `overrides` reemplaza proveedores con Test.createTestingModule.
 */
export async function startGraphqlApp(
  prefix: string,
  env: Record<string, string> = {},
  overrides: readonly ProviderOverride[] = [],
): Promise<GraphqlTestApp> {
  const replicaSet: TestReplicaSet = await startTestReplicaSet();
  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGODB_URI: replicaSet.uri,
    MONGODB_DB: `${prefix}_${process.pid}_${Date.now()}`,
    // Límite alto: sólo auth-rate-limit.e2e lo prueba (con su propio valor).
    AUTH_RATE_LIMIT: "1000",
    // Valores fijos para que una prueba anterior del mismo worker no los deje cambiados.
    TRUST_PROXY: "0",
    OFFICIAL_SOURCE_RATE_LIMIT: "1000",
    ...env,
  });
  const { AppModule } = await import("../app.module.js");
  const app = overrides.length === 0
    ? await NestFactory.create(AppModule, { logger: false, bodyParser: false })
    : await overrides
      .reduce((builder, { provide, useValue }) => builder.overrideProvider(provide).useValue(useValue), Test.createTestingModule({ imports: [AppModule] }))
      .compile()
      .then(moduleRef => moduleRef.createNestApplication({ logger: false, bodyParser: false }));
  configureApp(app);
  await app.init();

  const gqlWith: GraphqlTestApp["gqlWith"] = async (options, query, variables = {}) => {
    let call = request(app.getHttpServer()).post("/graphql");
    if (options.token) call = call.set("Authorization", `Bearer ${options.token}`);
    for (const [name, value] of Object.entries(options.headers ?? {})) call = call.set(name, value);
    const response = await call.send({ query, variables });
    const setCookie = response.headers["set-cookie"] as unknown as string[] | undefined;
    return { ...(response.body as GraphqlResponse<never>), status: response.status, setCookie: setCookie ?? [] };
  };

  const authenticate = async (operation: "register" | "login", email: string, password: string): Promise<TestSession> => {
    const response = await gqlWith<Record<string, { accessToken: string; user: { id: string; email: string } }>>(
      { token: null },
      `mutation Auth($input: CredentialsInput!) { ${operation}(input: $input) { ${authFields} } }`,
      { input: { email, password } },
    );
    const payload = response.data?.[operation];
    const refreshCookie = refreshCookieOf(response.setCookie);
    if (!payload || !refreshCookie) {
      throw new Error(`No se pudo ejecutar ${operation} de prueba: ${JSON.stringify(response.errors)}`);
    }
    return { userId: payload.user.id, email: payload.user.email, accessToken: payload.accessToken, refreshCookie };
  };

  const register = (email: string, password = testPassword) => authenticate("register", email, password);
  const session = await register(`${prefix}@cancha.test`);

  return {
    app,
    session,
    async gql<T>(query: string, variables: Record<string, unknown> = {}) {
      const { data, errors } = await gqlWith<T>({ token: session.accessToken }, query, variables);
      return errors === undefined ? { data } : { data, errors };
    },
    gqlWith,
    register,
    login: (email, password = testPassword) => authenticate("login", email, password),
    async stop() {
      await app.close();
      await replicaSet.stop();
    },
  };
}
