import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { createTournament } from "@cancha/core/application/use-cases/create-tournament";
import { renameTournament } from "@cancha/core/application/use-cases/manage-tournaments";
import { simulateChampionship } from "@cancha/core/application/use-cases/simulate-championship";
import { recordRejectedImport } from "@cancha/core/application/services/activity-log";
import { createSportsUniverse, setTournamentUniverseAssignments } from "@cancha/core/application/services/sports-universes";
import { ApiNetworkError, ApiValidationError } from "../../infrastructure/api/graphql-client";
import { libraryChangedRemotelyMessage, SessionLibraryBackend } from "../../infrastructure/api/session-library-backend";
import { createFakeLibraryServer } from "../../test-utils/fake-library-server";

const input = (name: string) => ({ name, teamNames: ["Norte", "Sur", "Este", "Oeste"], legs: 1, tieBreakers: ["goalDifference" as const] });
const backends: SessionLibraryBackend[] = [];
async function open(server: ReturnType<typeof createFakeLibraryServer>) {
  const backend = await SessionLibraryBackend.load(server.api);
  backends.push(backend);
  return backend;
}
/** Igual que runWrite de app.tsx: la huella reconocida se toma dentro de la acción. */
async function write<T>(backend: SessionLibraryBackend, action: () => T): Promise<T> {
  return backend.coordinate(backend.snapshot(), action);
}

afterEach(() => { backends.splice(0).forEach(backend => backend.dispose()); });

describe("SessionLibraryBackend (fase 5G)", () => {
  it("ejecuta casos de uso reales sobre la réplica y confirma un commit por escritura", async () => {
    const server = createFakeLibraryServer();
    const backend = await open(server);
    expect(backend.snapshot()).toBe("servidor:v0");

    let acknowledged = "";
    const created = await write(backend, () => {
      const tournament = createTournament(input("Liga con sesión"), backend);
      acknowledged = backend.snapshot();
      return tournament;
    });
    // runWrite reconoce la huella leída dentro de la acción: debe coincidir con la confirmada.
    expect(acknowledged).toBe("servidor:v1");
    expect(backend.snapshot()).toBe(acknowledged);
    expect(server.state.libraryVersion).toBe(1);
    expect(server.state.tournaments.map(({ name }) => name)).toEqual(["Liga con sesión"]);

    await write(backend, () => simulateChampionship(backend.findAll()[0], "pendingOnly", backend));
    await write(backend, () => renameTournament(backend.findAll()[0], "Liga renombrada", backend));
    expect(server.state.libraryVersion).toBe(3);
    expect(server.state.tournaments[0]).toMatchObject({ id: created.id, name: "Liga renombrada" });
    expect(backend.findAll()).toEqual(server.state.tournaments);
    expect(backend.findActivity()).toEqual(server.state.activity);

    // Otra réplica cargada después ve exactamente lo mismo.
    const other = await open(server);
    expect(other.findAll()).toEqual(backend.findAll());
    expect(server.operations.filter(operation => operation === "commitLibraryChanges")).toHaveLength(3);
  });

  it("sin cambios no hay petición; una acción que lanza no envía nada", async () => {
    const server = createFakeLibraryServer();
    const backend = await open(server);
    await write(backend, () => backend.findAll());
    await expect(write(backend, () => { createTournament(input("A medias"), backend); throw new Error("Falló la acción."); }))
      .rejects.toThrow("Falló la acción.");
    expect(server.operations).toEqual(["librarySnapshot"]);
    expect(backend.findAll()).toEqual([]);
  });

  it("las escrituras fuera de coordinate se rechazan; el torneo activo es una preferencia local", async () => {
    const server = createFakeLibraryServer();
    const backend = await open(server);
    const created = await write(backend, () => createTournament(input("Activo"), backend));
    expect(() => createTournament(input("Fuera"), backend)).toThrow(/escritura coordinada/);
    const serverActive = server.state.activeTournamentId;
    backend.setActiveTournamentId(created.id);
    expect(backend.getActiveTournamentId()).toBe(created.id);
    expect(server.state.activeTournamentId).toBe(serverActive);
    expect(backend.snapshot()).toBe("servidor:v1");
    expect(server.operations.filter(operation => operation === "commitLibraryChanges")).toHaveLength(1);
  });

  it("dos dispositivos: el que escribe con una versión vieja recibe el aviso, se recarga y no escribe", async () => {
    const server = createFakeLibraryServer();
    const first = await open(server);
    const second = await open(server);
    const changed = vi.fn();
    second.subscribeExternalChanges(changed);

    await write(first, () => createTournament(input("Del primero"), first));
    const acknowledged = second.snapshot();
    await expect(second.coordinate(acknowledged, () => createTournament(input("Del segundo"), second)))
      .rejects.toThrow(libraryChangedRemotelyMessage);

    expect(server.state.tournaments.map(({ name }) => name)).toEqual(["Del primero"]);
    expect(second.findAll().map(({ name }) => name)).toEqual(["Del primero"]);
    expect(second.snapshot()).not.toBe(acknowledged);
    expect(changed).toHaveBeenCalled();
    // Con la huella actual vuelve a poder escribir.
    await write(second, () => createTournament(input("Del segundo"), second));
    expect(server.state.tournaments).toHaveLength(2);
  });

  it("checkForRemoteChanges recarga y avisa cuando otro dispositivo escribió", async () => {
    const server = createFakeLibraryServer();
    const backend = await open(server);
    const changed = vi.fn();
    backend.subscribeExternalChanges(changed);
    expect(await backend.checkForRemoteChanges()).toBe(false);
    server.externalWrite(state => { state.activeTournamentId = null; });
    expect(await backend.checkForRemoteChanges()).toBe(true);
    expect(backend.snapshot()).toBe("servidor:v1");
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("un error de red o de validación no cambia la réplica ni el servidor", async () => {
    const server = createFakeLibraryServer();
    const backend = await open(server);
    server.failNext(new ApiNetworkError());
    await expect(write(backend, () => createTournament(input("Sin red"), backend))).rejects.toThrow(/Los cambios no se guardaron/);
    server.failNext(new ApiValidationError("No se guardaron los cambios: motivo del servidor.", "VALIDATION"));
    await expect(write(backend, () => createTournament(input("Rechazado"), backend))).rejects.toThrow("motivo del servidor");
    expect(backend.findAll()).toEqual([]);
    expect(backend.snapshot()).toBe("servidor:v0");
    expect(server.state.libraryVersion).toBe(0);
  });

  it("las restauraciones van por restoreBackup y la réplica adopta lo del servidor", async () => {
    const server = createFakeLibraryServer();
    const backend = await open(server);
    const kept = await write(backend, () => createTournament(input("Existente"), backend));
    const source = createFakeLibraryServer();
    const sourceBackend = await open(source);
    const incoming: Tournament = await write(sourceBackend, () => createTournament(input("Del respaldo"), sourceBackend));

    await write(backend, () => backend.importTournaments([incoming], "merge", sourceBackend.findActivity()));
    expect(server.operations).toContain("restoreBackup:MERGE");
    expect(server.operations.filter(operation => operation === "commitLibraryChanges")).toHaveLength(1);
    expect(backend.findAll().map(({ name }) => name).sort()).toEqual(["Del respaldo", "Existente"]);
    expect(backend.findAll()).toEqual(server.state.tournaments);

    await write(backend, () => backend.importTournaments([incoming], "replace", []));
    expect(server.operations).toContain("restoreBackup:REPLACE");
    expect(backend.findAll().map(({ id }) => id)).toEqual([incoming.id]);
    expect(backend.findAll().some(({ id }) => id === kept.id)).toBe(false);
    expect(backend.snapshot()).toBe(`servidor:v${server.state.libraryVersion}`);
  });

  it("un rechazo de importación se registra con la acción exenta", async () => {
    const server = createFakeLibraryServer();
    const backend = await open(server);
    await write(backend, () => recordRejectedImport(backend, "Archivo dañado."));
    expect(server.state.activity).toEqual([expect.objectContaining({ action: "tournament-import-rejected", tournamentId: "library" })]);
  });

  it("los universos viajan en el envío; la reatribución la deriva el servidor", async () => {
    const server = createFakeLibraryServer();
    const backend = await open(server);
    const created = await write(backend, () => createTournament(input("Con universo"), backend));
    await write(backend, () => {
      const library = createSportsUniverse(backend.getSportsUniverseLibrary(), "Partida", "");
      const universeId = library.universes[0].id;
      backend.setSportsUniverseLibrary(setTournamentUniverseAssignments(
        library, [created.id], universeId, backend.findAll(), backend.findActivity(),
      ));
    });
    const last = server.commits.at(-1) as Record<string, unknown>;
    expect(last).toHaveProperty("universes");
    expect(last).not.toHaveProperty("activityUniverseIds");
    const universeId = server.state.universes.universes[0].id;
    expect(server.state.universes.assignments).toEqual({ [created.id]: universeId });
    expect(server.state.activity.every(event => event.tournamentId !== created.id || event.universeId === universeId)).toBe(true);
    expect(backend.findActivity()).toEqual(server.state.activity);
  });
});
