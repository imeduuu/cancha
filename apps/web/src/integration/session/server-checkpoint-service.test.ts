import { afterEach, describe, expect, it, vi } from "vitest";
import { checkpointMetadata, CheckpointValidationError } from "@cancha/core/application/services/save-checkpoints";
import { createTournament } from "@cancha/core/application/use-cases/create-tournament";
import { renameTournament } from "@cancha/core/application/use-cases/manage-tournaments";
import { SessionLibraryBackend } from "../../infrastructure/api/session-library-backend";
import type { ServerCheckpointRow } from "../../infrastructure/api/server-checkpoint-service";
import { createFakeLibraryServer } from "../../test-utils/fake-library-server";

const input = (name: string) => ({ name, teamNames: ["Norte", "Sur", "Este", "Oeste"], legs: 1, tieBreakers: ["goalDifference" as const] });
const backends: SessionLibraryBackend[] = [];
afterEach(() => { backends.splice(0).forEach(backend => backend.dispose()); });

async function setup() {
  const server = createFakeLibraryServer();
  const backend = await SessionLibraryBackend.load(server.api);
  backends.push(backend);
  const write = <T,>(action: () => T) => backend.coordinate(backend.snapshot(), action);
  const original = await write(() => createTournament(input("Liga original"), backend));
  const onRestored = vi.fn();
  const service = backend.createCheckpointService(onRestored);
  return { server, backend, write, original, onRestored, service };
}

async function createPoint(service: Awaited<ReturnType<typeof setup>>["service"], name = "Antes de cambiar") {
  return service.confirmCreation(await service.reviewCreation(name, "Descripción"), true);
}

describe("ServerCheckpointService (fase 5H)", () => {
  it("crea un punto en la cuenta; la lista tiene la forma que valida el panel", async () => {
    const { server, service } = await setup();
    const review = await service.reviewCreation("Antes de cambiar", "Descripción");
    expect(review.checkpoint).toMatchObject({ name: "Antes de cambiar", tournamentCount: 1 });
    const created = await service.confirmCreation(review, true);

    expect(server.checkpoints.size).toBe(1);
    const rows = await service.list();
    expect(rows).toHaveLength(1);
    expect(checkpointMetadata(rows[0])).toMatchObject({ id: created.id, name: "Antes de cambiar", revision: 1, backupVersion: 7 });
    await expect(service.verify(created.id)).resolves.toMatchObject({ id: created.id });
    expect(JSON.parse((await service.download(created.id)).content)).toMatchObject({ format: "cancha-backup", version: 7 });
    expect(service.location).toBe("server");
    expect(service.canEdit).toBe(false);
    await expect(service.edit("id", {}, "nombre", "")).rejects.toThrow(/todavía no se pueden editar/);
  });

  it("una revisión de creación queda obsoleta si la biblioteca cambia", async () => {
    const { backend, write, original, service } = await setup();
    const review = await service.reviewCreation("Obsoleto");
    await write(() => renameTournament(original, "Otro nombre", backend));
    await expect(service.confirmCreation(review, true)).rejects.toThrow(/obsoleta/);
  });

  it("revisar → confirmar restaura la biblioteca de la cuenta y recarga la réplica", async () => {
    const { server, backend, write, original, service, onRestored } = await setup();
    const point = await createPoint(service);
    await write(() => renameTournament(original, "Renombrada", backend));
    await write(() => createTournament(input("Posterior"), backend));

    const review = await service.reviewRestoration(point.id);
    expect(review.comparison).toMatchObject({ sharedTournamentIds: [original.id], changedTournamentIds: [original.id] });
    expect(review.comparison.currentOnlyIds).toHaveLength(1);

    await expect(service.confirmRestoration(review, true)).resolves.toEqual({ added: 1, skipped: 0 });
    expect(server.state.tournaments.map(({ name }) => name)).toEqual(["Liga original"]);
    expect(backend.findAll()).toEqual(server.state.tournaments);
    expect(backend.snapshot()).toBe(`servidor:v${server.state.libraryVersion}`);
    expect(onRestored).toHaveBeenCalledTimes(1);
    await expect(service.confirmRestoration(review, true)).rejects.toThrow(/obsoleta o ya fue utilizada/);
  });

  it("si la biblioteca cambió desde la vista previa, no restaura nada", async () => {
    const { server, backend, write, original, service, onRestored } = await setup();
    const point = await createPoint(service);
    const review = await service.reviewRestoration(point.id);
    await write(() => renameTournament(original, "Cambio posterior", backend));
    const before = structuredClone(server.state);

    await expect(service.confirmRestoration(review, true)).rejects.toThrow(/cambiaron desde la revisión/);
    expect(server.state).toEqual(before);
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("si el punto se eliminó desde la vista previa, no restaura nada", async () => {
    const { server, service } = await setup();
    const point = await createPoint(service);
    const review = await service.reviewRestoration(point.id);
    server.checkpoints.delete(point.id);
    await expect(service.confirmRestoration(review, true)).rejects.toThrow(/fue eliminado/);
  });

  it("eliminar exige la versión vigente del punto", async () => {
    const { server, service } = await setup();
    const point = await createPoint(service);
    const [row] = await service.list() as ServerCheckpointRow[];
    await expect(service.delete(point.id, { ...row, version: 99 }, true)).rejects.toThrow(/El punto cambió/);
    await service.delete(point.id, row, true);
    expect(server.checkpoints.size).toBe(0);
  });

  it("un punto alterado en el servidor no pasa la verificación", async () => {
    const { server, service } = await setup();
    const point = await createPoint(service);
    const entry = server.checkpoints.get(point.id)!;
    entry.record = { ...entry.record, content: entry.record.content.replace("Liga original", "Liga alterada") };
    const failure = await service.verify(point.id).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CheckpointValidationError);
    expect(failure).toMatchObject({ status: "Inválido" });
  });
});
