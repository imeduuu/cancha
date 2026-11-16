import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { simulateFixtures, type SimulationMode } from "./simulate-fixtures";
import { advanceTournamentProgress } from "./advance-tournament-progress";

export interface SimulateChampionshipResult {
  readonly tournament: Tournament;
  readonly simulatedCount: number;
}

function progressTournament(
  tournament: Tournament,
  repository: TournamentRepository,
): Tournament {
  const advancedTournament = advanceTournamentProgress(tournament, repository);
  if (advancedTournament !== tournament) repository.save(advancedTournament);
  return advancedTournament;
}

export function simulateChampionship(
  tournament: Tournament,
  mode: SimulationMode,
  repository: TournamentRepository,
  random: () => number = Math.random,
): SimulateChampionshipResult {
  const originalFixtureIds = tournament.matchdays.flatMap((matchday) =>
    matchday.fixtures.map((fixture) => fixture.id),
  );
  const firstPass = simulateFixtures(
    tournament,
    originalFixtureIds,
    mode,
    repository,
    random,
  );
  let currentTournament = progressTournament(firstPass.tournament, repository);
  let simulatedCount = firstPass.simulatedCount;
  const knownFixtureIds = new Set(originalFixtureIds);

  for (let round = 0; round < 12; round += 1) {
    const newFixtureIds = currentTournament.matchdays
      .flatMap((matchday) => matchday.fixtures)
      .filter((fixture) => !knownFixtureIds.has(fixture.id))
      .map((fixture) => fixture.id);
    if (newFixtureIds.length === 0) break;

    newFixtureIds.forEach((fixtureId) => knownFixtureIds.add(fixtureId));
    const nextPass = simulateFixtures(
      currentTournament,
      newFixtureIds,
      "pendingOnly",
      repository,
      random,
    );
    simulatedCount += nextPass.simulatedCount;
    currentTournament = progressTournament(nextPass.tournament, repository);
  }

  return { tournament: currentTournament, simulatedCount };
}
