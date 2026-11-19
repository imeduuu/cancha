// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryTournamentRepository } from "@cancha/core/application/services/in-memory-library";
import { createTournament } from "@cancha/core/application/use-cases/create-tournament";
import { ApiValidationError } from "../infrastructure/api/graphql-client";
import { sessionHintKey } from "../infrastructure/api/session-hint";
import { createFakeLibraryServer, fakeSessionUser } from "../test-utils/fake-library-server";
import { renderApplication } from "../test-utils/render-application";
import { installTestWebLocks } from "../test-utils/web-locks";
import { App } from "./app";

function seededServer() {
  const seed = new InMemoryTournamentRepository();
  createTournament({ name: "Liga de la cuenta", teamNames: ["Norte", "Sur", "Este", "Oeste"], legs: 1, tieBreakers: ["goalDifference"] }, seed);
  const server = createFakeLibraryServer({ tournaments: seed.findAll(), activity: seed.findActivity(), libraryVersion: 1 });
  vi.stubGlobal("fetch", server.fetch);
  return server;
}

beforeEach(() => {
  installTestWebLocks();
  localStorage.clear();
  localStorage.setItem(sessionHintKey, "1");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("App con la biblioteca de la cuenta (fase 5G)", () => {
  it("carga la biblioteca de la cuenta y guarda en el servidor, sin tocar la del navegador", async () => {
    const server = seededServer();
    const user = userEvent.setup();
    await renderApplication(<App />);
    expect(await screen.findByRole("button", { name: `Cuenta · ${fakeSessionUser.email}` })).toBeInTheDocument();
    expect((await screen.findAllByText("Liga de la cuenta")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Crear torneo" }));
    const nameInput = screen.getByRole("textbox", { name: /Nombre del campeonato/ });
    await user.clear(nameInput);
    await user.type(nameInput, "Campeonato con sesión");
    await user.click(screen.getByRole("button", { name: /Crear campeonato/ }));
    expect(await screen.findByRole("heading", { name: "Campeonato con sesión" })).toBeInTheDocument();

    await vi.waitFor(() => expect(server.state.tournaments.map(({ name }) => name)).toContain("Campeonato con sesión"));
    expect(server.operations).toContain("commitLibraryChanges");
    expect(localStorage.getItem("cancha.tournaments")).toBeNull();
    expect(localStorage.getItem("cancha.activity")).toBeNull();
  });

  it("un cambio desde otro dispositivo muestra el aviso de cambios externos", async () => {
    const server = seededServer();
    await renderApplication(<App />);
    expect((await screen.findAllByText("Liga de la cuenta")).length).toBeGreaterThan(0);

    server.externalWrite(state => { state.activeTournamentId = null; });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });

    const alert = await screen.findByRole("alert", { name: "Cambios externos en la biblioteca" });
    expect(within(alert).getByText(/otra pestaña o dispositivo/)).toBeInTheDocument();
  });

  it("cerrar sesión vuelve a la biblioteca de este navegador, intacta", async () => {
    seededServer();
    const user = userEvent.setup();
    await renderApplication(<App />);
    expect((await screen.findAllByText("Liga de la cuenta")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: `Cuenta · ${fakeSessionUser.email}` }));
    await user.click(await within(await screen.findByRole("region", { name: "Cuenta" })).findByRole("button", { name: "Cerrar sesión" }));

    expect(await screen.findByRole("heading", { name: "Aún no tienes torneos guardados" })).toBeInTheDocument();
    expect(screen.queryByText("Liga de la cuenta")).not.toBeInTheDocument();
    expect(localStorage.getItem(sessionHintKey)).toBeNull();
  });

  it("si no se puede cargar la biblioteca de la cuenta, ofrece reintentar", async () => {
    const server = seededServer();
    server.failNext(new ApiValidationError("Biblioteca no disponible.", "VALIDATION"));
    const user = userEvent.setup();
    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se pudo cargar la biblioteca de tu cuenta. Biblioteca no disponible.");
    expect(screen.getByRole("button", { name: `Cuenta · ${fakeSessionUser.email}` })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect((await screen.findAllByText("Liga de la cuenta")).length).toBeGreaterThan(0);
  });
});
