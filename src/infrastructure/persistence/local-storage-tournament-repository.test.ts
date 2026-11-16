import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { Tournament } from "../../domain/entities/tournament";
import { LocalStorageTournamentRepository } from "./local-storage-tournament-repository";
import {
  createSportsUniverse,
  deleteSportsUniverse,
  setTournamentUniverseAssignments,
} from "../../application/services/sports-universes";

const storageKey = "cancha.tournaments";
const activeTournamentKey = "cancha.activeTournamentId";
const recoveryStorageKey = "cancha.recovery";

describe("LocalStorageTournamentRepository", () => {
  let storedValues: Map<string, string>;

  beforeEach(() => {
    storedValues = new Map();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storedValues.get(key) ?? null,
        setItem: (key: string, value: string) => storedValues.set(key, value),
        removeItem: (key: string) => storedValues.delete(key),
      },
    });
  });

  it("persists and restores event verification and official team numbering", () => {
    const tournament: Tournament = {
      id: "copa-liga",
      name: "Copa de la Liga 2026",
      teams: [
        { id: "a", name: "Club A", competitionNumber: 1 },
        { id: "b", name: "Club B", competitionNumber: 2 },
      ],
      legs: 1,
      tieBreakers: [],
      matchdays: [{
        number: 1,
        leg: 1,
        fixtures: [{
          id: "match",
          homeTeamId: "a",
          awayTeamId: "b",
          events: [],
          eventsCoverage: "complete",
        }],
      }],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    new LocalStorageTournamentRepository(false).save(tournament);
    const restored = new LocalStorageTournamentRepository(false).findAll()[0];
    expect(restored.teams.map(({ competitionNumber }) => competitionNumber)).toEqual([1, 2]);
    expect(restored.matchdays[0].fixtures[0].eventsCoverage).toBe("complete");

  });

  it("keeps universe assignments in recovery snapshots and does not delete tournaments with their universe", () => {
    const tournament: Tournament = {
      id: "universe-season",
      name: "Season",
      teams: [{ id: "club", name: "Club" }],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const replacement = { ...tournament, id: "replacement", name: "Replacement" };
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(tournament);
    const initial = createSportsUniverse(
      repository.getSportsUniverseLibrary(),
      "Partida",
      "",
      () => "universe",
    );
    repository.setSportsUniverseLibrary(setTournamentUniverseAssignments(
      initial,
      [tournament.id],
      "universe",
      [tournament],
      [],
    ));

    repository.importTournaments([replacement], "replace");
    expect(repository.getRecoverySnapshotStatus().available).toBe(true);
    repository.restoreRecoverySnapshot();
    expect(repository.findAll().map(({ id }) => id)).toEqual([tournament.id]);
    expect(repository.getSportsUniverseLibrary().assignments).toEqual({
      [tournament.id]: "universe",
    });

    repository.deleteById(tournament.id);
    expect(repository.findAll()).toEqual([]);
    expect(repository.getSportsUniverseLibrary().assignments).toEqual({});
    expect(repository.findActivity().at(-1)?.universeId).toBe("universe");
    repository.setSportsUniverseLibrary(deleteSportsUniverse(
      repository.getSportsUniverseLibrary(),
      "universe",
    ));
    expect(repository.findActivity().at(-1)?.universeId).toBeUndefined();
  });

  it("rejects cross-universe relations both in local edits and restored backups", () => {
    const source: Tournament = {
      id: "linked-source",
      name: "Liga origen",
      season: 2025,
      teams: [{ id: "club", name: "Club" }],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2025-01-01T00:00:00.000Z",
    };
    const derived: Tournament = {
      ...source,
      id: "linked-derived",
      name: "Liga derivada",
      season: 2026,
      seasonPreparation: {
        schemaVersion: 1,
        sourceTournamentIds: [source.id],
        plannedParticipants: ["Club"],
        calendarReviews: [],
      },
    };
    const split = {
      version: 1 as const,
      activeUniverseId: "universe-a",
      universes: [
        { id: "universe-a", name: "Partida A" },
        { id: "universe-b", name: "Partida B" },
      ],
      assignments: {
        [source.id]: "universe-a",
        [derived.id]: "universe-b",
      },
    };
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(source);
    repository.save(derived);

    expect(() => repository.setSportsUniverseLibrary(split))
      .toThrow(/mantiene una relación con/);
    expect(() => repository.importTournaments([source, derived], "replace", [], true, split))
      .toThrow(/mantiene una relación con/);
    expect(repository.findAll().map(({ id }) => id)).toEqual([derived.id, source.id]);
    expect(repository.getSportsUniverseLibrary().universes).toEqual([]);
  });

  it("loads legacy fixtures without event coverage as unverified", () => {
    const legacy: Tournament = {
      id: "legacy",
      name: "Torneo anterior",
      teams: [{ id: "a", name: "Club A" }, { id: "b", name: "Club B" }],
      legs: 1,
      tieBreakers: [],
      matchdays: [{ number: 1, leg: 1, fixtures: [{ id: "m", homeTeamId: "a", awayTeamId: "b" }] }],
      createdAt: "2025-01-01T00:00:00.000Z",
    };
    storedValues.set(storageKey, JSON.stringify([legacy]));
    expect(new LocalStorageTournamentRepository(false).findAll()[0].matchdays[0].fixtures[0].eventsCoverage)
      .toBeUndefined();
  });

  it("updates official placement rules without changing saved match results", () => {
    storedValues.set(storageKey, JSON.stringify([
      {
        id: "anfp-liga-primera-2026",
        name: "Primera",
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
            id: "fixture-1",
            homeTeamId: "team-a",
            awayTeamId: "team-b",
            result: { homeGoals: 2, awayGoals: 1 },
          }],
        }],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "anfp-liga-de-ascenso-2026",
        name: "Primera B",
        teams: [],
        legs: 1,
        tieBreakers: [],
        matchdays: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        placementRules: {
          championPlaces: 1,
          playoffPlaces: { from: 2, to: 8 },
          relegationPlaces: 2,
        },
      },
      {
        id: "anfp-liga-segunda-descenso-2026",
        name: "Segunda · Zona de Descenso",
        teams: [],
        legs: 1,
        tieBreakers: [],
        matchdays: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        placementRules: { relegationPlaces: 1 },
      },
    ]));

    const tournaments = new LocalStorageTournamentRepository(false).findAll();

    expect(tournaments[0].placementRules).toEqual({
      championPlaces: 1,
      relegationPlaces: 2,
    });
    expect(tournaments[0].matchdays[0].fixtures[0].result).toEqual({
      homeGoals: 2,
      awayGoals: 1,
    });
    expect(tournaments[0].competitionRules?.verification).toEqual({
      standings: "pending",
      placements: "provisional",
    });
    expect(tournaments[0].pointsSystem).toEqual({ win: 3, draw: 1, loss: 0 });
    expect(tournaments[1].placementRules?.relegationPlaces).toBe(1);
    expect(tournaments[2].placementRules?.relegationPlaces).toBe(2);
    expect(JSON.parse(storedValues.get(storageKey) ?? "[]")).toHaveLength(3);
  });

  it("merges backup tournaments without duplicating IDs and keeps existing conflicts", () => {
    const existing = {
      id: "saved",
      name: "Torneo guardado",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    storedValues.set(storageKey, JSON.stringify([existing]));
    storedValues.set(activeTournamentKey, "saved");
    const repository = new LocalStorageTournamentRepository(false);
    const result = repository.importTournaments([
      { ...existing, name: "Versión del respaldo" },
      { ...existing, id: "new", name: "Torneo nuevo" },
    ], "merge");

    expect(result).toEqual({ added: 1, skipped: 1 });
    expect(repository.findAll().map(({ id, name }) => [id, name])).toEqual([
      ["new", "Torneo nuevo"],
      ["saved", "Torneo guardado"],
    ]);
    expect(repository.getActiveTournamentId()).toBe("saved");
  });

  it("merges full backups by ID without applying single-archive competition-season uniqueness", () => {
    const existing = {
      id: "league-saved",
      competitionId: "league",
      season: 2026,
      name: "Liga guardada",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    storedValues.set(storageKey, JSON.stringify([existing]));
    const repository = new LocalStorageTournamentRepository(false);

    expect(repository.importTournaments([{
      ...existing,
      id: "league-from-backup",
      name: "Liga del respaldo",
    }], "merge")).toEqual({ added: 1, skipped: 0 });
    expect(repository.findAll().map(({ id }) => id)).toEqual([
      "league-from-backup",
      "league-saved",
    ]);
  });

  it("restores a legacy backup without assigning its tournaments to old universes", () => {
    const repository = new LocalStorageTournamentRepository(false);
    const existing: Tournament = {
      id: "legacy-existing",
      name: "Biblioteca anterior",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    repository.save(existing);
    const library = createSportsUniverse(
      repository.getSportsUniverseLibrary(),
      "Partida",
      "",
      () => "legacy-universe",
    );
    repository.setSportsUniverseLibrary(setTournamentUniverseAssignments(
      library,
      [existing.id],
      library.activeUniverseId,
      [existing],
      [],
    ));

    const legacy: Tournament = { ...existing, id: "restored-legacy", name: "Respaldo antiguo" };
    expect(repository.importTournaments([legacy], "replace")).toEqual({ added: 1, skipped: 0 });
    expect(repository.findAll().map(({ id }) => id)).toEqual([legacy.id]);
    expect(repository.getSportsUniverseLibrary()).toMatchObject({
      activeUniverseId: null,
      universes: [],
      assignments: {},
    });
  });

  it("replaces the stored library only after validating the complete backup", () => {
    const existing = {
      id: "saved",
      name: "Torneo guardado",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const replacement = { ...existing, id: "restored", name: "Restaurado" };
    storedValues.set(storageKey, JSON.stringify([existing]));
    const repository = new LocalStorageTournamentRepository(false);
    expect(repository.importTournaments([replacement], "replace"))
      .toEqual({ added: 1, skipped: 0 });
    expect(repository.findAll().map(({ id }) => id)).toEqual(["restored"]);
    expect(repository.getActiveTournamentId()).toBe("restored");

    const beforeFailure = storedValues.get(storageKey);
    expect(() => repository.importTournaments([
      replacement,
      { ...replacement, id: "invalid", createdAt: "no-es-fecha" },
    ], "replace")).toThrow("Fecha de creación");
    expect(storedValues.get(storageKey)).toBe(beforeFailure);
  });

  it("keeps a validated local recovery copy before replacement and restores it transactionally", () => {
    const existing = {
      id: "existing",
      name: "Existente",
      teams: [{ id: "home", name: "Local" }, { id: "away", name: "Visita" }],
      legs: 1,
      tieBreakers: [],
      matchdays: [{
        number: 1,
        leg: 1,
        fixtures: [{ id: "fixture", homeTeamId: "home", awayTeamId: "away" }],
      }],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const replacement = {
      ...existing,
      id: "replacement",
      name: "Reemplazo",
      matchdays: [],
    };
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(existing);

    repository.importTournaments([replacement], "replace");

    expect(repository.hasRecoverableSnapshot()).toBe(true);
    expect(JSON.parse(storedValues.get(recoveryStorageKey) ?? "{}"))
      .toMatchObject({ version: 1, tournaments: [{ id: "existing" }] });
    expect(repository.restoreRecoverySnapshot()).toEqual({ added: 1, skipped: 0 });
    expect(repository.findAll().map(({ id }) => id)).toEqual(["existing"]);
    expect(repository.hasRecoverableSnapshot()).toBe(false);
  });

  it("does not offer or alter a recovery snapshot whose tournaments have duplicate IDs", () => {
    const tournament = {
      id: "duplicate",
      name: "Torneo",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const originalTournaments = JSON.stringify([tournament, { ...tournament, name: "Otro" }]);
    const snapshot = JSON.stringify({
      version: 1,
      createdAt: "2026-06-01T00:00:00.000Z",
      tournaments: [tournament, { ...tournament, name: "Otro" }],
      activity: [],
      replacedWith: {
        tournaments: originalTournaments,
        activity: "[]",
        activeTournamentId: null,
      },
    });
    storedValues.set(storageKey, originalTournaments);
    storedValues.set("cancha.activity", "[]");
    storedValues.set(recoveryStorageKey, snapshot);
    const repository = new LocalStorageTournamentRepository(false);

    expect(repository.getRecoverySnapshotStatus()).toMatchObject({
      available: false,
      warning: expect.stringContaining("identificadores duplicados"),
    });
    expect(repository.hasRecoverableSnapshot()).toBe(false);
    expect(storedValues.get(recoveryStorageKey)).toBe(snapshot);
    expect(storedValues.get(storageKey)).toBe(originalTournaments);
    expect(() => repository.restoreRecoverySnapshot())
      .toThrow("identificadores duplicados");
    expect(storedValues.get(recoveryStorageKey)).toBe(snapshot);
  });

  it("does not create a restorable snapshot from a duplicate-ID library during replacement", () => {
    const tournament = {
      id: "duplicate",
      name: "Torneo",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const original = JSON.stringify([tournament, { ...tournament, name: "Otro" }]);
    const previousRecovery = "snapshot-anterior-no-validado";
    storedValues.set(storageKey, original);
    storedValues.set(recoveryStorageKey, previousRecovery);
    const repository = new LocalStorageTournamentRepository(false);

    repository.importTournaments([{ ...tournament, id: "valid" }], "replace");

    expect(repository.hasRecoverableSnapshot()).toBe(false);
    expect(storedValues.get(recoveryStorageKey)).toBe(previousRecovery);
    expect(repository.findAll().map(({ id }) => id)).toEqual(["valid"]);
  });

  it("returns the exact original stored string for recovery export, including invalid records", () => {
    const original = '[{"id":"valid"},{"id":"broken","teams":"invalid"}]';
    storedValues.set(storageKey, original);

    expect(new LocalStorageTournamentRepository(false).readRawTournamentDataForRecovery())
      .toBe(original);
  });

  it("does not offer an outdated recovery copy after later changes", () => {
    const existing = {
      id: "existing",
      name: "Existente",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const replacement = { ...existing, id: "replacement", name: "Reemplazo" };
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(existing);
    repository.importTournaments([replacement], "replace");
    expect(repository.hasRecoverableSnapshot()).toBe(true);

    repository.save({ ...replacement, name: "Edición posterior" });

    expect(repository.hasRecoverableSnapshot()).toBe(false);
    expect(() => repository.restoreRecoverySnapshot())
      .toThrow("No hay una copia recuperable vigente");
    expect(repository.findAll()[0].name).toBe("Edición posterior");
  });

  it("invalidates a recovery copy after the active tournament selection changes", () => {
    const existing = {
      id: "existing",
      name: "Existente",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const replacement = { ...existing, id: "replacement", name: "Reemplazo" };
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(existing);
    repository.importTournaments([replacement], "replace");
    expect(repository.hasRecoverableSnapshot()).toBe(true);

    repository.setActiveTournamentId(null);

    expect(repository.hasRecoverableSnapshot()).toBe(false);
  });

  it("rolls the tournament collection back if saving the restored active selection fails", () => {
    const existing = {
      id: "existing",
      name: "Existente",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    storedValues.set(storageKey, JSON.stringify([existing]));
    storedValues.set(activeTournamentKey, "existing");
    const previousSerialized = storedValues.get(storageKey);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storedValues.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (key === activeTournamentKey) throw new Error("storage unavailable");
          storedValues.set(key, value);
        },
        removeItem: (key: string) => storedValues.delete(key),
      },
    });
    const repository = new LocalStorageTournamentRepository(false);

    expect(() => repository.importTournaments([{
      ...existing,
      id: "restored",
      name: "Restaurado",
    }], "replace")).toThrow("No se pudo guardar la selección");
    expect(storedValues.get(storageKey)).toBe(previousSerialized);
    expect(storedValues.get(activeTournamentKey)).toBe("existing");
  });

  it("refuses merge over corrupt records but allows a validated explicit replacement", () => {
    const repository = new LocalStorageTournamentRepository(false);
    const invalidSaved = JSON.stringify([{ id: "broken", name: "Dañado" }]);
    storedValues.set(storageKey, invalidSaved);
    const valid = {
      id: "valid",
      name: "Válido",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    expect(() => repository.importTournaments([valid], "merge"))
      .toThrow("hay un torneo existente con datos dañados");
    expect(storedValues.get(storageKey)).toBe(invalidSaved);
    expect(repository.importTournaments([valid], "replace")).toEqual({ added: 1, skipped: 0 });
    expect(repository.findAll().map(({ id }) => id)).toEqual(["valid"]);
    storedValues.set(storageKey, "[]");
    expect(() => repository.importTournaments([valid, valid], "merge"))
      .toThrow('identificador "valid" está duplicado');
    expect(storedValues.get(storageKey)).toBe("[]");
  });

  it("preserves optional qualification and average configurations while legacy records remain valid", () => {
    storedValues.set(storageKey, JSON.stringify([{
      id: "league-custom-2026",
      name: "Liga configurada",
      teams: [{ id: "team-a", name: "Club A", averageIdentity: "club-a" }],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      competitionRules: {
        season: 2026,
        verification: { standings: "verified", placements: "verified" },
        internationalQualification: {
          verification: "verified",
          slots: [{ destination: "conmebol-libertadores", position: 1 }],
          cupChampions: [{ sourceTournamentId: "cup-2026", destination: "conmebol-libertadores" }],
          reallocation: "next-eligible-position",
        },
        relegationAverage: {
          verification: "pending",
          seasons: [2024, 2025, 2026],
          relegatedCount: 2,
          tieBreakers: ["goalDifference"],
        },
      },
    }]));

    const [tournament] = new LocalStorageTournamentRepository(false).findAll();
    expect(tournament.teams[0].averageIdentity).toBe("club-a");
    expect(tournament.competitionRules?.internationalQualification?.slots[0].destination)
      .toBe("conmebol-libertadores");
    expect(tournament.competitionRules?.relegationAverage).toEqual({
      verification: "pending",
      seasons: [2024, 2025, 2026],
      relegatedCount: 2,
      tieBreakers: ["goalDifference"],
    });
  });

  it("migrates previously imported Argentine teams to their official zones", () => {
    storedValues.set(storageKey, JSON.stringify([{
      id: "arg-liga-profesional-2026",
      name: "Liga Profesional Argentina 2026",
      teams: [
        { id: "boca", name: "Boca Juniors" },
        { id: "river", name: "River Plate" },
      ],
      legs: 2,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    }]));

    const [tournament] = new LocalStorageTournamentRepository(false).findAll();

    expect(tournament.teams.map(({ groupName }) => groupName)).toEqual(["Zona A", "Zona B"]);
    expect(tournament.placementRules).toMatchObject({
      championPlaces: 1,
      libertadoresPlaces: { from: 2, to: 2 },
      libertadoresQualifyingPlaces: { from: 3, to: 3 },
      sudamericanaPlaces: { from: 4, to: 9 },
      relegationPlaces: 1,
    });
    expect(tournament.competitionRules?.verification.standings).toBe("pending");
  });

  it("repairs legacy Copa do Brasil penalty fields that conflict with the match score", () => {
    storedValues.set(storageKey, JSON.stringify([{
      id: "cbf-copa-do-brasil-2026",
      name: "Copa do Brasil Profissional 2026",
      teams: [
        { id: "team-a", name: "Clube A" },
        { id: "team-b", name: "Clube B" },
      ],
      legs: 1,
      tieBreakers: [],
      matchdays: [{
        number: 1,
        leg: 1,
        phaseName: "Copa do Brasil · 1ª Fase",
        fixtures: [{
          id: "legacy-invalid-penalties",
          homeTeamId: "team-a",
          awayTeamId: "team-b",
          knockoutResolution: "penalties",
          result: {
            homeGoals: 2,
            awayGoals: 1,
            penalties: { homeGoals: 2, awayGoals: 4 },
          },
        }],
      }],
      createdAt: "2026-01-01T00:00:00.000Z",
    }]));

    const repository = new LocalStorageTournamentRepository(false);
    const [tournament] = repository.findAll();

    expect(tournament.matchdays[0].fixtures[0].result).toEqual({
      homeGoals: 2,
      awayGoals: 1,
    });
    expect(JSON.parse(storedValues.get(storageKey) ?? "[]")[0].matchdays[0].fixtures[0].result)
      .toEqual({ homeGoals: 2, awayGoals: 1 });
    expect(() => repository.save(tournament)).not.toThrow();
  });

  it("removes penalties from previously imported continental first legs", () => {
    storedValues.set(storageKey, JSON.stringify([{
      id: "conmebol-libertadores-2026",
      name: "Copa Libertadores",
      teams: [
        { id: "team-a", name: "Equipo A" },
        { id: "team-b", name: "Equipo B" },
      ],
      legs: 2,
      tieBreakers: [],
      competitionType: "cup",
      knockoutStages: [{ name: "Copa Libertadores · Octavos de final", legs: 2 }],
      matchdays: [
        {
          number: 1,
          leg: 1,
          phaseName: "Copa Libertadores · Octavos de final · Ida",
          fixtures: [{
            id: "first-leg",
            homeTeamId: "team-a",
            awayTeamId: "team-b",
            knockoutResolution: "penalties",
            result: { homeGoals: 0, awayGoals: 0 },
          }],
        },
        {
          number: 1,
          leg: 2,
          phaseName: "Copa Libertadores · Octavos de final · Vuelta",
          fixtures: [{
            id: "return-leg",
            homeTeamId: "team-b",
            awayTeamId: "team-a",
            knockoutResolution: "aggregate-then-penalties",
          }],
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
    }]));

    const repository = new LocalStorageTournamentRepository(false);
    const [tournament] = repository.findAll();

    expect(tournament.matchdays[0].fixtures[0].knockoutResolution).toBeUndefined();
    expect(tournament.matchdays[1].fixtures[0].knockoutResolution)
      .toBe("aggregate-then-penalties");
    expect(() => repository.save(tournament)).not.toThrow();
  });

  it("migrates saved direct-penalty results without blocking future saves", () => {
    storedValues.set(storageKey, JSON.stringify([{
        id: "arg-liga-profesional-2026",
        name: "Liga Profesional Argentina 2026",
        teams: [
          { id: "belgrano", name: "Belgrano (Córdoba)" },
          { id: "argentinos", name: "Argentinos Juniors" },
        ],
        legs: 1,
        tieBreakers: [],
        matchdays: [{
          number: 1,
          leg: 1,
          phaseName: "Torneo Apertura · Semifinales",
          fixtures: [{
            id: "direct-penalties",
            homeTeamId: "belgrano",
            awayTeamId: "argentinos",
            knockoutResolution: "extra-time-then-penalties",
            result: {
              homeGoals: 1,
              awayGoals: 1,
              penalties: { homeGoals: 4, awayGoals: 3 },
            },
          }],
        }],
        createdAt: "2026-01-01T00:00:00.000Z",
    }]));

    const repository = new LocalStorageTournamentRepository(false);
    const [tournament] = repository.findAll();
    const fixture = tournament.matchdays[0].fixtures[0];

    expect(fixture.knockoutResolution).toBe("penalties");
    expect(fixture.result?.penalties).toEqual({ homeGoals: 4, awayGoals: 3 });
    expect(() => repository.save(tournament)).not.toThrow();
  });

  it("persists tournament-level official format notes", () => {
    const repository = new LocalStorageTournamentRepository(false);
    repository.save({
      id: "cbf-copa-do-brasil-2026",
      name: "Copa do Brasil Profissional 2026",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      rulesNote: "Las fases se importan desde la CBF.",
    });

    expect(repository.findAll()[0].rulesNote).toBe("Las fases se importan desde la CBF.");
  });

  it("persists return-leg penalties awarded from an aggregate draw", () => {
    const repository = new LocalStorageTournamentRepository(false);
    repository.save({
      id: "anfp-copa-chile-2026",
      name: "Copa Chile 2026",
      teams: [
        { id: "team-a", name: "Club A" },
        { id: "team-b", name: "Club B" },
      ],
      legs: 2,
      tieBreakers: [],
      matchdays: [
        {
          number: 1,
          leg: 1,
          phaseName: "Copa Chile · Octavos de final · Ida",
          fixtures: [{
            id: "first-leg",
            homeTeamId: "team-a",
            awayTeamId: "team-b",
            result: { homeGoals: 1, awayGoals: 0 },
          }],
        },
        {
          number: 1,
          leg: 2,
          phaseName: "Copa Chile · Octavos de final · Vuelta",
          fixtures: [{
            id: "return-leg",
            homeTeamId: "team-b",
            awayTeamId: "team-a",
            knockoutResolution: "aggregate-then-penalties",
            result: {
              homeGoals: 1,
              awayGoals: 0,
              penalties: { homeGoals: 4, awayGoals: 3 },
            },
          }],
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const tournament = repository.findAll()[0];
    const returnLeg = tournament.matchdays.find(
      ({ phaseName }) => phaseName === "Copa Chile · Octavos de final · Vuelta",
    );
    expect(returnLeg?.fixtures[0]).toMatchObject({
      knockoutResolution: "aggregate-then-penalties",
      result: {
        homeGoals: 1,
        awayGoals: 0,
        penalties: { homeGoals: 4, awayGoals: 3 },
      },
    });
  });

  it("migrates saved Copa Chile knockout rounds to ida and vuelta phases", () => {
    storedValues.set(storageKey, JSON.stringify([{
      id: "anfp-copa-chile-2026",
      name: "Copa Chile Coca-Cola Zero Azúcar 2026",
      teams: [
        { id: "team-a", name: "Coquimbo Unido" },
        { id: "team-b", name: "Cobreloa" },
      ],
      legs: 1,
      tieBreakers: [],
      matchdays: [
        {
          number: 1,
          leg: 1,
          phaseName: "Copa Chile · Grupo A",
          fixtures: [{
            id: "group-match",
            homeTeamId: "team-a",
            awayTeamId: "team-b",
          }],
        },
        {
          number: 1,
          leg: 2,
          phaseName: "Copa Chile · Octavos de final",
          fixtures: [
            {
              id: "first-leg",
              homeTeamId: "team-a",
              awayTeamId: "team-b",
              result: { homeGoals: 1, awayGoals: 0 },
            },
            {
              id: "return-leg",
              homeTeamId: "team-b",
              awayTeamId: "team-a",
              knockoutResolution: "aggregate-then-penalties",
              result: {
                homeGoals: 1,
                awayGoals: 0,
                penalties: { homeGoals: 4, awayGoals: 3 },
              },
            },
          ],
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
    }]));

    const [tournament] = new LocalStorageTournamentRepository(false).findAll();

    expect(tournament.matchdays.map(({ phaseName, leg, fixtures }) => [
      phaseName,
      leg,
      fixtures.length,
    ])).toEqual([
      ["Copa Chile · Grupo A", 1, 1],
      ["Copa Chile · Octavos de final · Ida", 2, 1],
      ["Copa Chile · Octavos de final · Vuelta", 3, 1],
      ["Copa Chile · Cuartos de final · Ida", 4, 0],
      ["Copa Chile · Cuartos de final · Vuelta", 5, 0],
      ["Copa Chile · Semifinales · Ida", 6, 0],
      ["Copa Chile · Semifinales · Vuelta", 7, 0],
      ["Copa Chile · Final", 8, 0],
    ]);
    expect(tournament.matchdays[2].fixtures[0]).toMatchObject({
      knockoutResolution: "aggregate-then-penalties",
    });
    expect(tournament.competitionType).toBe("cup");
    expect(tournament.rulesNote).toContain("semifinales");
  });

  it("recovers valid tournaments beside a corrupt record without deleting or rewriting it", () => {
    const validTournament = {
      id: "valid-league",
      name: "Valid League",
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
    const corruptedTournament = { id: "broken-league", name: "Broken", teams: "not-an-array" };
    const initialValue = JSON.stringify([validTournament, corruptedTournament]);
    storedValues.set(storageKey, initialValue);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const repository = new LocalStorageTournamentRepository(false);
    const report = repository.findAllWithRecoveryReport();
    expect(report.tournaments.map(({ id }) => id)).toEqual(["valid-league"]);
    expect(report.warnings[0]).toContain('"Broken". El formato de los datos no es válido.');
    expect(storedValues.get(storageKey)).toBe(initialValue);
    expect(warning).toHaveBeenCalledOnce();

    repository.save({
      id: "another-league",
      name: "Another League",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const afterSave = JSON.parse(storedValues.get(storageKey) ?? "[]");
    expect(afterSave.map((value: { id: string }) => value.id)).toEqual([
      "another-league",
      "valid-league",
      "broken-league",
    ]);
    warning.mockRestore();
  });

  it("reports and excludes every locally stored tournament with a duplicate ID without rewriting storage", () => {
    const duplicateId = "duplicate-league";
    const first = {
      id: duplicateId,
      name: "Primera versión",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const second = { ...first, name: "Segunda versión" };
    const untouched = { ...first, id: "unaffected", name: "Otro torneo" };
    const original = JSON.stringify([first, second, untouched]);
    storedValues.set(storageKey, original);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const report = new LocalStorageTournamentRepository(false).findAllWithRecoveryReport();

    expect(report.tournaments.map(({ id }) => id)).toEqual(["unaffected"]);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain(duplicateId);
    expect(storedValues.get(storageKey)).toBe(original);
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it("rejects a save when locally stored IDs are duplicated and preserves the exact JSON", () => {
    const first = {
      id: "duplicate-league",
      name: "Primera versión",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const original = JSON.stringify([first, { ...first, name: "Segunda versión" }]);
    storedValues.set(storageKey, original);

    expect(() => new LocalStorageTournamentRepository(false).save({
      ...first,
      id: "unrelated",
      name: "Torneo nuevo",
    })).toThrow("identificadores de torneo duplicados");
    expect(storedValues.get(storageKey)).toBe(original);
  });

  it("does not partially save or record activity when a multi-save finds duplicate stored IDs", () => {
    const first = {
      id: "duplicate-league",
      name: "Primera versión",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const original = JSON.stringify([first, { ...first, name: "Segunda versión" }]);
    const originalActivity = JSON.stringify([]);
    storedValues.set(storageKey, original);
    storedValues.set("cancha.activity", originalActivity);
    const event: ActivityEvent = {
      id: "multi-save",
      occurredAt: "2026-06-01T12:00:00.000Z",
      action: "match-operational-state-updated",
      tournamentId: "first",
      tournamentName: "Primero",
      summary: "Estado de partido actualizado.",
    };
    const firstUpdate: Tournament = {
      id: "new-first",
      name: "Primero",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    expect(() => new LocalStorageTournamentRepository(false)
      .saveManyWithActivity([firstUpdate, { ...firstUpdate, id: "new-second" }], event))
      .toThrow("identificadores de torneo duplicados");
    expect(storedValues.get(storageKey)).toBe(original);
    expect(storedValues.get("cancha.activity")).toBe(originalActivity);
  });

  it("continues saving normally when all locally stored tournament IDs are unique", () => {
    const existing: Tournament = {
      id: "existing",
      name: "Existente",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const updated = { ...existing, name: "Actualizado" };
    storedValues.set(storageKey, JSON.stringify([existing]));

    new LocalStorageTournamentRepository(false).save(updated);

    expect(JSON.parse(storedValues.get(storageKey) ?? "[]")).toEqual([updated]);
  });

  it("does not overwrite a corrupt record when saving with the same identifier", () => {
    const corruptValue = JSON.stringify([{ id: "same-id", name: "Broken", teams: null }]);
    storedValues.set(storageKey, corruptValue);
    const repository = new LocalStorageTournamentRepository(false);

    expect(() => repository.save({
      id: "same-id",
      name: "Replacement",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    })).toThrow("ya existe un registro dañado con ese identificador");
    expect(storedValues.get(storageKey)).toBe(corruptValue);
  });

  it("reports LocalStorage read and write failures", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("private browser detail");
        },
        setItem: (key: string, value: string) => storedValues.set(key, value),
      },
    });

    const repository = new LocalStorageTournamentRepository(false);
    expect(() => repository.findAll())
      .toThrow("No se pudieron leer los campeonatos guardados del navegador.");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storedValues.get(key) ?? null,
        setItem: () => {
          throw new Error("private browser detail");
        },
      },
    });
    expect(() => repository.save({
      id: "new-league",
      name: "New League",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    })).toThrow("No se pudieron guardar los cambios del campeonato en el navegador.");
  });

  it("explains quota failures without changing the previously stored tournament data", () => {
    const original = JSON.stringify([]);
    storedValues.set(storageKey, original);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storedValues.get(key) ?? null,
        setItem: () => {
          throw new DOMException("Quota exceeded", "QuotaExceededError");
        },
        removeItem: (key: string) => storedValues.delete(key),
      },
    });
    const repository = new LocalStorageTournamentRepository(false);

    expect(() => repository.save({
      id: "new-league",
      name: "New League",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    })).toThrow("almacenamiento del navegador está lleno");
    expect(storedValues.get(storageKey)).toBe(original);
  });

  it("lists multiple saved tournaments and persists the selected identifier across repository instances", () => {
    const repository = new LocalStorageTournamentRepository(false);
    const createSavedTournament = (id: string, name: string) => ({
      id,
      name,
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    repository.save(createSavedTournament("league-a", "Liga A"));
    repository.save(createSavedTournament("cup-b", "Copa B"));
    repository.setActiveTournamentId("league-a");

    const reloadedRepository = new LocalStorageTournamentRepository(false);
    expect(reloadedRepository.findAll().map(({ id }) => id)).toEqual(["cup-b", "league-a"]);
    expect(reloadedRepository.getActiveTournamentId()).toBe("league-a");
  });

  it("deletes only the selected valid tournament and preserves other records", () => {
    const repository = new LocalStorageTournamentRepository(false);
    const createSavedTournament = (id: string, name: string) => ({
      id,
      name,
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    repository.save(createSavedTournament("league-a", "Liga A"));
    repository.save(createSavedTournament("league-b", "Liga B"));
    const corrupt = { id: "broken", name: "Broken", teams: null };
    const saved = JSON.parse(storedValues.get(storageKey) ?? "[]");
    storedValues.set(storageKey, JSON.stringify([...saved, corrupt]));

    repository.deleteById("league-a");

    const remaining = JSON.parse(storedValues.get(storageKey) ?? "[]");
    expect(remaining.map((value: { id: string }) => value.id)).toEqual(["league-b", "broken"]);
    expect(repository.findAll().map(({ id }) => id)).toEqual(["league-b"]);
  });

  it("does not delete a damaged tournament record by identifier", () => {
    const damaged = JSON.stringify([{ id: "broken", name: "Broken", teams: null }]);
    storedValues.set(storageKey, damaged);

    expect(() => new LocalStorageTournamentRepository(false).deleteById("broken"))
      .toThrow("No se eliminó el campeonato porque sus datos guardados están dañados.");
    expect(storedValues.get(storageKey)).toBe(damaged);
  });

  it("round-trips season regulations and rejects an invalid update without modifying storage", () => {
    const repository = new LocalStorageTournamentRepository(false);
    const tournament = {
      id: "regulated-league",
      competitionId: "league",
      name: "Liga 2026",
      season: 2026,
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      matchRegulations: {
        schemaVersion: 1 as const,
        season: 2026,
        verification: "pending" as const,
        substitutions: { maxCount: 0 },
      },
    };
    repository.save(tournament);
    expect(repository.findAll()[0].matchRegulations).toEqual(tournament.matchRegulations);

    const previousValue = storedValues.get(storageKey);
    expect(() => repository.save({
      ...tournament,
      matchRegulations: {
        ...tournament.matchRegulations,
        timing: { regulationMinutes: 90, halfMinutes: 40 },
      },
    })).toThrow("duración de cada tiempo se contradicen");
    expect(storedValues.get(storageKey)).toBe(previousValue);
  });

  it("rolls back a multi-tournament save and its activity when one tournament fails", () => {
    const originalTournaments = "[]";
    const originalActivity = "[]";
    storedValues.set(storageKey, originalTournaments);
    storedValues.set("cancha.activity", originalActivity);
    let tournamentWrites = 0;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storedValues.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (key === storageKey && ++tournamentWrites === 2) {
            throw new DOMException("Quota exceeded", "QuotaExceededError");
          }
          storedValues.set(key, value);
        },
        removeItem: (key: string) => storedValues.delete(key),
      },
    });
    const first: Tournament = {
      id: "first",
      name: "Primero",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const second: Tournament = { ...first, id: "second", name: "Segundo" };
    const event: ActivityEvent = {
      id: "operational-update",
      occurredAt: "2026-06-01T12:00:00.000Z",
      action: "match-operational-state-updated",
      tournamentId: "first",
      tournamentName: "Primero",
      summary: "Estado de partido actualizado.",
    };

    expect(() => new LocalStorageTournamentRepository(false)
      .saveManyWithActivity([first, second], event)).toThrow("No se pudieron guardar los cambios");
    expect(storedValues.get(storageKey)).toBe(originalTournaments);
    expect(storedValues.get("cancha.activity")).toBe(originalActivity);
  });
});
