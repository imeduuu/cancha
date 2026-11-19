// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionHintKey } from "../infrastructure/api/session-hint";
import { renderApplication } from "../test-utils/render-application";
import { installTestWebLocks } from "../test-utils/web-locks";
import { App } from "./app";

const user = { id: "u1", email: "ana@cancha.test", createdAt: "2026-01-01T00:00:00.000Z" };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const failure = (message: string, code: string) => json({ data: null, errors: [{ message, extensions: { code } }] });
const payload = () => ({ accessToken: "jwt", accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(), user });

/** API falsa: `cookieValid` simula la cookie HttpOnly de refresh. */
function fakeApi() {
  const state = { cookieValid: false, operations: [] as string[] };
  const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables?: { input?: { password?: string } } };
    const operation = ["refreshToken", "register", "login", "logout"].find(name => query.includes(name)) ?? "otra";
    state.operations.push(operation);
    if (operation === "refreshToken") {
      return state.cookieValid ? json({ data: { refreshToken: payload() } }) : failure("La sesión no es válida.", "UNAUTHENTICATED");
    }
    if (operation === "login" && variables?.input?.password !== "contraseña-correcta") {
      return failure("Email o contraseña incorrectos.", "UNAUTHENTICATED");
    }
    if (operation === "register" || operation === "login") {
      state.cookieValid = true;
      return json({ data: { [operation]: payload() } });
    }
    if (operation === "logout") { state.cookieValid = false; return json({ data: { logout: true } }); }
    return failure("Operación desconocida.", "VALIDATION");
  });
  vi.stubGlobal("fetch", fetch);
  return { state, fetch };
}

beforeEach(() => { installTestWebLocks(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openAccount() {
  const interaction = userEvent.setup();
  await interaction.click(screen.getByRole("button", { name: /^Cuenta/ }));
  return { interaction, panel: await screen.findByRole("region", { name: "Cuenta" }) };
}

describe("cuenta en la web (fase 5F)", () => {
  it("sin la pista de sesión no hace ninguna petición y la biblioteca sigue disponible", async () => {
    const api = fakeApi();
    await renderApplication(<App />);
    expect(await screen.findByRole("heading", { name: "Biblioteca de torneos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cuenta" })).toHaveAttribute("aria-expanded", "false");
    expect(api.fetch).not.toHaveBeenCalled();

    const { panel } = await openAccount();
    expect(within(panel).getByText(/Sin cuenta todo sigue funcionando/)).toBeInTheDocument();
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("crear una cuenta inicia la sesión y guarda sólo la pista", async () => {
    const api = fakeApi();
    await renderApplication(<App />);
    const { interaction, panel } = await openAccount();
    await interaction.click(within(panel).getByRole("button", { name: "Crear cuenta" }));
    await interaction.type(within(panel).getByLabelText("Email"), user.email);
    await interaction.type(within(panel).getByLabelText("Contraseña"), "una-contraseña-larga");
    await interaction.click(within(panel).getByRole("button", { name: "Registrarme" }));

    expect(await within(panel).findByText(user.email)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Cuenta · ${user.email}` })).toBeInTheDocument();
    expect(api.state.operations).toEqual(["register"]);
    expect(Object.keys(localStorage).filter(key => key.startsWith("cancha.session"))).toEqual([sessionHintKey]);
    expect(localStorage.getItem(sessionHintKey)).toBe("1");
  });

  it("credenciales incorrectas muestran el mensaje del servidor sin iniciar sesión", async () => {
    fakeApi();
    await renderApplication(<App />);
    const { interaction, panel } = await openAccount();
    await interaction.type(within(panel).getByLabelText("Email"), user.email);
    await interaction.type(within(panel).getByLabelText("Contraseña"), "contraseña-equivocada");
    await interaction.click(within(panel).getByRole("button", { name: "Entrar" }));

    expect(await within(panel).findByRole("alert")).toHaveTextContent("Email o contraseña incorrectos.");
    expect(screen.getByRole("button", { name: "Cuenta" })).toBeInTheDocument();
    expect(localStorage.getItem(sessionHintKey)).toBeNull();
  });

  it("cerrar sesión vuelve al modo sin sesión y borra la pista", async () => {
    const api = fakeApi();
    await renderApplication(<App />);
    const { interaction, panel } = await openAccount();
    await interaction.type(within(panel).getByLabelText("Email"), user.email);
    await interaction.type(within(panel).getByLabelText("Contraseña"), "contraseña-correcta");
    await interaction.click(within(panel).getByRole("button", { name: "Entrar" }));
    await interaction.click(await within(panel).findByRole("button", { name: "Cerrar sesión" }));

    expect(await screen.findByRole("button", { name: "Cuenta" })).toBeInTheDocument();
    expect(localStorage.getItem(sessionHintKey)).toBeNull();
    expect(api.state.operations).toEqual(["login", "logout"]);
  });

  it("con la pista, recupera la sesión al cargar; si la cookie ya no sirve, borra la pista", async () => {
    const api = fakeApi();
    api.state.cookieValid = true;
    localStorage.setItem(sessionHintKey, "1");
    await renderApplication(<App />);
    expect(await screen.findByRole("button", { name: `Cuenta · ${user.email}` })).toBeInTheDocument();
    cleanup();

    api.state.cookieValid = false;
    localStorage.setItem(sessionHintKey, "1");
    await renderApplication(<App />);
    await vi.waitFor(() => expect(localStorage.getItem(sessionHintKey)).toBeNull());
    expect(screen.getByRole("button", { name: "Cuenta" })).toBeInTheDocument();
  });
});
