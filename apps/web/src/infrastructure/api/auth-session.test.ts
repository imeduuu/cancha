import { describe, expect, it, vi } from "vitest";
import { testWebLocks } from "../../test-utils/web-locks";
import { AuthSession, sessionHintKey, type HintStorage } from "./auth-session";
import { ApiUnauthenticatedError, createGraphqlClient } from "./graphql-client";

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const unauthenticated = (message = "Sesión inválida.") =>
  json({ data: null, errors: [{ message, extensions: { code: "UNAUTHENTICATED" } }] });
const user = { id: "u1", email: "ana@cancha.test", createdAt: "2026-01-01T00:00:00.000Z" };

function memoryStorage(initial: Record<string, string> = {}): HintStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
}

/**
 * API falsa con la misma semántica de rotación que AuthService.refresh: la cookie
 * (compartida entre "pestañas", como el cookie jar del navegador) se rota en cada
 * uso, y presentar una ya usada revoca la sesión entera.
 */
function fakeApi(options: { delayMs?: number } = {}) {
  let cookie: string | null = "refresh-0";
  let serial = 0;
  let revoked = false;
  const used = new Set<string>();
  const valid = new Set<string>();
  const log: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const payload = () => {
    const token = `access-${++serial}`;
    valid.add(token);
    return { accessToken: token, accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), user };
  };
  const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const { query } = JSON.parse(String(init?.body)) as { query: string };
    const auth = (init?.headers as Record<string, string>).Authorization?.replace("Bearer ", "");
    if (query.includes("refreshToken")) {
      log.push("refresh");
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      const presented = cookie;
      await new Promise(resolve => setTimeout(resolve, options.delayMs ?? 0));
      inFlight--;
      if (revoked || !presented || used.has(presented)) {
        revoked = true;
        return unauthenticated("Se detectó la reutilización de una sesión.");
      }
      used.add(presented);
      cookie = `refresh-${serial + 1}`;
      return json({ data: { refreshToken: payload() } });
    }
    if (query.includes("login") || query.includes("register")) {
      log.push("login");
      cookie = `refresh-login-${serial}`;
      return json({ data: { [query.includes("login") ? "login" : "register"]: payload() } });
    }
    if (query.includes("logout")) { log.push("logout"); cookie = null; return json({ data: { logout: true } }); }
    log.push(`me:${auth ?? "sin token"}`);
    if (!auth || !valid.has(auth)) return unauthenticated();
    return json({ data: { me: user } });
  });
  return {
    fetch, log,
    get maxInFlight() { return maxInFlight; },
    expire(token: string) { valid.delete(token); },
    client: createGraphqlClient({ fetch }),
  };
}

describe("AuthSession", () => {
  it("sin la pista de sesión, restore() no hace ninguna petición", async () => {
    const api = fakeApi();
    const session = new AuthSession({ client: api.client, storage: memoryStorage(), locks: undefined });
    await expect(session.restore()).resolves.toBeNull();
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("login guarda sólo la pista (nunca el token) y las peticiones usan el access token en memoria", async () => {
    const api = fakeApi();
    const storage = memoryStorage();
    const session = new AuthSession({ client: api.client, storage, locks: undefined });
    await expect(session.login("ana@cancha.test", "clave")).resolves.toEqual(user);

    expect([...storage.values]).toEqual([[sessionHintKey, "1"]]);
    await expect(session.request("{ me { id } }")).resolves.toEqual({ me: user });
    expect(api.log).toEqual(["login", "me:access-1"]);
  });

  it("con la pista, restore() recupera la sesión con la cookie; si ya no sirve borra la pista", async () => {
    const api = fakeApi();
    const storage = memoryStorage({ [sessionHintKey]: "1" });
    const session = new AuthSession({ client: api.client, storage, locks: undefined });
    await expect(session.restore()).resolves.toEqual(user);

    const stale = memoryStorage({ [sessionHintKey]: "1" });
    const revoked = createGraphqlClient({ fetch: async () => unauthenticated() });
    await expect(new AuthSession({ client: revoked, storage: stale, locks: undefined }).restore()).resolves.toBeNull();
    expect(stale.values.has(sessionHintKey)).toBe(false);
  });

  it("deduplica el refresh dentro de la pestaña", async () => {
    const api = fakeApi({ delayMs: 5 });
    const session = new AuthSession({ client: api.client, storage: memoryStorage({ [sessionHintKey]: "1" }), locks: undefined });
    await Promise.all([session.request("{ me { id } }"), session.request("{ me { id } }"), session.refresh()]);
    expect(api.log.filter(entry => entry === "refresh")).toHaveLength(1);
  });

  it("serializa el refresh entre pestañas con el Web Lock: ninguna presenta una cookie ya usada", async () => {
    const api = fakeApi({ delayMs: 5 });
    const locks = testWebLocks();
    const tabs = [1, 2, 3].map(() => new AuthSession({ client: api.client, storage: memoryStorage({ [sessionHintKey]: "1" }), locks }));
    const users = await Promise.all(tabs.map(tab => tab.restore()));
    expect(users).toEqual([user, user, user]);
    expect(api.maxInFlight).toBe(1);
  });

  it("control: sin el lock, dos pestañas a la vez provocan la detección de reutilización", async () => {
    const api = fakeApi({ delayMs: 5 });
    const tabs = [1, 2].map(() => new AuthSession({ client: api.client, storage: memoryStorage({ [sessionHintKey]: "1" }), locks: undefined }));
    const users = await Promise.all(tabs.map(tab => tab.restore()));
    expect(users).toContain(null);
  });

  it("ante UNAUTHENTICATED refresca y reintenta una sola vez", async () => {
    const api = fakeApi();
    const session = new AuthSession({ client: api.client, storage: memoryStorage(), locks: undefined });
    await session.login("ana@cancha.test", "clave");
    api.expire("access-1");
    await expect(session.request("{ me { id } }")).resolves.toEqual({ me: user });
    expect(api.log).toEqual(["login", "me:access-1", "refresh", "me:access-2"]);

    // Si tras refrescar sigue sin autorización, no hay un segundo reintento.
    const stubborn = createGraphqlClient({ fetch: async (_url, init) => {
      const query = String(JSON.parse(String(init?.body)).query);
      if (query.includes("refreshToken")) {
        return json({ data: { refreshToken: { accessToken: "t", accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(), user } } });
      }
      return unauthenticated();
    } });
    const calls = vi.spyOn(stubborn, "request");
    const other = new AuthSession({ client: stubborn, storage: memoryStorage(), locks: undefined });
    await expect(other.request("{ me { id } }")).rejects.toBeInstanceOf(ApiUnauthenticatedError);
    expect(calls).toHaveBeenCalledTimes(4); // refresh, me, refresh, me
  });

  it("si el refresh falla por autenticación cierra la sesión local y avisa a los suscriptores", async () => {
    const api = fakeApi();
    const storage = memoryStorage();
    const session = new AuthSession({ client: api.client, storage, locks: undefined });
    const changes: unknown[] = [];
    session.subscribe(current => changes.push(current));
    await session.login("ana@cancha.test", "clave");
    api.expire("access-1");
    await api.client.request("mutation { logout }", undefined, {}); // la cookie deja de servir

    await expect(session.request("{ me { id } }")).rejects.toBeInstanceOf(ApiUnauthenticatedError);
    expect(session.user).toBeNull();
    expect(storage.values.has(sessionHintKey)).toBe(false);
    expect(changes).toEqual([user, null]);
  });

  it("logout cierra la sesión local aunque la red falle", async () => {
    let online = true;
    const api = fakeApi();
    const client = createGraphqlClient({ fetch: async (url, init) => {
      if (!online) throw new TypeError("Failed to fetch");
      return api.fetch(url, init);
    } });
    const storage = memoryStorage();
    const session = new AuthSession({ client, storage, locks: undefined });
    await session.login("ana@cancha.test", "clave");
    online = false;
    await expect(session.logout()).rejects.toThrow(/No se pudo conectar/);
    expect(session.user).toBeNull();
    expect(storage.values.has(sessionHintKey)).toBe(false);
  });
});
