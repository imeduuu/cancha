import { describe, expect, it } from "vitest";
import { createActivityEvent } from "./activity-log";
import { createTournamentBackup, parseTournamentBackupWithActivity } from "./tournament-archive";
import { closureLeague } from "../../test-utils/season-closure-fixtures";
import {
  CheckpointValidationError,
  checkpointContent,
  createSaveCheckpoint,
  verifySaveCheckpoint,
  type CheckpointLibrary,
} from "./save-checkpoints";

const league = closureLeague("liga-punto");
const library: CheckpointLibrary = {
  tournaments: [league],
  activity: [createActivityEvent(league, { action: "regulations-updated", entityType: "tournament", summary: "Cambio." })],
};
const options = { now: () => new Date("2026-05-01T12:00:00.000Z"), createId: () => "punto-1" };

describe("puntos de guardado sin universos (servidor)", () => {
  it("checkpointContent es el respaldo v7 con sangría de la biblioteca, sin universos", () => {
    const content = checkpointContent(library, "2026-05-01T12:00:00.000Z");
    expect(content).toBe(JSON.stringify(createTournamentBackup(library.tournaments, () => new Date("2026-05-01T12:00:00.000Z"), library.activity), null, 2));
    expect(parseTournamentBackupWithActivity(content).universes).toBeUndefined();
  });

  it("createSaveCheckpoint arma un registro válido y verificable", async () => {
    const checkpoint = await createSaveCheckpoint(library, "  Antes del cierre ", "Copia previa", options);
    expect(checkpoint).toMatchObject({
      id: "punto-1", name: "Antes del cierre", description: "Copia previa", revision: 1,
      createdAt: "2026-05-01T12:00:00.000Z", tournamentCount: 1, universeCount: 0, activityCount: 1,
      integrity: { algorithm: "SHA-256" },
    });
    expect(checkpoint.sizeBytes).toBe(new TextEncoder().encode(checkpoint.content).byteLength);
    await expect(verifySaveCheckpoint(checkpoint)).resolves.toEqual(checkpoint);
  });

  it("valida el nombre antes de leer nada", async () => {
    await expect(createSaveCheckpoint(library, "   ", "", options)).rejects.toThrow(/Nombre: es obligatorio/);
    await expect(createSaveCheckpoint(library, "x".repeat(121), "", options)).rejects.toThrow(/no puede superar 120/);
  });

  it("verifySaveCheckpoint rechaza contenido alterado, metadatos incoherentes y registros incompletos", async () => {
    const checkpoint = await createSaveCheckpoint(library, "Punto", "", options);
    const tampered = { ...checkpoint, content: checkpoint.content.replace("Cambio.", "Otro..") };
    await expect(verifySaveCheckpoint(tampered)).rejects.toThrow("La huella SHA-256 no coincide");
    await expect(verifySaveCheckpoint({ ...checkpoint, tournamentCount: 5 })).rejects.toThrow("no coincide con los metadatos");
    await expect(verifySaveCheckpoint({ ...checkpoint, backupVersion: 6 })).rejects.toBeInstanceOf(CheckpointValidationError);
    await expect(verifySaveCheckpoint(null)).rejects.toThrow("El registro del punto está incompleto.");
  });
});
