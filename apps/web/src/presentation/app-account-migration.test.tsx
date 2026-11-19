// @vitest-environment jsdom
import { randomUUID, webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryTournamentRepository } from "@cancha/core/application/services/in-memory-library";
import { createTournament } from "@cancha/core/application/use-cases/create-tournament";
import { sessionHintKey } from "../infrastructure/api/session-hint";
import { LocalStorageTournamentRepository } from "../infrastructure/persistence/local-storage-tournament-repository";
import { migrationMarkerKey } from "../infrastructure/persistence/local-library-migration";
import { createFakeLibraryServer, fakeSessionUser } from "../test-utils/fake-library-server";
import { installTestWebLocks } from "../test-utils/web-locks";
import { App } from "./app";
import { migrationCheckpointName } from "./components/account-migration";

const teams = ["Norte", "Sur", "Este", "Oeste"];
const input = (name: string) => ({ name, teamNames: teams, legs: 1, tieBreakers: ["goalDifference" as const] });
const marker = migrationMarkerKey(fakeSessionUser.id);
/** Los ids de torneo salen de la hora de creación: cada torneo sembrado tiene la suya. */
let clock = Date.parse("2026-01-01T00:00:00.000Z");
const nextInstant = () => new Date(clock += 1000);

/** Todo lo de este navegador salvo la pista de sesión y la marca de migración. */
function localLibraryBytes(): string {
  return JSON.stringify(Object.keys(localStorage).filter(key => key !== sessionHintKey && key !== marker).sort()
    .map(key => [key, localStorage.getItem(key)]));
}

function seedLocal(...names: string[]) {
  const repository = new LocalStorageTournamentRepository(false);
  names.forEach(name => createTournament(input(name), repository, nextInstant));
}

function server(...accountNames: string[]) {
  const seed = new InMemoryTournamentRepository();
  accountNames.forEach(name => createTournament(input(name), seed, nextInstant));
  const fake = createFakeLibraryServer({ tournaments: seed.findAll(), activity: seed.findActivity(), libraryVersion: accountNames.length });
  vi.stubGlobal("fetch", fake.fetch);
  return fake;
}

async function prompt() {
  return screen.findByRole("region", { name: "Biblioteca de este navegador" });
}

beforeEach(() => {
  installTestWebLocks();
  localStorage.clear();
  vi.stubGlobal("crypto", { subtle: webcrypto.subtle, randomUUID });
  vi.stubGlobal("TextEncoder", TextEncoder);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function signIn() { localStorage.setItem(sessionHintKey, "1"); }

describe("migrar la biblioteca de este navegador a la cuenta (fase 5I)", () => {
  it("con la cuenta vacía, sube la biblioteca local sin modificarla", async () => {
    seedLocal("Liga local A", "Liga local B");
    const before = localLibraryBytes();
    const fake = server();
    signIn();
    const user = userEvent.setup();
    render(<App />);

    const region = await prompt();
    expect(region).toHaveTextContent("Este navegador tiene 2 torneos");
    expect(region).toHaveTextContent("Tu cuenta tiene 0 torneos");
    await user.click(within(region).getByRole("button", { name: "Subir a mi cuenta" }));

    expect(await within(region).findByRole("status")).toHaveTextContent("Se agregó a tu cuenta: 2 torneos");
    expect(fake.state.tournaments.map(({ name }) => name).sort()).toEqual(["Liga local A", "Liga local B"]);
    expect(fake.operations).toContain("restoreBackup:MERGE");
    expect(localLibraryBytes()).toBe(before);
    expect(JSON.parse(localStorage.getItem(marker)!)).toMatchObject({ mode: "merge", tournaments: 2, added: 2, skipped: 0 });

    await user.click(within(region).getByRole("button", { name: "Abrir la biblioteca de mi cuenta" }));
    // Con torneos, la aplicación termina abriendo el torneo activo (su botón "Biblioteca" lo confirma):
    // se espera ese estado final y se vuelve a la biblioteca, en vez de leer la pantalla intermedia.
    await user.click(await screen.findByRole("button", { name: "Biblioteca" }));
    expect((await screen.findAllByText("Liga local A")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Liga local B").length).toBeGreaterThan(0);
  });

  it("«Ahora no» abre la cuenta sin migrar y vuelve a preguntar en el próximo ingreso", async () => {
    seedLocal("Liga local");
    const before = localLibraryBytes();
    const fake = server("Liga de la cuenta");
    signIn();
    const user = userEvent.setup();
    render(<App />);

    await user.click(within(await prompt()).getByRole("button", { name: "Ahora no" }));
    expect((await screen.findAllByText("Liga de la cuenta")).length).toBeGreaterThan(0);
    expect(fake.state.tournaments.map(({ name }) => name)).toEqual(["Liga de la cuenta"]);
    expect(localStorage.getItem(marker)).toBeNull();
    expect(localLibraryBytes()).toBe(before);

    cleanup();
    render(<App />);
    expect(await prompt()).toBeInTheDocument();
  });

  it("con datos en la cuenta, «Agregar» conserva ambos", async () => {
    seedLocal("Liga local");
    const fake = server("Liga de la cuenta");
    signIn();
    const user = userEvent.setup();
    render(<App />);
    const region = await prompt();
    expect(within(region).queryByRole("button", { name: "Subir a mi cuenta" })).not.toBeInTheDocument();
    await user.click(within(region).getByRole("button", { name: "Agregar a mi cuenta" }));

    await within(region).findByRole("status");
    expect(fake.state.tournaments.map(({ name }) => name).sort()).toEqual(["Liga de la cuenta", "Liga local"]);
  });

  it("«Reemplazar» exige confirmar y guarda antes un punto de la cuenta", async () => {
    seedLocal("Liga local");
    const before = localLibraryBytes();
    const fake = server("Liga de la cuenta");
    signIn();
    const user = userEvent.setup();
    render(<App />);
    const region = await prompt();
    const replace = within(region).getByRole("button", { name: "Reemplazar con la de este navegador" });
    expect(replace).toBeDisabled();
    await user.click(within(region).getByRole("checkbox"));
    await user.click(replace);

    expect(await within(region).findByRole("status")).toHaveTextContent("Se reemplazó la biblioteca de tu cuenta: 1 torneos");
    expect(fake.state.tournaments.map(({ name }) => name)).toEqual(["Liga local"]);
    const [point] = [...fake.checkpoints.values()];
    expect(point.record.name).toBe(migrationCheckpointName);
    expect(point.record.content).toContain("Liga de la cuenta");
    expect(fake.operations.indexOf("createSaveCheckpoint")).toBeLessThan(fake.operations.indexOf("restoreBackup:REPLACE"));
    expect(localLibraryBytes()).toBe(before);
    expect(JSON.parse(localStorage.getItem(marker)!)).toMatchObject({ mode: "replace" });
  });

  it("si otro dispositivo cambió la cuenta, «Reemplazar» no escribe la biblioteca ni la marca", async () => {
    seedLocal("Liga local");
    const fake = server("Liga de la cuenta");
    signIn();
    const user = userEvent.setup();
    render(<App />);
    const region = await prompt();
    const other = new InMemoryTournamentRepository();
    const extra = createTournament(input("De otro dispositivo"), other, nextInstant);
    fake.externalWrite(state => { state.tournaments = [extra, ...state.tournaments]; state.activity = [...state.activity, ...other.findActivity()]; });

    await user.click(within(region).getByRole("checkbox"));
    await user.click(within(region).getByRole("button", { name: "Reemplazar con la de este navegador" }));

    expect(await within(region).findByRole("alert")).toHaveTextContent(/cambió en otra pestaña o dispositivo/);
    expect(fake.state.tournaments.map(({ name }) => name)).toEqual(["De otro dispositivo", "Liga de la cuenta"]);
    expect(localStorage.getItem(marker)).toBeNull();
    expect(region).toHaveTextContent("Tu cuenta tiene 2 torneos");
  });

  it("con la marca no vuelve a preguntar; sin biblioteca local tampoco", async () => {
    seedLocal("Liga local");
    server("Liga de la cuenta");
    localStorage.setItem(marker, JSON.stringify({ mode: "merge" }));
    signIn();
    render(<App />);
    expect((await screen.findAllByText("Liga de la cuenta")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("region", { name: "Biblioteca de este navegador" })).not.toBeInTheDocument();
  });

  it("con datos locales dañados no ofrece migrar una copia incompleta", async () => {
    seedLocal("Liga local");
    const stored = JSON.parse(localStorage.getItem("cancha.tournaments")!) as unknown[];
    localStorage.setItem("cancha.tournaments", JSON.stringify([...stored, { id: "dañado", name: "Sin datos" }]));
    const before = localLibraryBytes();
    server();
    signIn();
    render(<App />);
    const region = await prompt();
    expect(within(region).getByRole("alert")).toHaveTextContent("tiene datos dañados");
    expect(within(region).queryByRole("button", { name: "Subir a mi cuenta" })).not.toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Ahora no" })).toBeInTheDocument();
    expect(localLibraryBytes()).toBe(before);
  });
});
