import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { Tournament } from "../../domain/entities/tournament";
import {
  createScopedTournamentRepository,
  activityInUniverse,
  createSportsUniverse,
  deleteSportsUniverse,
  renameSportsUniverse,
  setTournamentUniverseAssignments,
  tournamentsInUniverse,
  validateSportsUniverseRelations,
} from "./sports-universes";
import { buildClubProfiles } from "./club-history";
import { createTournamentBackup, parseTournamentBackupWithActivity } from "./tournament-archive";

const source: Tournament = {
  id: "season-old",
  competitionId: "league",
  season: 2025,
  name: "Liga",
  teams: [{ id: "team", name: "Club" }],
  legs: 1,
  tieBreakers: [],
  matchdays: [],
  createdAt: "2025-01-01T00:00:00.000Z",
};

const derived: Tournament = {
  ...source,
  id: "season-new",
  season: 2026,
  name: "Liga nueva",
  seasonPreparation: {
    schemaVersion: 1,
    sourceTournamentIds: [source.id],
    plannedParticipants: ["Club"],
    calendarReviews: [],
  },
};

function libraryWithUniverses() {
  const first = createSportsUniverse(
    { version: 1, activeUniverseId: null, universes: [], assignments: {} },
    "Partida",
    "Primera",
    () => "universe-a",
  );
  const second = createSportsUniverse(
    first,
    "Histórica",
    "",
    () => "universe-b",
  );
  return { first, second };
}

describe("sports universes", () => {
  it("keeps all legacy tournaments visible and unassigned until the user organizes them", () => {
    const oldLibrary = { version: 1 as const, activeUniverseId: null, universes: [], assignments: {} };
    expect(tournamentsInUniverse([source, derived], oldLibrary)).toEqual([source, derived]);
    expect(oldLibrary.assignments).toEqual({});
  });

  it("validates create, rename, delete, and preserves tournaments when deleting a universe", () => {
    const { first, second } = libraryWithUniverses();
    const assigned = setTournamentUniverseAssignments(
      first,
      [source.id],
      "universe-a",
      [source],
      [],
    );
    const renamed = renameSportsUniverse(assigned, "universe-a", "Partida editada", "Descripción");
    expect(renamed.universes[0]).toEqual({
      id: "universe-a",
      name: "Partida editada",
      description: "Descripción",
    });
    const deleted = deleteSportsUniverse(renamed, "universe-a");
    expect(deleted.universes).toEqual([]);
    expect(deleted.assignments).toEqual({});
    expect(tournamentsInUniverse([source], deleted)).toEqual([source]);
    expect(() => renameSportsUniverse(second, "universe-a", "Histórica", ""))
      .toThrow('Ya existe un universo llamado "Histórica".');
  });

  it("requires related seasons to remain together and scopes their club identities by tournament ID", () => {
    const { second } = libraryWithUniverses();
    expect(() => setTournamentUniverseAssignments(
      second,
      [derived.id],
      "universe-a",
      [source, derived],
      [],
    )).toThrow(/Incorpora o retira juntas/);
    const together = setTournamentUniverseAssignments(
      { ...second, activeUniverseId: "universe-a" },
      [source.id, derived.id],
      "universe-a",
      [source, derived],
      [],
    );
    expect(tournamentsInUniverse([source, derived], together).map(({ id }) => id))
      .toEqual([source.id, derived.id]);
    expect(tournamentsInUniverse([source, derived], together, null)).toEqual([]);

    expect(() => setTournamentUniverseAssignments(
      together,
      [derived.id],
      "universe-b",
      [source, derived],
      [],
    )).toThrow(/mantiene una relación con/);
  });

  it("rejects foreign writes and stale scoped repositories", () => {
    const other = { ...source, id: "another-season", name: "Otra liga" };
    const { second } = libraryWithUniverses();
    const assigned = setTournamentUniverseAssignments(
      { ...second, activeUniverseId: "universe-a" },
      [source.id],
      "universe-a",
      [source, other],
      [],
    );
    let saved: Tournament | undefined;
    const repository = {
      findAll: () => [source, other],
      save: (tournament: Tournament) => { saved = tournament; },
    };
    const scoped = createScopedTournamentRepository(
      repository,
      "universe-a",
      () => assigned,
    );
    expect(() => scoped.save(other)).toThrow(/no pertenece al universo activo/);
    expect(saved).toBeUndefined();

    const stale = createScopedTournamentRepository(
      repository,
      "universe-a",
      () => ({ ...assigned, activeUniverseId: "universe-b" }),
    );
    expect(() => stale.save(source)).toThrow(/universo activo cambió/);
    expect(saved).toBeUndefined();
  });

  it("rejects a library that assigns related seasons to different universes", () => {
    const { second } = libraryWithUniverses();
    const split = {
      ...second,
      assignments: {
        [source.id]: "universe-a",
        [derived.id]: "universe-b",
      },
    };
    expect(() => validateSportsUniverseRelations(split, [source, derived], []))
      .toThrow(/mantiene una relación con/);
    expect(() => createTournamentBackup([source, derived], undefined, [], split))
      .toThrow(/mantiene una relación con/);
  });

  it("scopes historical events to their recorded universe without inferring identity from names", () => {
    const { second } = libraryWithUniverses();
    const assigned = setTournamentUniverseAssignments(
      { ...second, activeUniverseId: "universe-a" },
      [source.id],
      "universe-a",
      [source],
      [],
    );
    const events: ActivityEvent[] = [
      { id: "a-event", occurredAt: "2026-01-01T00:00:00.000Z", action: "matches-simulated",
        tournamentId: source.id, tournamentName: source.name, summary: "Partida A", universeId: "universe-a" },
      { id: "b-event", occurredAt: "2026-01-01T00:00:00.000Z", action: "matches-simulated",
        tournamentId: "other", tournamentName: source.name, summary: "Partida B", universeId: "universe-b" },
      { id: "legacy", occurredAt: "2026-01-01T00:00:00.000Z", action: "matches-simulated",
        tournamentId: source.id, tournamentName: source.name, summary: "Antigua" },
    ];
    const ids = new Set(tournamentsInUniverse([source], assigned).map(({ id }) => id));
    expect(activityInUniverse(events, ids, "universe-a").map(({ id }) => id)).toEqual(["a-event", "legacy"]);
    expect(activityInUniverse(events, new Set(), "universe-b").map(({ id }) => id)).toEqual(["b-event"]);
  });

  it("does not merge ambiguous local club IDs or identity tokens across universes", () => {
    const sameLocalClub = {
      ...source,
      id: "another-tournament",
      teams: [{ id: "team", name: "Club", averageIdentity: "historical-token" }],
    };
    const { second } = libraryWithUniverses();
    const grouped = setTournamentUniverseAssignments(
      second,
      [source.id],
      "universe-a",
      [source, sameLocalClub],
      [],
    );
    const fullyGrouped = {
      ...grouped,
      assignments: { ...grouped.assignments, [sameLocalClub.id]: "universe-b" },
    };
    expect(tournamentsInUniverse([source, sameLocalClub], grouped, "universe-a"))
      .toEqual([source]);
    expect(tournamentsInUniverse([source, sameLocalClub], grouped, null))
      .toEqual([sameLocalClub]);
    const repo = createScopedTournamentRepository(
      { findAll: () => [source, sameLocalClub], save: () => undefined },
      "universe-a",
      () => fullyGrouped,
    );
    expect(repo.findAll().map(({ id }) => id)).toEqual([source.id]);
    expect(buildClubProfiles(repo.findAll())).toHaveLength(1);
    const otherScope = createScopedTournamentRepository(
      { findAll: () => [source, sameLocalClub], save: () => undefined },
      "universe-b",
      () => fullyGrouped,
    );
    expect(buildClubProfiles(otherScope.findAll())).toHaveLength(1);
  });

  it("round-trips optional universe metadata in v7 and rejects dangling tournament assignments", () => {
    const { second } = libraryWithUniverses();
    const assigned = setTournamentUniverseAssignments(
      { ...second, activeUniverseId: "universe-a" },
      [source.id],
      "universe-a",
      [source],
      [],
    );
    const backup = createTournamentBackup([source], undefined, [], assigned);
    expect(backup.version).toBe(7);
    expect(parseTournamentBackupWithActivity(JSON.stringify(backup)).universes).toEqual(assigned);
    expect(() => createTournamentBackup([source], undefined, [], {
      ...assigned,
      assignments: { "missing-tournament": "universe-a" },
    })).toThrow("Los datos de universos deportivos no son válidos.");
    expect(parseTournamentBackupWithActivity(JSON.stringify({
      format: "cancha-backup",
      version: 7,
      exportedAt: "2026-01-01T00:00:00.000Z",
      tournaments: [source],
      activity: [],
    })).universes).toBeUndefined();
  });
});
