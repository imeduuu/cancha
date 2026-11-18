import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { createTournament } from "./create-tournament";
import { persistTournamentProgress } from "./persist-tournament-progress";
import { simulateTournamentLeg, simulateTournamentMatchday } from "./simulate-tournament-selection";

function memory() {
  let tournaments: Tournament[] = [];
  const events: ActivityEvent[] = [];
  let saves = 0;
  const repository: TournamentRepository = {
    findAll: () => tournaments,
    save: tournament => { saves += 1; tournaments = [tournament, ...tournaments.filter(({ id }) => id !== tournament.id)]; },
    saveWithActivity: (tournament, event) => { repository.save(tournament); events.push(event); },
    findActivity: () => events,
  };
  return { repository, events, saves: () => saves };
}

function league(repository: TournamentRepository): Tournament {
  return createTournament({
    name: "Liga de prueba",
    teamNames: ["Uno", "Dos", "Tres", "Cuatro"],
    legs: 2,
    tieBreakers: ["goalDifference"],
  }, repository, () => new Date("2026-03-01T12:00:00.000Z"));
}

const played = (tournament: Tournament) =>
  tournament.matchdays.map(matchday => matchday.fixtures.filter(({ result }) => result).length);

describe("simulateTournamentMatchday / simulateTournamentLeg", () => {
  it("simula sólo la jornada indicada por su posición y registra la actividad", () => {
    const { repository, events } = memory();
    const tournament = league(repository);

    const result = simulateTournamentMatchday(tournament, 1, "pendingOnly", repository, () => 0.4);

    expect(result.simulatedCount).toBe(2);
    expect(played(result.tournament)).toEqual([0, 2, 0, 0, 0, 0]);
    expect(repository.findAll()[0]).toEqual(result.tournament);
    expect(events.map(({ action }) => action)).toEqual(["tournament-created", "matches-simulated"]);
  });

  it("simula todos los partidos de una rueda", () => {
    const { repository } = memory();
    const tournament = league(repository);

    const result = simulateTournamentLeg(tournament, 2, "pendingOnly", repository, () => 0.7);

    expect(result.simulatedCount).toBe(6);
    expect(played(result.tournament)).toEqual([0, 0, 0, 2, 2, 2]);
  });

  it("rechaza una jornada o rueda inexistente sin guardar", () => {
    const { repository, saves } = memory();
    const tournament = league(repository);
    const before = saves();

    expect(() => simulateTournamentMatchday(tournament, 9, "pendingOnly", repository))
      .toThrow("La jornada indicada no existe en este torneo.");
    expect(() => simulateTournamentMatchday(tournament, 0.5, "pendingOnly", repository))
      .toThrow("La jornada indicada no existe en este torneo.");
    expect(() => simulateTournamentLeg(tournament, 3, "pendingOnly", repository))
      .toThrow("La rueda indicada no existe en este torneo.");
    expect(saves()).toBe(before);
  });
});

describe("persistTournamentProgress", () => {
  it("no guarda nada si la progresión no cambia el torneo", () => {
    const { repository, saves } = memory();
    const tournament = league(repository);
    const before = saves();

    expect(persistTournamentProgress(tournament, repository)).toBe(tournament);
    expect(saves()).toBe(before);
  });
});
