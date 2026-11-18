import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replicaSetStartupTimeoutMs } from "../test-utils/mongo-replica-set.js";
import { startGraphqlApp, testPassword, type GraphqlTestApp } from "../test-utils/graphql-app.js";

// Archivo propio: ConfigModule lee AUTH_RATE_LIMIT una vez por app. El registro
// del usuario por defecto de startGraphqlApp consume 1 de los 3 intentos de register.
const limit = 3;
let api: GraphqlTestApp;

beforeAll(async () => {
  api = await startGraphqlApp("auth_rate", { AUTH_RATE_LIMIT: String(limit), AUTH_RATE_TTL_SECONDS: "60" });
}, replicaSetStartupTimeoutMs);
afterAll(async () => { await api?.stop(); });

const codeOf = (response: { errors?: { extensions?: Record<string, unknown> }[] }) => response.errors?.[0]?.extensions?.code;
const login = (password: string) => api.gqlWith({ token: null },
  "mutation L($input: CredentialsInput!) { login(input: $input) { accessToken } }",
  { input: { email: api.session.email, password } });

describe("rate limit de las operaciones públicas de autenticación", () => {
  it("login: tras el límite responde TOO_MANY_REQUESTS, aun con la contraseña correcta", async () => {
    for (let attempt = 0; attempt < limit; attempt++) {
      expect(codeOf(await login("contraseña equivocada"))).toBe("UNAUTHENTICATED");
    }
    const blocked = await login(testPassword);
    expect(blocked.errors?.[0]).toMatchObject({
      message: "Demasiados intentos. Espera un momento y vuelve a intentarlo.",
      extensions: { code: "TOO_MANY_REQUESTS" },
    });
    expect(blocked.data ?? null).toBeNull();
  });

  it("register y refreshToken tienen su propio contador", async () => {
    const register = (index: number) => api.gqlWith({ token: null },
      "mutation R($input: CredentialsInput!) { register(input: $input) { accessToken } }",
      { input: { email: `limite${index}@cancha.test`, password: testPassword } });
    expect((await register(1)).errors).toBeUndefined();
    expect((await register(2)).errors).toBeUndefined();
    expect(codeOf(await register(3))).toBe("TOO_MANY_REQUESTS");

    const refresh = () => api.gqlWith({ token: null }, "mutation { refreshToken { accessToken } }");
    for (let attempt = 0; attempt < limit; attempt++) expect(codeOf(await refresh())).toBe("UNAUTHENTICATED");
    expect(codeOf(await refresh())).toBe("TOO_MANY_REQUESTS");
  });

  it("las operaciones con sesión no se limitan", async () => {
    for (let attempt = 0; attempt < limit + 2; attempt++) {
      expect((await api.gql("{ me { id } }")).errors).toBeUndefined();
    }
  });
});
