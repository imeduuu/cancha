// @vitest-environment jsdom
import { randomUUID, webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryTournamentRepository } from "@cancha/core/application/services/in-memory-library";
import { createTournament } from "@cancha/core/application/use-cases/create-tournament";
import { sessionHintKey } from "../infrastructure/api/session-hint";
import { createFakeLibraryServer } from "../test-utils/fake-library-server";
import { renderApplication } from "../test-utils/render-application";
import { installTestWebLocks } from "../test-utils/web-locks";
import { App } from "./app";

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
const teams = ["Norte", "Sur", "Este", "Oeste"];

beforeEach(() => {
  installTestWebLocks();
  localStorage.clear();
  localStorage.setItem(sessionHintKey, "1");
  vi.stubGlobal("crypto", { subtle: webcrypto.subtle, randomUUID });
  vi.stubGlobal("TextEncoder", TextEncoder);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

describe("centro de guardado con sesión (fase 5H)", () => {
  it("crea un punto en la cuenta y restaura la biblioteca de la cuenta desde él", async () => {
    const seed = new InMemoryTournamentRepository();
    createTournament({ name: "Liga de la cuenta", teamNames: teams, legs: 1, tieBreakers: ["goalDifference"] }, seed);
    const server = createFakeLibraryServer({ tournaments: seed.findAll(), activity: seed.findActivity(), libraryVersion: 1 });
    vi.stubGlobal("fetch", server.fetch);

    await renderApplication(<App />);
    expect((await screen.findAllByText("Liga de la cuenta")).length).toBeGreaterThan(0);
    const library = screen.queryByRole("button", { name: "Biblioteca" });
    if (library) fireEvent.click(library);
    fireEvent.click(await screen.findByRole("button", { name: "Centro de guardado y recuperación" }));
    const panel = await screen.findByRole("region", { name: "Puntos de control manuales" });

    expect(within(panel).getByText(/biblioteca de tu cuenta/)).toBeInTheDocument();
    expect(within(panel).queryByText(/El navegador puede borrar este almacenamiento/)).not.toBeInTheDocument();

    const name = within(panel).getByLabelText("Nombre del punto");
    fireEvent.change(name, { target: { value: "Punto de la cuenta" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Revisar punto de control" }));
    fireEvent.click(await within(panel).findByRole("button", { name: "Confirmar creación del punto" }));
    expect(await within(panel).findByText(/Punto «Punto de la cuenta» guardado y verificado/)).toBeInTheDocument();
    expect(server.checkpoints.size).toBe(1);
    const point = await within(panel).findByRole("article", { name: "Punto: Punto de la cuenta" });
    expect(within(point).queryByRole("button", { name: "Editar nombre y descripción" })).not.toBeInTheDocument();

    // Otro dispositivo agrega un torneo; restaurar el punto lo retira.
    const other = new InMemoryTournamentRepository();
    const extra = createTournament({ name: "Desde otro dispositivo", teamNames: teams, legs: 1, tieBreakers: ["goalDifference"] }, other);
    server.externalWrite(state => { state.tournaments = [extra, ...state.tournaments]; state.activity = [...state.activity, ...other.findActivity()]; });

    fireEvent.click(within(point).getByRole("button", { name: "Revisar restauración" }));
    const dialog = await screen.findByRole("dialog", { name: "Restaurar punto de control" });
    expect(within(dialog).getByText(/con sesión no hay copia automática de recuperación/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar reemplazo por el punto" }));

    // Se vuelve a mostrar la biblioteca restaurada (como al reabrirla) con el aviso general.
    expect(await screen.findByText("Biblioteca restaurada desde el punto de guardado de tu cuenta.")).toBeInTheDocument();
    expect(screen.queryByText("Desde otro dispositivo")).not.toBeInTheDocument();
    expect(server.state.tournaments.map(({ name: title }) => title)).toEqual(["Liga de la cuenta"]);
    expect(server.operations).toContain("restoreSaveCheckpoint");
    expect(screen.queryByRole("alert", { name: "Cambios externos en la biblioteca" })).not.toBeInTheDocument();
    expect(localStorage.getItem("cancha.tournaments")).toBeNull();
  });
});
