import { describe, expect, it } from "vitest";
import type { Tournament } from "../entities/tournament";
import {
  copyTournamentSquad,
  registerTournamentPlayer,
  releaseTournamentPlayer,
  saveTournamentPlayer,
  transferTournamentPlayer,
  validateTournamentPlayerData,
} from "./player-roster";
import { calculateTournamentStatistics } from "./tournament-statistics";
import { createTournamentSeason } from "../../application/use-cases/create-tournament-season";
import type { TournamentRepository } from "../../application/ports/tournament-repository";

const emptyTournament: Tournament = {
  id: "season-2026",
  competitionId: "league",
  name: "Liga 2026",
  season: 2026,
  teams: [{ id: "club-a", name: "Club A" }, { id: "club-b", name: "Club B" }],
  legs: 1,
  tieBreakers: ["goalDifference"],
  matchdays: [{
    number: 1,
    leg: 1,
    fixtures: [{
      id: "match-1",
      homeTeamId: "club-a",
      awayTeamId: "club-b",
      result: { homeGoals: 1, awayGoals: 0 },
    }],
  }],
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("player roster", () => {
  it("creates and edits a stable player profile without requiring optional personal data", () => {
    const created = saveTournamentPlayer(emptyTournament, {
      firstName: "Alex",
      lastName: "Jugador",
    }, () => "player-1");
    expect(created.players).toEqual([{ id: "player-1", firstName: "Alex", lastName: "Jugador" }]);
    const edited = saveTournamentPlayer(created, {
      id: "player-1",
      firstName: "Alexis",
      lastName: "Jugador",
      birthDate: "2000-02-29",
      nationality: "Chile",
      usualPosition: "Delantero",
    });
    expect(edited.players?.[0]).toMatchObject({
      id: "player-1",
      firstName: "Alexis",
      birthDate: "2000-02-29",
      nationality: "Chile",
      usualPosition: "Delantero",
    });
    expect(() => saveTournamentPlayer(emptyTournament, {
      firstName: "Bad",
      lastName: "Date",
      birthDate: "2001-02-29",
    })).toThrow("fecha de nacimiento");
  });

  it("registers and releases a player while preserving their goal history", () => {
    const player = { id: "player-1", firstName: "Alex", lastName: "Jugador" };
    const withPlayer = { ...emptyTournament, players: [player] };
    const registered = registerTournamentPlayer(withPlayer, player.id, "club-a", 9);
    const withGoal: Tournament = {
      ...registered,
      matchdays: [{
        ...registered.matchdays[0],
        fixtures: [{
          ...registered.matchdays[0].fixtures[0],
          goalScorers: [{
            teamId: "club-a",
            playerId: player.id,
            playerName: "Alex Jugador",
          }],
        }],
      }],
    };
    const released = releaseTournamentPlayer(withGoal, player.id);
    expect(released.playerRegistrations?.[0].status).toBe("released");
    expect(released.matchdays[0].fixtures[0].goalScorers).toEqual(
      withGoal.matchdays[0].fixtures[0].goalScorers,
    );
    expect(calculateTournamentStatistics(released).topScorers[0])
      .toMatchObject({ playerId: player.id, goals: 1 });
  });

  it("rejects unknown teams and duplicate active shirt numbers", () => {
    const base = {
      ...emptyTournament,
      players: [
        { id: "one", firstName: "Uno", lastName: "Jugador" },
        { id: "two", firstName: "Dos", lastName: "Jugador" },
      ],
    };
    expect(() => registerTournamentPlayer(base, "one", "missing")).toThrow("equipo inexistente");
    const withFirst = registerTournamentPlayer(base, "one", "club-a", 10);
    expect(() => registerTournamentPlayer(withFirst, "two", "club-a", 10))
      .toThrow("número 10 está duplicado");
    expect(validateTournamentPlayerData({
      ...withFirst,
      playerRegistrations: [
        { playerId: "one", teamId: "club-a" },
        { playerId: "two", teamId: "missing" },
      ],
    })).toContain("equipo inexistente");
  });

  it("keeps a transferred player's earlier season and statistics unchanged", () => {
    const player = { id: "stable-player", firstName: "Alex", lastName: "Jugador" };
    const rostered = registerTournamentPlayer({
      ...emptyTournament,
      players: [player],
    }, player.id, "club-a", 9);
    const previous: Tournament = {
      ...rostered,
      matchdays: [{
        ...rostered.matchdays[0],
        fixtures: [{
          ...rostered.matchdays[0].fixtures[0],
          goalScorers: [{
            teamId: "club-a",
            playerId: player.id,
            playerName: "Alex Jugador",
          }],
        }],
      }],
    };
    const nextSeason = { ...emptyTournament, id: "season-2027", season: 2027, matchdays: [] };
    const copied = copyTournamentSquad(previous, nextSeason);
    const transferred = transferTournamentPlayer(copied, player.id, "club-b", 7);

    expect(previous.playerRegistrations?.[0]).toMatchObject({ teamId: "club-a", shirtNumber: 9 });
    expect(transferred.playerRegistrations?.[1]).toMatchObject({ teamId: "club-b", shirtNumber: 7 });
    expect(transferred.players?.[0].id).toBe(player.id);
    expect(calculateTournamentStatistics(previous).topScorers[0].goals).toBe(1);
    expect(calculateTournamentStatistics(transferred).topScorers).toHaveLength(0);
    expect(() => copyTournamentSquad(previous, {
      ...nextSeason,
      playerRegistrations: [{ playerId: "stable-player", teamId: "club-b" }],
    })).toThrow("no se sobrescribió");
  });

  it("copies a squad to a new season only when explicitly requested", () => {
    const player = { id: "stable-player", firstName: "Alex", lastName: "Jugador" };
    const source = registerTournamentPlayer({
      ...emptyTournament,
      players: [player],
    }, player.id, "club-a", 9);
    const saved: Tournament[] = [source];
    const repository: TournamentRepository = {
      findAll: () => [...saved],
      save: (tournament) => { saved.push(tournament); },
      saveWithActivity: (tournament) => { saved.push(tournament); },
      recordActivity: () => undefined,
    };
    let id = 0;
    const withoutSquad = createTournamentSeason(
      source,
      2027,
      repository,
      () => `generated-${++id}`,
      () => new Date("2027-01-01T00:00:00.000Z"),
    );
    expect(withoutSquad.players).toBeUndefined();
    expect(withoutSquad.playerRegistrations).toBeUndefined();

    const withSquad = createTournamentSeason(
      source,
      2028,
      repository,
      () => `generated-${++id}`,
      () => new Date("2028-01-01T00:00:00.000Z"),
      true,
    );
    expect(withSquad.players?.[0].id).toBe(player.id);
    expect(withSquad.playerRegistrations?.[0]).toMatchObject({
      playerId: player.id,
      teamId: "club-a",
      shirtNumber: 9,
    });
  });

  it("validates player-linked goals and does not invent individual appearances or assists", () => {
    const player = { id: "player-1", firstName: "Alex", lastName: "Jugador" };
    const registered = registerTournamentPlayer({
      ...emptyTournament,
      players: [player],
    }, player.id, "club-a");
    const linkedGoal: Tournament = {
      ...registered,
      matchdays: [{
        ...registered.matchdays[0],
        fixtures: [{
          ...registered.matchdays[0].fixtures[0],
          goalScorers: [{
            teamId: "club-a",
            playerId: player.id,
            playerName: "Alex Jugador",
          }],
        }],
      }],
    };
    expect(validateTournamentPlayerData(linkedGoal)).toBeUndefined();
    expect(validateTournamentPlayerData({
      ...linkedGoal,
      matchdays: [{
        ...linkedGoal.matchdays[0],
        fixtures: [{
          ...linkedGoal.matchdays[0].fixtures[0],
          goalScorers: [{
            teamId: "club-b",
            playerId: player.id,
            playerName: "Alex Jugador",
          }],
        }],
      }],
    })).toContain("no pertenece a ese equipo");
    const stats = calculateTournamentStatistics(linkedGoal).topScorers[0];
    expect(stats).toMatchObject({ playerId: player.id, goals: 1 });
    expect(stats).not.toHaveProperty("appearances");
    expect(stats).not.toHaveProperty("assists");
    expect(stats).not.toHaveProperty("minutes");
  });
});
