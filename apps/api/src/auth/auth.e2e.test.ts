import { JwtService } from "@nestjs/jwt";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { developmentCorsOrigins } from "../config/env.validation.js";
import { replicaSetStartupTimeoutMs } from "../test-utils/mongo-replica-set.js";
import {
  refreshCookieOf,
  startGraphqlApp,
  testPassword,
  type GraphqlTestApp,
  type TestSession,
} from "../test-utils/graphql-app.js";

let api: GraphqlTestApp;

beforeAll(async () => { api = await startGraphqlApp("auth"); }, replicaSetStartupTimeoutMs);
afterAll(async () => { await api?.stop(); });

const allowedOrigin = developmentCorsOrigins[0];
const ME = "{ me { id email createdAt } }";
const REFRESH = "mutation { refreshToken { accessToken accessTokenExpiresAt user { id email } } }";

interface AuthPayload { accessToken: string; accessTokenExpiresAt: string; user: { id: string; email: string; createdAt: string } }

const me = (token: string | null) => api.gqlWith<{ me: { id: string; email: string } }>({ token }, ME);
const refresh = (cookie: string, headers: Record<string, string> = {}) =>
  api.gqlWith<{ refreshToken: AuthPayload }>({ token: null, headers: { Cookie: cookie, ...headers } }, REFRESH);
const codeOf = (response: { errors?: { extensions?: Record<string, unknown> }[] }) => response.errors?.[0]?.extensions?.code;

async function credentials(operation: "register" | "login", email: string, password: string) {
  return api.gqlWith<Record<string, AuthPayload>>(
    { token: null },
    `mutation Auth($input: CredentialsInput!) { ${operation}(input: $input) { accessToken accessTokenExpiresAt user { id email createdAt } } }`,
    { input: { email, password } },
  );
}

describe("registro", () => {
  it("crea la cuenta con el email normalizado, inicia sesión y fija la cookie del refresh token", async () => {
    const response = await credentials("register", "  Nueva.Cuenta@Cancha.TEST ", testPassword);
    expect(response.errors).toBeUndefined();
    const payload = response.data!.register;
    expect(payload.user.email).toBe("nueva.cuenta@cancha.test");
    expect(Date.parse(payload.accessTokenExpiresAt) - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(Date.parse(payload.accessTokenExpiresAt) - Date.now()).toBeLessThanOrEqual(15 * 60_000);
    expect(JSON.stringify(response.data)).not.toMatch(/refresh/i);

    const cookie = response.setCookie.find(value => value.startsWith("cancha_refresh="))!;
    expect(cookie).toMatch(/; Path=\/graphql/);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/; SameSite=Lax/);
    expect(cookie).toMatch(/; Expires=/);

    expect((await me(payload.accessToken)).data!.me).toMatchObject({ id: payload.user.id, email: "nueva.cuenta@cancha.test" });
  });

  it("rechaza un email ya registrado (sin importar mayúsculas) y credenciales inválidas, en español", async () => {
    const duplicate = await credentials("register", "NUEVA.cuenta@cancha.test", testPassword);
    expect(duplicate.errors?.[0]).toMatchObject({ message: "Ya existe una cuenta con ese email.", extensions: { code: "VALIDATION" } });
    expect(duplicate.setCookie).toEqual([]);

    const short = await credentials("register", "otra@cancha.test", "corta");
    expect(short.errors?.[0]).toMatchObject({
      message: "La contraseña debe tener al menos 12 caracteres.", extensions: { code: "VALIDATION" },
    });
    const email = await credentials("register", "no-es-un-email", testPassword);
    expect(email.errors?.[0]?.message).toBe("El email no tiene un formato válido.");
  });
});

describe("login", () => {
  it("inicia una sesión nueva con el email en cualquier formato", async () => {
    const response = await credentials("login", ` ${api.session.email.toUpperCase()} `, testPassword);
    expect(response.errors).toBeUndefined();
    expect(response.data!.login.user.id).toBe(api.session.userId);
    expect(refreshCookieOf(response.setCookie)).toBeDefined();
  });

  it("responde lo mismo si la contraseña es incorrecta o si el email no existe", async () => {
    const wrongPassword = await credentials("login", api.session.email, "otra contraseña larga");
    const unknownEmail = await credentials("login", "nadie@cancha.test", testPassword);
    for (const response of [wrongPassword, unknownEmail]) {
      expect(response.data ?? null).toBeNull();
      expect(response.errors).toEqual([expect.objectContaining({
        message: "Email o contraseña incorrectos", extensions: { code: "UNAUTHENTICATED" },
      })]);
      expect(response.setCookie).toEqual([]);
    }
  });
});

describe("acceso con y sin sesión", () => {
  it("me devuelve el usuario de la sesión", async () => {
    const response = await me(api.session.accessToken);
    expect(response.data!.me).toMatchObject({ id: api.session.userId, email: api.session.email });
  });

  it("sin token, con token alterado, firmado con otro secreto o expirado: UNAUTHENTICATED", async () => {
    const jwt = api.app.get(JwtService);
    const { sub, sid } = jwt.decode<{ sub: string; sid: string }>(api.session.accessToken);
    const [header, , signature] = api.session.accessToken.split(".");
    const tampered = `${header}.${Buffer.from(JSON.stringify({ sub: "otro-usuario", sid })).toString("base64url")}.${signature}`;
    const otherSecret = await jwt.signAsync({ sub, sid }, { secret: "x".repeat(40) });
    const expired = await jwt.signAsync({ sub, sid }, { expiresIn: -60 });

    for (const token of [null, "no-es-un-jwt", tampered, otherSecret, expired]) {
      const response = await me(token);
      expect(codeOf(response)).toBe("UNAUTHENTICATED");
      expect(response.data ?? null).toBeNull();
    }
  });

  it("todas las operaciones de la biblioteca exigen sesión", async () => {
    const queries = await api.gqlWith({ token: null }, "{ tournaments { id } }");
    expect(codeOf(queries)).toBe("UNAUTHENTICATED");
    const mutation = await api.gqlWith({ token: null },
      `mutation { createTournament(input: { name: "X", teamNames: ["A", "B"], legs: 1, tieBreakers: [] }) { id } }`);
    expect(codeOf(mutation)).toBe("UNAUTHENTICATED");
    expect((await api.gql<{ tournaments: unknown[] }>("{ tournaments { id } }")).errors).toBeUndefined();
  });

  it("GET /health sigue siendo público", async () => {
    const response = await request(api.app.getHttpServer()).get("/health");
    expect(response.status).toBe(200);
  });
});

describe("refresh token rotativo", () => {
  let session: TestSession;
  beforeAll(async () => { session = await api.register("rotacion@cancha.test"); });

  it("canjea la cookie por un access token nuevo y rota la cookie; la vieja ya no sirve", async () => {
    const first = await refresh(session.refreshCookie);
    expect(first.errors).toBeUndefined();
    expect(first.data!.refreshToken.user.id).toBe(session.userId);
    const rotated = refreshCookieOf(first.setCookie)!;
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(session.refreshCookie);
    expect((await me(first.data!.refreshToken.accessToken)).data!.me.id).toBe(session.userId);

    const second = await refresh(rotated);
    expect(second.errors).toBeUndefined();
    session = { ...session, refreshCookie: refreshCookieOf(second.setCookie)!, accessToken: second.data!.refreshToken.accessToken };
  });

  it("sin cookie o con una cookie inventada: UNAUTHENTICATED", async () => {
    expect(codeOf(await api.gqlWith({ token: null }, REFRESH))).toBe("UNAUTHENTICATED");
    expect(codeOf(await refresh("cancha_refresh=inventado.secreto"))).toBe("UNAUTHENTICATED");
    const [id] = session.refreshCookie.slice("cancha_refresh=".length).split(".");
    expect(codeOf(await refresh(`cancha_refresh=${id}.secreto-incorrecto`))).toBe("UNAUTHENTICATED");
    // Un secreto incorrecto no consume ni revoca el token real.
    expect((await me(session.accessToken)).errors).toBeUndefined();
  });

  it("reutilizar un refresh ya usado revoca su familia (y su access token), pero no las otras sesiones del usuario", async () => {
    const other = await api.login("rotacion@cancha.test");

    const used = session.refreshCookie;
    const rotation = await refresh(used);
    const current = refreshCookieOf(rotation.setCookie)!;
    const currentAccess = rotation.data!.refreshToken.accessToken;

    const reuse = await refresh(used);
    expect(reuse.errors?.[0]).toMatchObject({
      message: expect.stringMatching(/reutilización/), extensions: { code: "UNAUTHENTICATED" },
    });
    expect(reuse.setCookie.some(cookie => /^cancha_refresh=;.*Expires=Thu, 01 Jan 1970/.test(cookie))).toBe(true);

    // Toda la familia queda revocada: el refresh vigente y los access tokens de esa sesión.
    expect(codeOf(await refresh(current))).toBe("UNAUTHENTICATED");
    expect(codeOf(await me(currentAccess))).toBe("UNAUTHENTICATED");
    expect(codeOf(await me(session.accessToken))).toBe("UNAUTHENTICATED");

    // La otra sesión del mismo usuario sigue activa y puede renovarse.
    expect((await me(other.accessToken)).data!.me.id).toBe(session.userId);
    const otherRefresh = await refresh(other.refreshCookie);
    expect(otherRefresh.errors).toBeUndefined();
    expect((await me(otherRefresh.data!.refreshToken.accessToken)).data!.me.id).toBe(session.userId);
  });

  it("rechaza un Origin que no está en CORS_ORIGINS y acepta los permitidos", async () => {
    const fresh = await api.login("rotacion@cancha.test");
    const forbidden = await refresh(fresh.refreshCookie, { Origin: "https://atacante.example" });
    expect(codeOf(forbidden)).toBe("FORBIDDEN");
    const allowed = await refresh(fresh.refreshCookie, { Origin: allowedOrigin });
    expect(allowed.errors).toBeUndefined();
  });
});

describe("logout", () => {
  it("revoca la sesión: el access token, el refresh y la cookie dejan de servir", async () => {
    const session = await api.register("logout@cancha.test");
    const other = await api.login("logout@cancha.test");

    const response = await api.gqlWith<{ logout: boolean }>({ token: session.accessToken }, "mutation { logout }");
    expect(response.data!.logout).toBe(true);
    expect(response.setCookie.some(cookie => /^cancha_refresh=;.*Path=\/graphql/.test(cookie))).toBe(true);

    expect(codeOf(await me(session.accessToken))).toBe("UNAUTHENTICATED");
    expect(codeOf(await refresh(session.refreshCookie))).toBe("UNAUTHENTICATED");
    expect(codeOf(await api.gqlWith({ token: session.accessToken }, "mutation { logout }"))).toBe("UNAUTHENTICATED");
    // Cerrar una sesión no cierra las demás.
    expect((await me(other.accessToken)).errors).toBeUndefined();
  });
});

describe("CORS con credenciales", () => {
  it("el preflight responde sólo a orígenes permitidos, con credenciales", async () => {
    const allowed = await request(api.app.getHttpServer())
      .options("/graphql")
      .set("Origin", allowedOrigin)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,authorization");
    expect(allowed.status).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe(allowedOrigin);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    expect(allowed.headers["access-control-allow-headers"]).toMatch(/Authorization/);

    const denied = await request(api.app.getHttpServer())
      .options("/graphql")
      .set("Origin", "https://atacante.example")
      .set("Access-Control-Request-Method", "POST");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("endurecimiento de GraphQL", () => {
  it("rechaza consultas más profundas que el límite antes de ejecutarlas", async () => {
    let selection = "name";
    for (let level = 0; level < 10; level++) selection = `ofType { ${selection} }`;
    const response = await api.gql(`{ __type(name: "Tournament") { ${selection} } }`);
    expect(response.errors?.map(({ message }) => message))
      .toContain("La consulta supera la profundidad máxima permitida (10).");
  });

  it("rechaza un cuerpo de más de 32 MB con 413", async () => {
    const response = await request(api.app.getHttpServer())
      .post("/graphql")
      .set("Content-Type", "application/json")
      .set("Authorization", `Bearer ${api.session.accessToken}`)
      .send(JSON.stringify({ query: "{ me { id } }", variables: { relleno: "x".repeat(33 * 1024 * 1024) } }));
    expect(response.status).toBe(413);
  });
});
