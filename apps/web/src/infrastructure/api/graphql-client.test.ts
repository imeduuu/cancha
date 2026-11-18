import { describe, expect, it, vi } from "vitest";
import {
  ApiConflictError,
  ApiError,
  ApiNetworkError,
  ApiUnauthenticatedError,
  ApiValidationError,
  createGraphqlClient,
} from "./graphql-client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("createGraphqlClient", () => {
  it("envía POST JSON al mismo origen, con Authorization sólo si hay token", async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => json({ data: { ok: true } }));
    const client = createGraphqlClient({ fetch });

    await expect(client.request("{ ok }")).resolves.toEqual({ ok: true });
    await client.request("query Q($id: ID!) { ok }", { id: "a" }, { token: "jwt" });

    const [url, first] = fetch.mock.calls[0];
    expect(url).toBe("/graphql");
    expect(first).toMatchObject({ method: "POST", credentials: "same-origin", body: JSON.stringify({ query: "{ ok }" }) });
    expect(first?.headers).toEqual({ "Content-Type": "application/json" });
    const second = fetch.mock.calls[1][1];
    expect(second?.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer jwt" });
    expect(JSON.parse(String(second?.body))).toEqual({ query: "query Q($id: ID!) { ok }", variables: { id: "a" } });
  });

  it("traduce extensions.code a errores tipados y conserva el mensaje y las extensiones", async () => {
    const cases = [
      [{ code: "CONFLICT", expectedLibraryVersion: 1, currentLibraryVersion: 2 }, ApiConflictError],
      [{ code: "VALIDATION" }, ApiValidationError],
      [{ code: "UNAUTHENTICATED" }, ApiUnauthenticatedError],
      [{ code: "OTRO" }, ApiError],
    ] as const;
    for (const [extensions, type] of cases) {
      const client = createGraphqlClient({ fetch: async () => json({ data: null, errors: [{ message: "Mensaje del servidor.", extensions }] }) });
      const error = await client.request("{ x }").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(type);
      expect(error).toMatchObject({ message: "Mensaje del servidor.", code: extensions.code, extensions });
    }
  });

  it("un fallo de red, una respuesta que no es GraphQL o un 413 son ApiNetworkError", async () => {
    const offline = createGraphqlClient({ fetch: async () => { throw new TypeError("Failed to fetch"); } });
    await expect(offline.request("{ x }")).rejects.toBeInstanceOf(ApiNetworkError);

    const html = createGraphqlClient({ fetch: async () => new Response("<html>502</html>", { status: 502 }) });
    await expect(html.request("{ x }")).rejects.toMatchObject({ name: "ApiNetworkError", status: 502 });

    const tooLarge = createGraphqlClient({ fetch: async () => new Response("", { status: 413 }) });
    await expect(tooLarge.request("{ x }")).rejects.toThrow(/demasiado grandes/);
  });
});
