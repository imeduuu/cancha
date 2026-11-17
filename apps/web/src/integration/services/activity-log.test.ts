import { beforeEach, describe, expect, it } from "vitest";
import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { createTournamentBackup, parseTournamentBackupWithActivity } from "@cancha/core/application/services/tournament-archive";
import { createActivityEvent, saveWithActivity } from "@cancha/core/application/services/activity-log";
import { LocalStorageTournamentRepository } from "../../infrastructure/persistence/local-storage-tournament-repository";
import { updateMatchResult } from "@cancha/core/application/use-cases/update-match-result";
import { updateFixtureSchedule } from "@cancha/core/application/use-cases/update-fixture-schedule";
import { updateFixtureOperationalState } from "@cancha/core/application/use-cases/update-fixture-operational-state";
import { updateFixtureDetails } from "@cancha/core/application/use-cases/update-fixture-details";
import { updateTournamentRegulations } from "@cancha/core/application/use-cases/update-tournament-records";
import { calculateTournamentStatistics } from "@cancha/core/domain/services/tournament-statistics";
import { getCompletedStageWinners } from "@cancha/core/domain/services/official-cup-progression";
import { importTournamentArchive } from "@cancha/core/application/use-cases/import-tournament-archive";
import { createTournamentSeason } from "@cancha/core/application/use-cases/create-tournament-season";
import { duplicateTournament } from "@cancha/core/application/use-cases/manage-tournaments";

const storage = new Map<string, string>();
const tournament: Tournament = {
  id: "activity-cup-2026",
  competitionId: "activity-cup",
  name: "Copa Auditoría",
  season: 2026,
  teams: [{ id: "home", name: "Local" }, { id: "away", name: "Visita" }],
  legs: 1,
  tieBreakers: [],
  pointsSystem: { win: 3, draw: 1, loss: 0 },
  competitionType: "cup",
  format: "staged",
  knockoutStages: [{ name: "Final", legs: 1 }],
  matchdays: [{
    number: 1,
    leg: 1,
    phaseName: "Final",
    fixtures: [{ id: "final", homeTeamId: "home", awayTeamId: "away" }],
  }],
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
});

describe("activity audit", () => {
  it("refuses an audited write when the repository cannot coordinate tournament and activity persistence", () => {
    let saved = false;
    const repository = {
      save: () => { saved = true; },
      findAll: () => [],
    };
    const event = createActivityEvent(tournament, {
      action: "match-result-updated",
      summary: "Resultado actualizado",
    });

    expect(() => saveWithActivity(repository, tournament, event))
      .toThrow("no garantiza la escritura coordinada");
    expect(saved).toBe(false);
  });

  it("records successful result changes, suppresses retries, and preserves sporting calculations", () => {
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(tournament);
    const updated = updateMatchResult(tournament, "final", { homeGoals: 2, awayGoals: 1 }, repository);
    expect(repository.findActivity()).toHaveLength(1);
    expect(repository.findActivity()[0]).toMatchObject({
      action: "match-result-updated",
      tournamentId: tournament.id,
      season: 2026,
      entityId: "final",
      before: { result: null, knockoutResolution: null },
      after: { result: { homeGoals: 2, awayGoals: 1 }, knockoutResolution: null },
    });
    updateMatchResult(updated, "final", { homeGoals: 2, awayGoals: 1 }, repository);
    expect(repository.findActivity()).toHaveLength(1);
    expect(calculateTournamentStatistics(updated).totalGoals).toBe(3);
    expect(getCompletedStageWinners(updated.matchdays, updated.knockoutStages![0])).toEqual(["home"]);
  });

  it("does not record failed updates", () => {
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(tournament);
    expect(() => updateMatchResult(tournament, "final", { homeGoals: 101, awayGoals: 0 }, repository))
      .toThrow("Cada resultado");
    expect(repository.findActivity()).toEqual([]);
  });

  it("rolls back the saved tournament if persisting its audit event fails", () => {
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(tournament);
    const originalTournamentData = storage.get("cancha.tournaments");
    const originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (key, value) => {
      if (key === "cancha.activity") throw new Error("storage full");
      originalSetItem(key, value);
    };
    expect(() => updateMatchResult(
      tournament, "final", { homeGoals: 1, awayGoals: 0 }, repository,
    )).toThrow("No se pudo guardar el historial");
    expect(storage.get("cancha.tournaments")).toBe(originalTournamentData);
    expect(storage.get("cancha.activity")).toBeUndefined();
  });

  it("records programming, operational state, match details, and regulations from use cases", () => {
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(tournament);
    const scheduled = updateFixtureSchedule(tournament, "final", {
      date: "2026-10-16", time: "20:00",
    }, repository);
    const operational = updateFixtureOperationalState(
      scheduled, "final", "in-progress", "Horario confirmado", repository,
    );
    const rostered: Tournament = {
      ...operational,
      players: [
        { id: "h1", firstName: "Local", lastName: "Uno" },
        { id: "h2", firstName: "Local", lastName: "Dos" },
        { id: "a1", firstName: "Visita", lastName: "Uno" },
      ],
      playerRegistrations: [
        { playerId: "h1", teamId: "home" },
        { playerId: "h2", teamId: "home" },
        { playerId: "a1", teamId: "away" },
      ],
      matchRegulations: {
        schemaVersion: 1,
        season: 2026,
        verification: "pending",
        lineup: { requiredStarters: 1 },
      },
    };
    const details = updateFixtureDetails(rostered, "final", {
      lineups: {
        home: { starters: ["h1"], substitutes: ["h2"], status: "complete" },
        away: { starters: ["a1"], substitutes: [], status: "complete" },
      },
      substitutions: [{
        id: "sub-1", teamId: "home", playerOutId: "h1", playerInId: "h2", minute: 60,
      }],
      events: [{ id: "event-1", type: "goal", teamId: "home", playerName: "Local Uno" }],
    }, repository);
    const regulations = updateTournamentRegulations(details, {
      ...details,
      matchRegulations: {
        schemaVersion: 1,
        season: 2026,
        verification: "pending",
        notes: "Pendiente de revisión",
      },
    }, repository);
    expect(repository.findActivity().map(({ action }) => action)).toEqual([
      "match-schedule-updated",
      "match-operational-state-updated",
      "match-details-updated",
      "regulations-updated",
    ]);
    expect(repository.findActivity()[0].after).toEqual({ date: "2026-10-16", time: "20:00", provenance: "manual" });
    expect(repository.findActivity()[1].note).toBe("Horario confirmado");
    expect(regulations.matchdays[0].fixtures[0].events).toHaveLength(1);
    expect(repository.findActivity()[2].after).toMatchObject({
      lineups: rostered.matchdays[0].fixtures[0].lineups ?? expect.anything(),
      substitutions: [{ id: "sub-1" }],
      events: [{ id: "event-1" }],
    });
  });

  it("persists events across repository instances and round-trips them through v7 backups", () => {
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(tournament);
    updateMatchResult(tournament, "final", { homeGoals: 1, awayGoals: 0 }, repository);
    const activity = new LocalStorageTournamentRepository(false).findActivity();
    const backup = createTournamentBackup([repository.findAll()[0]], undefined, activity);
    const restored = parseTournamentBackupWithActivity(JSON.stringify(backup));
    expect(restored.tournaments).toHaveLength(1);
    expect(restored.activity).toHaveLength(1);
    expect(restored.activity[0].imported).toBe(true);
    const targetRepository = new LocalStorageTournamentRepository(false);
    targetRepository.importTournaments(restored.tournaments, "replace", restored.activity);
    expect(targetRepository.findActivity()).toHaveLength(2);
  });

  it("imports v6 backups without inventing events and rejects invalid event data", () => {
    const oldBackup = {
      format: "cancha-backup",
      version: 6,
      exportedAt: "2026-10-14T20:00:00.000Z",
      tournaments: [tournament],
    };
    expect(parseTournamentBackupWithActivity(JSON.stringify(oldBackup)).activity).toEqual([]);
    const malformed = { ...oldBackup, version: 7, activity: [{ id: "bad" }] };
    expect(() => parseTournamentBackupWithActivity(JSON.stringify(malformed)))
      .toThrow("historial del respaldo");
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(tournament);
    const existing = storage.get("cancha.tournaments");
    expect(() => repository.importTournaments(
      [tournament], "replace", [{ id: "bad" } as ActivityEvent],
    )).toThrow("historial contiene eventos inválidos");
    expect(storage.get("cancha.tournaments")).toBe(existing);
  });

  it("keeps deletion history as a snapshot without a live tournament reference", () => {
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(tournament);
    repository.deleteById(tournament.id);
    expect(repository.findAll()).toEqual([]);
    expect(repository.findActivity()[0]).toMatchObject({
      action: "tournament-deleted",
      tournamentId: tournament.id,
      tournamentName: tournament.name,
    });
  });

  it("marks an archive import rejection separately from a successful import", () => {
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(tournament);
    const conflicting = { ...tournament, name: "Conflictiva" };
    expect(() => importTournamentArchive(conflicting, "add", repository))
      .toThrow("Ya existe un torneo");
    expect(repository.findAll()[0].name).toBe(tournament.name);
    expect(repository.findActivity()).toMatchObject([{
      action: "tournament-import-rejected",
      outcome: "rejected",
    }]);
  });

  it("associates new-season and duplicate activity with the new tournament identity", () => {
    const repository = new LocalStorageTournamentRepository(false);
    const league: Tournament = {
      ...tournament,
      id: "league-2026",
      competitionId: "league",
      name: "Liga 2026",
      competitionType: "league",
      format: "round-robin",
      knockoutStages: undefined,
      season: 2026,
      matchdays: tournament.matchdays.map(({ phaseName: _phase, ...matchday }) => matchday),
    };
    repository.save(league);
    const season = createTournamentSeason(
      league,
      2027,
      repository,
      (() => {
        let id = 0;
        return () => `season-id-${++id}`;
      })(),
      () => new Date("2026-10-14T22:00:00.000Z"),
    );
    const duplicate = duplicateTournament(
      season,
      "reset",
      repository,
      () => new Date("2026-10-14T22:01:00.000Z"),
    );
    expect(repository.findActivity()).toMatchObject([
      { action: "season-created", tournamentId: season.id, season: 2027 },
      { action: "tournament-duplicated", tournamentId: duplicate.id, season: 2027 },
    ]);
    expect(duplicate.matchdays[0].fixtures[0].result).toBeUndefined();
  });
});
