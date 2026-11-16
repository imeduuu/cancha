import { describe, expect, it, vi } from "vitest";
import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { updateFixtureSchedule } from "./update-fixture-schedule";

const tournament: Tournament = {
  id: "season-one",
  competitionId: "competition",
  name: "Copa",
  season: 2026,
  teams: [{ id: "home", name: "Local" }, { id: "away", name: "Visita" }],
  legs: 1,
  tieBreakers: [],
  matchdays: [{
    number: 1,
    leg: 1,
    phaseName: "Final",
    fixtures: [{
      id: "match",
      homeTeamId: "home",
      awayTeamId: "away",
      knockoutResolution: "penalties",
      result: { homeGoals: 1, awayGoals: 1, penalties: { homeGoals: 4, awayGoals: 3 } },
      schedule: { date: "2026-10-14", time: "20:00", venue: "Cancha" },
    }],
  }],
  createdAt: "2026-01-01T00:00:00.000Z",
};

function createRepository(): TournamentRepository {
  const save = vi.fn();
  return {
    findAll: () => [tournament],
    save,
    saveWithActivity: vi.fn((value: Tournament) => save(value)),
    recordActivity: vi.fn(),
  };
}

describe("updateFixtureSchedule", () => {
  it("saves and updates scheduling independently from result and knockout data", () => {
    const repository = createRepository();
    const updated = updateFixtureSchedule(tournament, "match", {
      date: "2026-10-15",
      time: "21:30",
      venue: "Nuevo recinto",
      logisticsNotes: "Puertas a las 19:00",
    }, repository);
    const fixture = updated.matchdays[0].fixtures[0];

    expect(fixture.schedule).toEqual({
      date: "2026-10-15",
      time: "21:30",
      venue: "Nuevo recinto",
      logisticsNotes: "Puertas a las 19:00",
      provenance: "manual",
    });
    expect(fixture.result).toEqual(tournament.matchdays[0].fixtures[0].result);
    expect(fixture.knockoutResolution).toBe("penalties");
    expect(repository.save).toHaveBeenCalledWith(updated);
  });

  it("removes scheduling without removing the score or resolution", () => {
    const repository = createRepository();
    const updated = updateFixtureSchedule(tournament, "match", null, repository);
    const fixture = updated.matchdays[0].fixtures[0];

    expect(fixture).not.toHaveProperty("schedule");
    expect(fixture.result).toEqual(tournament.matchdays[0].fixtures[0].result);
    expect(fixture.knockoutResolution).toBe("penalties");
  });

  it("rejects invalid values before writing to the repository", () => {
    const repository = createRepository();

    expect(() => updateFixtureSchedule(tournament, "match", { date: "2026-02-30" }, repository))
      .toThrow("La fecha debe existir");
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("does not mutate another season sharing the competition", () => {
    const repository = createRepository();
    const otherSeason: Tournament = {
      ...tournament,
      id: "season-two",
      season: 2027,
    };
    const updated = updateFixtureSchedule(tournament, "match", { date: "2026-11-01" }, repository);

    expect(updated.id).toBe("season-one");
    expect(otherSeason.matchdays[0].fixtures[0].schedule?.date).toBe("2026-10-14");
    expect(tournament.matchdays[0].fixtures[0].schedule?.date).toBe("2026-10-14");
  });
});
