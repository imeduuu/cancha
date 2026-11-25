import { DomainError } from "../../domain/domain-error.js";
import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { persistTournamentProgress } from "./persist-tournament-progress";
import { simulateFixtures, type SimulateFixturesResult, type SimulationMode } from "./simulate-fixtures";

/**
 * Simula los partidos de una jornada (por su posición en `matchdays`) y avanza la
 * progresión, igual que el botón "Simular jornada" de la web.
 */
export function simulateTournamentMatchday(
  tournament: Tournament,
  matchdayIndex: number,
  mode: SimulationMode,
  repository: TournamentRepository,
  random: () => number = Math.random,
): SimulateFixturesResult {
  const matchday = Number.isInteger(matchdayIndex) ? tournament.matchdays[matchdayIndex] : undefined;
  if (!matchday) throw new DomainError("La jornada indicada no existe en este torneo.");
  return simulateSelection(tournament, matchday.fixtures.map(({ id }) => id), mode, repository, random);
}

/** Simula todos los partidos de una rueda y avanza la progresión. */
export function simulateTournamentLeg(
  tournament: Tournament,
  leg: number,
  mode: SimulationMode,
  repository: TournamentRepository,
  random: () => number = Math.random,
): SimulateFixturesResult {
  const fixtureIds = tournament.matchdays
    .filter(matchday => matchday.leg === leg)
    .flatMap(matchday => matchday.fixtures.map(({ id }) => id));
  if (fixtureIds.length === 0) throw new DomainError("La rueda indicada no existe en este torneo.");
  return simulateSelection(tournament, fixtureIds, mode, repository, random);
}

function simulateSelection(
  tournament: Tournament,
  fixtureIds: readonly string[],
  mode: SimulationMode,
  repository: TournamentRepository,
  random: () => number,
): SimulateFixturesResult {
  const result = simulateFixtures(tournament, fixtureIds, mode, repository, random);
  return { ...result, tournament: persistTournamentProgress(result.tournament, repository) };
}
