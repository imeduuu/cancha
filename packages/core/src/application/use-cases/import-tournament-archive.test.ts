import { describe, expect, it, vi } from "vitest";
import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { importTournamentArchive } from "./import-tournament-archive";

const tournament: Tournament = {
  id: "league-2026",
  name: "Liga 2026",
  teams: [
    { id: "team-a", name: "Club A" },
    { id: "team-b", name: "Club B" },
  ],
  legs: 1,
  tieBreakers: [],
  matchdays: [{
    number: 1,
    leg: 1,
    fixtures: [{
      id: "fixture-a",
      homeTeamId: "team-a",
      awayTeamId: "team-b",
    }],
  }],
  createdAt: "2026-01-01T00:00:00.000Z",
};

function createRepository(initial: readonly Tournament[] = []): TournamentRepository {
  let saved = [...initial];
  const save = vi.fn((value: Tournament) => {
    saved = [value, ...saved.filter(({ id }) => id !== value.id)];
  });
  return {
    findAll: () => [...saved],
    save,
    saveWithActivity: vi.fn((value: Tournament) => save(value)),
    recordActivity: vi.fn(),
  };
}

describe("importTournamentArchive", () => {
  it("does not modify persistence when the user cancels", () => {
    const repository = createRepository([tournament]);
    expect(importTournamentArchive(tournament, "cancel", repository)).toBeNull();
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.findAll()).toEqual([tournament]);
  });

  it("requires explicit copy or update when the identifier already exists", () => {
    const repository = createRepository([tournament]);
    expect(() => importTournamentArchive(tournament, "add", repository))
      .toThrow("Ya existe un torneo");
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects a new ID for an already saved competition and season without changing the library", () => {
    const saved = { ...tournament, id: "league-copy-id", competitionId: "regional-league", season: 2026 };
    const imported = { ...tournament, id: "league-file-id", competitionId: "regional-league", season: 2026 };
    const repository = createRepository([saved]);

    expect(() => importTournamentArchive(imported, "add", repository))
      .toThrow(/regional-league.*temporada 2026|regional-league.*2026/i);
    expect(repository.findAll()).toEqual([saved]);
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.saveWithActivity).not.toHaveBeenCalled();
  });

  it("allows the same competition in a different season and different competitions in one season", () => {
    const saved = { ...tournament, competitionId: "league", season: 2026 };
    const repository = createRepository([saved]);

    expect(importTournamentArchive({
      ...tournament,
      id: "league-2027",
      competitionId: "league",
      season: 2027,
    }, "add", repository)?.season).toBe(2027);
    expect(importTournamentArchive({
      ...tournament,
      id: "cup-2026",
      competitionId: "cup",
      season: 2026,
    }, "add", repository)?.competitionId).toBe("cup");
  });

  it("allows separate divisions with different competition identities in the same season", () => {
    const northDivision = {
      ...tournament,
      id: "division-north-2026",
      competitionId: "division-north",
      season: 2026,
    };
    const southDivision = {
      ...tournament,
      id: "division-south-2026",
      competitionId: "division-south",
      season: 2026,
    };
    const repository = createRepository([northDivision]);

    expect(importTournamentArchive(southDivision, "add", repository)?.id)
      .toBe("division-south-2026");
  });

  it("allows explicit updates and independent copies of a competition season", () => {
    const saved = { ...tournament, competitionId: "league", season: 2026 };
    const repository = createRepository([saved]);
    const updated = importTournamentArchive({ ...saved, name: "Actualizada" }, "update", repository);
    expect(updated?.name).toBe("Actualizada");
    expect(repository.findAll()).toHaveLength(1);

    let nextId = 0;
    const copied = importTournamentArchive(saved, "copy", repository, () => `copy-${++nextId}`);
    expect(copied?.competitionId).not.toBe("league");
    expect(repository.findAll()).toHaveLength(2);
  });

  it("does not infer competition identity when legacy archives omit identity fields", () => {
    const saved = { ...tournament, id: "legacy-saved", competitionId: "league", season: 2026 };
    const imported = { ...tournament, id: "legacy-import", competitionId: undefined, season: 2026 };
    const repository = createRepository([saved]);

    expect(importTournamentArchive(imported, "add", repository)?.id).toBe("legacy-import");
  });

  it("copies the tournament with remapped identifiers and unchanged results", () => {
    const repository = createRepository([tournament]);
    let next = 0;
    const copied = importTournamentArchive(tournament, "copy", repository, () => `new-${++next}`);

    expect(copied).toMatchObject({
      id: "new-3",
      name: "Liga 2026 (copia)",
      teams: [{ id: "new-1" }, { id: "new-2" }],
      matchdays: [{
        fixtures: [{ id: "new-4", homeTeamId: "new-1", awayTeamId: "new-2" }],
      }],
    });
    expect(repository.findAll().map(({ id }) => id)).toEqual(["new-3", "league-2026"]);
  });

  it("updates only the explicitly selected tournament ID", () => {
    const previous = { ...tournament, name: "Nombre anterior" };
    const repository = createRepository([previous]);
    const changed = { ...tournament, name: "Nombre importado" };

    const updated = importTournamentArchive(changed, "update", repository);
    expect(updated?.name).toBe("Nombre importado");
    expect(repository.findAll()).toEqual([changed]);
  });
});
