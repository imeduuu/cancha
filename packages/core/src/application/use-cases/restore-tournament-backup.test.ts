import { describe, expect, it, vi } from "vitest";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { TournamentLibraryRepository } from "../ports/tournament-repository";
import { createTournamentBackup } from "../services/tournament-archive";
import { contractTournament } from "../../test-utils/tournament-repository-contract";
import { restoreTournamentBackup } from "./restore-tournament-backup";

function repository(importTournaments?: TournamentLibraryRepository["importTournaments"]) {
  const recorded: ActivityEvent[] = [];
  const repo: TournamentLibraryRepository = {
    findAll: () => [],
    save: () => {},
    recordActivity: event => { recorded.push(event); },
    deleteById: () => {},
    getActiveTournamentId: () => null,
    setActiveTournamentId: () => {},
    ...(importTournaments ? { importTournaments } : {}),
  };
  return { repo, recorded };
}

const backup = () => JSON.stringify(createTournamentBackup([contractTournament("a")], () => new Date("2026-05-01T00:00:00.000Z")));

describe("restoreTournamentBackup", () => {
  it("parsea el respaldo y delega en importTournaments con el modo y el historial", () => {
    const importTournaments = vi.fn(() => ({ added: 1, skipped: 0 }));
    const { repo } = repository(importTournaments);

    expect(restoreTournamentBackup(backup(), "replace", repo)).toEqual({ added: 1, skipped: 0 });
    expect(importTournaments).toHaveBeenCalledWith([expect.objectContaining({ id: "a" })], "replace", []);
  });

  it("un archivo ilegible se rechaza sin escribir nada", () => {
    const importTournaments = vi.fn();
    const { repo, recorded } = repository(importTournaments);

    expect(() => restoreTournamentBackup("{ no es json", "merge", repo)).toThrow();
    expect(() => restoreTournamentBackup(JSON.stringify({ format: "cancha-backup", version: 99, tournaments: [] }), "merge", repo))
      .toThrow();
    expect(importTournaments).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
  });

  it("si la restauración falla, registra el rechazo y relanza", () => {
    const { repo, recorded } = repository(() => { throw new Error("No se modificó el almacenamiento."); });

    expect(() => restoreTournamentBackup(backup(), "merge", repo)).toThrow("No se modificó el almacenamiento.");
    expect(recorded).toEqual([expect.objectContaining({ action: "tournament-import-rejected", outcome: "rejected", tournamentId: "a" })]);
  });

  it("rechaza un modo desconocido o un repositorio sin restauración", () => {
    expect(() => restoreTournamentBackup(backup(), "otro" as "merge", repository(vi.fn()).repo))
      .toThrow("Elige si el respaldo se agrega o reemplaza la biblioteca.");
    expect(() => restoreTournamentBackup(backup(), "merge", repository().repo))
      .toThrow("este almacenamiento no permite restaurar respaldos");
  });
});
