// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStorageTournamentRepository } from "../infrastructure/persistence/local-storage-tournament-repository";
import { renderApplication } from "../test-utils/render-application";
import { installTestWebLocks } from "../test-utils/web-locks";
import { App } from "./app";

beforeEach(() => { installTestWebLocks(); localStorage.clear(); });
afterEach(cleanup);

describe("App con un backend de biblioteca inyectado (fase 5E)", () => {
  it("lee la biblioteca y escribe a través del backend recibido", async () => {
    const backend = new LocalStorageTournamentRepository(true);
    const read = vi.spyOn(backend, "findAllWithRecoveryReport");
    const coordinate = vi.spyOn(backend, "coordinate");

    await renderApplication(<App libraryBackend={backend} />);

    expect(await screen.findByRole("heading", { name: "Biblioteca de torneos" })).toBeInTheDocument();
    expect(read).toHaveBeenCalled();
    // Sin torneos guardados no hay nada que preparar al abrir: ninguna escritura.
    expect(coordinate).not.toHaveBeenCalled();
  });
});
