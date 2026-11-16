import { describe, expect, it } from "vitest";
import type { Tournament } from "../../domain/entities/tournament";
import { calculateStandings } from "../../domain/services/standings";
import {
  cloneTournamentWithNewIds,
  createTournamentArchive,
  createTournamentBackup,
  parseTournamentArchive,
  parseTournamentBackup,
  parseTournamentBackupWithActivity,
} from "./tournament-archive";

const tournament: Tournament = {
  id: "league-2026",
  competitionId: "league",
  name: "Liga 2026",
  season: 2026,
  archived: true,
  teams: [
    { id: "team-a", name: "Club A" },
    { id: "team-b", name: "Club B" },
  ],
  legs: 1,
  tieBreakers: ["goalDifference", "headToHeadPoints"],
  pointsSystem: { win: 3, draw: 1, loss: 0 },
  matchdays: [{
    number: 1,
    leg: 1,
    fixtures: [{
      id: "match-1",
      homeTeamId: "team-a",
      awayTeamId: "team-b",
      knockoutResolution: "penalties",
      result: {
        homeGoals: 1,
        awayGoals: 1,
        penalties: { homeGoals: 4, awayGoals: 3 },
      },
    }],
  }],
  createdAt: "2026-01-01T00:00:00.000Z",
  importCoverage: "partial",
  competitionRules: {
    season: 2026,
    verification: { standings: "pending", placements: "provisional" },
    standingsNote: "Pendiente de revisar",
    internationalQualification: {
      verification: "provisional",
      slots: [{ destination: "conmebol-libertadores", position: 1 }],
      reallocation: "next-eligible-position",
    },
    relegationAverage: {
      verification: "pending",
      seasons: [2024, 2025, 2026],
      relegatedCount: 1,
      tieBreakers: ["goalDifference"],
    },
  },
};

describe("tournament archive", () => {
  it("round-trips explicit event verification and competition numbering, while legacy fields stay absent", () => {
    const documented: Tournament = {
      ...tournament,
      teams: tournament.teams.map((team, index) => ({
        ...team,
        competitionNumber: index + 1,
      })),
      matchdays: [{
        ...tournament.matchdays[0],
        fixtures: [{ ...tournament.matchdays[0].fixtures[0], events: [], eventsCoverage: "complete" }],
      }],
    };
    const restored = parseTournamentBackup(JSON.stringify(createTournamentBackup([documented])))[0];
    expect(restored.teams.map(({ competitionNumber }) => competitionNumber)).toEqual([1, 2]);
    expect(restored.matchdays[0].fixtures[0].eventsCoverage).toBe("complete");
    expect(tournament.matchdays[0].fixtures[0].eventsCoverage).toBeUndefined();
  });

  it("preserves backup version and export date for a safe restore preview", () => {
    const exportedAt = "2026-10-15T12:00:00.000Z";
    const backup = createTournamentBackup([tournament], () => new Date(exportedAt));
    expect(parseTournamentBackupWithActivity(JSON.stringify(backup))).toMatchObject({
      version: 7,
      exportedAt,
    });

    const legacy = parseTournamentBackupWithActivity(JSON.stringify({
      format: "cancha-backup",
      version: 5,
      tournaments: [tournament],
    }));
    expect(legacy.version).toBe(5);
    expect(legacy.exportedAt).toBeUndefined();
    expect(legacy.universes).toBeUndefined();
    expect(legacy.activity).toEqual([]);
  });

  it("round-trips local match scheduling and leaves legacy fixtures unscheduled", () => {
    const scheduled: Tournament = {
      ...tournament,
      matchdays: [{
        ...tournament.matchdays[0],
        fixtures: [{
          ...tournament.matchdays[0].fixtures[0],
          schedule: {
            date: "2026-10-14",
            time: "21:30",
            venue: "Estadio Central",
            logisticsNotes: "Acceso norte",
          },
        }],
      }],
    };
    const exported = createTournamentArchive(scheduled);
    const imported = parseTournamentArchive(JSON.stringify(exported));

    expect(exported.version).toBe(7);
    expect(imported.matchdays[0].fixtures[0].schedule).toEqual(
      scheduled.matchdays[0].fixtures[0].schedule,
    );
    expect(parseTournamentBackup(JSON.stringify(createTournamentBackup([scheduled])))[0]
      .matchdays[0].fixtures[0].schedule).toEqual(scheduled.matchdays[0].fixtures[0].schedule);
    expect(parseTournamentArchive(JSON.stringify(createTournamentArchive(tournament)))
      .matchdays[0].fixtures[0].schedule).toBeUndefined();
  });

  it("round-trips operational status in version seven and imports version five without inventing a status", () => {
    const withOperationalState: Tournament = {
      ...tournament,
      matchdays: tournament.matchdays.map((matchday) => ({
        ...matchday,
        fixtures: matchday.fixtures.map((fixture) => ({
          ...fixture,
          operationalState: {
            status: "postponed",
            updatedAt: "2026-10-14T21:00:00.000Z",
            note: "Aplazado por decisión del organizador",
          },
        })),
      })),
    };
    const archive = createTournamentArchive(withOperationalState);
    expect(archive.version).toBe(7);
    expect(parseTournamentArchive(JSON.stringify(archive))).toEqual(withOperationalState);
    const oldV5 = {
      format: "cancha-tournament",
      version: 5,
      exportedAt: "2026-10-14T20:00:00.000Z",
      tournament,
    };
    const migrated = parseTournamentArchive(JSON.stringify(oldV5));
    expect(migrated.matchdays[0].fixtures[0].operationalState).toBeUndefined();
  });

  it("rejects invalid operational state data transactionally", () => {
    const invalidState = {
      ...tournament,
      matchdays: tournament.matchdays.map((matchday) => ({
        ...matchday,
        fixtures: matchday.fixtures.map((fixture) => ({
          ...fixture,
          operationalState: {
            status: "cancelled",
            updatedAt: "not-a-timestamp",
            note: "Aplazado",
          },
        })),
      })),
    };
    expect(() => parseTournamentBackup(JSON.stringify({
      format: "cancha-backup",
      version: 6,
      exportedAt: "2026-10-14T20:00:00.000Z",
      tournaments: [tournament, invalidState],
    }))).toThrow("estructura del torneo no es válida");
  });

  it("rejects invalid scheduling in an imported archive", () => {
    const malformed = {
      ...tournament,
      matchdays: [{
        ...tournament.matchdays[0],
        fixtures: [{
          ...tournament.matchdays[0].fixtures[0],
          schedule: { date: "2026-02-30", time: "25:00" },
        }],
      }],
    };
    const archive = { format: "cancha-tournament", version: 6, exportedAt: "2026-10-14T00:00:00.000Z", tournament: malformed };

    expect(() => parseTournamentArchive(JSON.stringify(archive))).toThrow();
  });

  it("round-trips a tournament with its results, rules and verification metadata", () => {
    const exported = createTournamentArchive(tournament, () => new Date("2026-05-01T00:00:00.000Z"));
    const imported = parseTournamentArchive(JSON.stringify(exported));

    expect(imported).toEqual(tournament);
    expect(exported).toMatchObject({ format: "cancha-tournament", version: 7 });
    expect(imported.competitionRules?.internationalQualification?.verification).toBe("provisional");
    expect(imported.competitionRules?.relegationAverage?.verification).toBe("pending");
    expect(calculateStandings(imported).find(({ teamId }) => teamId === "team-a")?.points).toBe(1);
  });

  it("rejects an archive whose tournament and competition-rules seasons disagree without changing either value", () => {
    const archive = {
      ...createTournamentArchive(tournament),
      tournament: { ...tournament, season: 2027 },
    };

    expect(archive.tournament.season).toBe(2027);
    expect(archive.tournament.competitionRules?.season).toBe(2026);
    expect(() => parseTournamentArchive(JSON.stringify(archive)))
      .toThrow(/temporada del torneo y la de sus reglas/i);
    expect(archive.tournament.season).toBe(2027);
    expect(archive.tournament.competitionRules?.season).toBe(2026);
  });

  it.each([-1, 1.5, 3])("rejects an archive with invalid relegationPlaces %i without correcting it", (relegationPlaces) => {
    const archive = {
      ...createTournamentArchive(tournament),
      tournament: { ...tournament, placementRules: { relegationPlaces } },
    };

    expect(() => parseTournamentArchive(JSON.stringify(archive)))
      .toThrow(/Puestos de descenso/i);
    expect(archive.tournament.placementRules.relegationPlaces).toBe(relegationPlaces);
  });

  it("round-trips optional match details and regulations in the version-seven backup", () => {
    const withDetails: Tournament = {
      ...tournament,
      players: [
        { id: "home-starter", firstName: "Local", lastName: "Titular" },
        { id: "home-sub", firstName: "Local", lastName: "Suplente" },
        { id: "away-starter", firstName: "Visita", lastName: "Titular" },
        { id: "away-sub", firstName: "Visita", lastName: "Suplente" },
      ],
      playerRegistrations: [
        { playerId: "home-starter", teamId: "team-a" },
        { playerId: "home-sub", teamId: "team-a" },
        { playerId: "away-starter", teamId: "team-b" },
        { playerId: "away-sub", teamId: "team-b" },
      ],
      lineupRules: { startersPerTeam: 1 },
      matchRegulations: {
        schemaVersion: 1,
        season: 2026,
        verification: "provisional",
        lineup: { requiredStarters: 1, maxSubstitutes: 0 },
        substitutions: { maxCount: 0, maxWindows: 0 },
        timing: { regulationMinutes: 90, halfMinutes: 45 },
      },
      matchdays: [{
        ...tournament.matchdays[0],
        fixtures: [{
          ...tournament.matchdays[0].fixtures[0],
          lineups: {
            home: {
              starters: ["home-starter"], substitutes: ["home-sub"], status: "complete",
            },
            away: {
              starters: ["away-starter"], substitutes: ["away-sub"], status: "complete",
            },
          },
          substitutions: [{
            id: "sub-1",
            teamId: "team-a",
            playerOutId: "home-starter",
            playerInId: "home-sub",
            minute: 70,
          }],
          events: [{
            id: "card-1",
            type: "yellow-card",
            teamId: "team-a",
            playerId: "home-starter",
            playerName: "Local Titular",
            minute: 35,
          }],
        }],
      }],
    };
    const backup = createTournamentBackup([withDetails]);
    expect(backup.version).toBe(7);
    expect(parseTournamentBackup(JSON.stringify(backup))).toEqual([withDetails]);
  });

  it("continues importing version-four archives without assigning a regulation", () => {
    const imported = parseTournamentArchive(JSON.stringify({
      format: "cancha-tournament",
      version: 4,
      exportedAt: "2026-05-01T00:00:00.000Z",
      tournament,
    }));
    expect(imported).toEqual(tournament);
    expect(imported.matchRegulations).toBeUndefined();
  });

  it("exports and imports a backup containing multiple independent tournaments", () => {
    const second = { ...tournament, id: "cup-2026", name: "Copa 2026" };
    const backup = createTournamentBackup([tournament, second]);
    expect(parseTournamentBackup(JSON.stringify(backup))).toEqual([tournament, second]);
  });

  it("exports only tournament fields and omits unrelated UI state", () => {
    const tournamentWithUiState = Object.assign({}, tournament, {
      activePhase: "Fase de grupos",
      selectedTeamId: "team-a",
    });
    const exported = createTournamentArchive(tournamentWithUiState);
    expect(exported.tournament).not.toHaveProperty("activePhase");
    expect(exported.tournament).not.toHaveProperty("selectedTeamId");
  });

  it("rejects malformed JSON and valid JSON with an invalid structure", () => {
    expect(() => parseTournamentArchive("{broken")).toThrow("JSON válido");
    expect(() => parseTournamentArchive(JSON.stringify({
      format: "cancha-tournament",
      version: 1,
      exportedAt: "2026-05-01T00:00:00.000Z",
      tournament: { id: "missing-fields" },
    }))).toThrow("estructura del torneo no es válida");
    expect(() => parseTournamentBackup(JSON.stringify({
      format: "cancha-backup",
      version: 1,
      exportedAt: "2026-05-01T00:00:00.000Z",
      tournaments: {},
    }))).toThrow("lista de torneos válida");
    expect(() => parseTournamentArchive(JSON.stringify({
      format: "cancha-tournament",
      version: 7,
      exportedAt: "not-a-date",
      tournament,
    }))).toThrow("fecha de exportación válida");
  });

  it("rejects unsupported versions and migrates compatible unversioned legacy records", () => {
    expect(() => parseTournamentArchive(JSON.stringify({
      format: "cancha-tournament",
      version: 8,
      tournament,
    }))).toThrow("no es compatible");
    const { season: _season, importCoverage: _coverage, competitionRules: _rules, ...legacy } = tournament;
    expect(parseTournamentArchive(JSON.stringify(legacy))).toEqual(legacy);
  });

  it("rejects duplicate tournament IDs in a backup", () => {
    expect(() => createTournamentBackup([tournament, tournament]))
      .toThrow('identificador de torneo "league-2026"');
  });

  it("rejects unknown team references and invalid scores or penalty results", () => {
    const missingTeam = {
      ...tournament,
      matchdays: [{
        ...tournament.matchdays[0],
        fixtures: [{ ...tournament.matchdays[0].fixtures[0], awayTeamId: "missing" }],
      }],
    };
    expect(() => createTournamentArchive(missingTeam)).toThrow('el equipo "missing" no existe');

    const badScore = {
      ...tournament,
      matchdays: [{
        ...tournament.matchdays[0],
        fixtures: [{
          ...tournament.matchdays[0].fixtures[0],
          result: { homeGoals: 100, awayGoals: 0 },
        }],
      }],
    };
    expect(() => createTournamentArchive(badScore)).toThrow("estructura del torneo no es válida");

    const tiedPenalties = {
      ...tournament,
      matchdays: [{
        ...tournament.matchdays[0],
        fixtures: [{
          ...tournament.matchdays[0].fixtures[0],
          result: { homeGoals: 1, awayGoals: 1, penalties: { homeGoals: 2, awayGoals: 2 } },
        }],
      }],
    };
    expect(() => createTournamentArchive(tiedPenalties)).toThrow("definición");
  });

  it("creates a copy with fresh tournament, team and fixture identifiers", () => {
    let id = 0;
    const copy = cloneTournamentWithNewIds(tournament, () => `copy-${++id}`);
    expect(copy.id).not.toBe(tournament.id);
    expect(copy.competitionId).toBe(copy.id);
    expect(copy.teams.map(({ id: teamId }) => teamId)).toEqual(["copy-1", "copy-2"]);
    expect(copy.matchdays[0].fixtures[0]).toMatchObject({
      id: "copy-4",
      homeTeamId: "copy-1",
      awayTeamId: "copy-2",
    });
    expect(copy.matchdays[0].fixtures[0].result).toEqual(tournament.matchdays[0].fixtures[0].result);
    expect(tournament.id).toBe("league-2026");
  });

  it("preserves legacy tournaments without optional season and verification fields", () => {
    const legacy = {
      ...tournament,
      season: undefined,
      importCoverage: undefined,
      competitionRules: undefined,
    };
    const parsed = parseTournamentArchive(JSON.stringify(createTournamentArchive(legacy)));
    expect(parsed.season).toBeUndefined();
    expect(parsed.competitionRules).toBeUndefined();
  });

  it("round-trips registered players and linked goal scorers while retaining stable player identity", () => {
    const withSquad: Tournament = {
      ...tournament,
      players: [{
        id: "player-stable",
        firstName: "Alex",
        lastName: "Jugador",
        nationality: "Chile",
      }],
      playerRegistrations: [{
        playerId: "player-stable",
        teamId: "team-a",
        shirtNumber: 9,
        status: "active",
      }],
      matchdays: [{
        ...tournament.matchdays[0],
        fixtures: [{
          ...tournament.matchdays[0].fixtures[0],
          goalScorers: [{
            teamId: "team-a",
            playerId: "player-stable",
            playerName: "Alex Jugador",
          }],
        }],
      }],
    };
    expect(parseTournamentArchive(JSON.stringify(createTournamentArchive(withSquad))))
      .toEqual(withSquad);

    const nextSeason = {
      ...withSquad,
      id: "league-2027",
      name: "Liga 2027",
      season: 2027,
      competitionRules: { ...withSquad.competitionRules!, season: 2027 },
    };
    expect(parseTournamentBackup(JSON.stringify(createTournamentBackup([withSquad, nextSeason]))))
      .toEqual([withSquad, nextSeason]);
  });

  it("rejects invalid player-team references and duplicate player IDs without importing partially", () => {
    const invalidReference: Tournament = {
      ...tournament,
      players: [{ id: "player", firstName: "A", lastName: "B" }],
      playerRegistrations: [{ playerId: "player", teamId: "unknown-team" }],
    };
    expect(() => createTournamentArchive(invalidReference)).toThrow("equipo inexistente");
    const duplicatePlayer: Tournament = {
      ...tournament,
      players: [
        { id: "player", firstName: "A", lastName: "B" },
        { id: "player", firstName: "C", lastName: "D" },
      ],
    };
    expect(() => createTournamentBackup([duplicatePlayer])).toThrow("duplicado");
    expect(() => parseTournamentBackup(JSON.stringify({
      format: "cancha-backup",
      version: 3,
      exportedAt: "2026-05-01T00:00:00.000Z",
      tournaments: [invalidReference],
    }))).toThrow("equipo inexistente");
  });
});
