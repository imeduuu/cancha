import { DomainError } from "../../domain/domain-error.js";
import type { Matchday, Tournament } from "../../domain/entities/tournament";
import { advanceArgentinaPlayoffs } from "../../domain/services/argentina-clausura-playoffs";
import type { TournamentRepository } from "../ports/tournament-repository";
import { simulateFixtures, type SimulationMode } from "./simulate-fixtures";

export type ArgentinaTournamentHalf = "Apertura" | "Clausura";

export interface SimulateArgentinaHalfResult {
  readonly tournament: Tournament;
  readonly simulatedCount: number;
}

function getHalfMatchdays(
  tournament: Tournament,
  half: ArgentinaTournamentHalf,
): Matchday[] {
  return tournament.matchdays.filter((matchday) =>
    matchday.phaseName?.startsWith(`Torneo ${half} ·`),
  );
}

function progressHalfPlayoffs(
  tournament: Tournament,
  half: ArgentinaTournamentHalf,
  repository: TournamentRepository,
): Tournament {
  const advancedTournament = advanceArgentinaPlayoffs(tournament, half);
  if (advancedTournament !== tournament) repository.save(advancedTournament);
  return advancedTournament;
}

export function simulateArgentinaHalf(
  tournament: Tournament,
  half: ArgentinaTournamentHalf,
  includePlayoffs: boolean,
  mode: SimulationMode,
  repository: TournamentRepository,
  random: () => number = Math.random,
): SimulateArgentinaHalfResult {
  if (tournament.id !== "arg-liga-profesional-2026") {
    throw new DomainError("La simulación por Apertura y Clausura solo está disponible para Argentina.");
  }

  const halfMatchdays = getHalfMatchdays(tournament, half);
  const leagueMatchdays = halfMatchdays.filter((matchday) =>
    matchday.phaseName?.endsWith("Fase regular"),
  );
  if (leagueMatchdays.length === 0) {
    throw new DomainError(`No se encontró la fase de liga del Torneo ${half}.`);
  }

  const leagueFixtureIds = leagueMatchdays.flatMap((matchday) =>
    matchday.fixtures.map((fixture) => fixture.id),
  );
  const leagueResult = simulateFixtures(
    tournament,
    leagueFixtureIds,
    mode,
    repository,
    random,
  );
  let currentTournament = leagueResult.tournament;
  let simulatedCount = leagueResult.simulatedCount;

  currentTournament = progressHalfPlayoffs(currentTournament, half, repository);
  if (!includePlayoffs) {
    return { tournament: currentTournament, simulatedCount };
  }

  const simulatedFixtureIds = new Set(leagueFixtureIds);
  for (let round = 0; round < 4; round += 1) {
    const knockoutMatchday = getHalfMatchdays(currentTournament, half).find((matchday) =>
      !matchday.phaseName?.endsWith("Fase regular")
      && matchday.fixtures.some((fixture) =>
        mode === "overwrite" || !fixture.result,
      ),
    );
    if (!knockoutMatchday) break;

    const fixtureIds = knockoutMatchday.fixtures
      .filter((fixture) => !simulatedFixtureIds.has(fixture.id))
      .map((fixture) => fixture.id);
    if (fixtureIds.length === 0) break;
    fixtureIds.forEach((fixtureId) => simulatedFixtureIds.add(fixtureId));
    const result = simulateFixtures(
      currentTournament,
      fixtureIds,
      mode,
      repository,
      random,
    );
    simulatedCount += result.simulatedCount;
    currentTournament = progressHalfPlayoffs(result.tournament, half, repository);
  }

  return { tournament: currentTournament, simulatedCount };
}
