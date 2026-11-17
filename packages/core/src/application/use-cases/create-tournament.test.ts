import { describe, expect, it, vi } from "vitest";
import type { TournamentRepository } from "../ports/tournament-repository";
import { createTournament, type CreateTournamentInput } from "./create-tournament";

const validInput: CreateTournamentInput = {
  name: " Campeonato Nacional ",
  teamNames: [" Colo-Colo ", "Universidad de Chile"],
  legs: 2,
  tieBreakers: ["goalDifference", "goalsFor"],
};

function createRepository(): TournamentRepository {
  const save = vi.fn();
  return {
    save,
    saveWithActivity: vi.fn((tournament: Parameters<typeof save>[0]) => save(tournament)),
    recordActivity: vi.fn(),
    findAll: vi.fn(() => []),
  };
}

describe("createTournament", () => {
  it("creates and saves a valid tournament with normalized names", () => {
    const repository = createRepository();
    const tournament = createTournament(validInput, repository, () => new Date("2026-01-01"));

    expect(tournament.name).toBe("Campeonato Nacional");
    expect(tournament.competitionId).toBe(tournament.id);
    expect(tournament.teams.map((team) => team.name)).toEqual([
      "Colo-Colo",
      "Universidad de Chile",
    ]);
    expect(tournament.matchdays).toHaveLength(2);
    expect(tournament.pointsSystem).toEqual({ win: 3, draw: 1, loss: 0 });
    expect(repository.save).toHaveBeenCalledWith(tournament);
  });

  it.each([
    {
      description: "duplicate team names ignoring case and extra whitespace",
      input: { ...validInput, teamNames: ["Colo-Colo", "  COLO-COLO "] },
      expectedMessage: "Ya existe un equipo con este nombre.",
    },
    {
      description: "duplicate team names ignoring accents",
      input: { ...validInput, teamNames: ["Universidad Católica", "Universidad Catolica"] },
      expectedMessage: "Ya existe un equipo con este nombre.",
    },
    {
      description: "blank team names",
      input: { ...validInput, teamNames: ["Colo-Colo", "   "] },
      expectedMessage: "Escribe el nombre de este equipo.",
    },
    {
      description: "missing team names",
      input: { ...validInput, teamNames: ["Colo-Colo"] },
      expectedMessage: "Agrega al menos 2 equipos con nombre.",
    },
    {
      description: "non-integer wheel counts",
      input: { ...validInput, legs: 1.5 },
      expectedMessage: "Elige entre 1 y 20 ruedas completas.",
    },
    {
      description: "repeated tie-breaker criteria",
      input: { ...validInput, tieBreakers: ["wins", "wins"] as const },
      expectedMessage: "No puedes repetir criterios de desempate.",
    },
    {
      description: "empty tie-breaker criteria",
      input: { ...validInput, tieBreakers: [] as const },
      expectedMessage: "Agrega al menos un criterio de desempate.",
    },
    {
      description: "negative points awards",
      input: { ...validInput, pointsSystem: { win: 3, draw: -1, loss: 0 } },
      expectedMessage: "Los puntos por resultado deben ser enteros no negativos.",
    },
    {
      description: "blank tournament names",
      input: { ...validInput, name: "   " },
      expectedMessage: "Escribe el nombre del campeonato.",
    },
  ])("rejects $description without saving", ({ input, expectedMessage }) => {
    const repository = createRepository();

    expect(() => createTournament(input, repository)).toThrow(expectedMessage);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects excessively long names", () => {
    const repository = createRepository();

    expect(() => createTournament({
      ...validInput,
      teamNames: ["T".repeat(41), "Universidad de Chile"],
    }, repository)).toThrow("El nombre no puede superar los 40 caracteres.");
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects tournament names longer than the supported limit", () => {
    const repository = createRepository();

    expect(() => createTournament({
      ...validInput,
      name: "T".repeat(81),
    }, repository)).toThrow("El nombre del campeonato no puede superar los 80 caracteres.");
    expect(repository.save).not.toHaveBeenCalled();
  });
});
