import type { Fixture, GoalScorer } from "../entities/tournament";

export function isValidGoalScorer(value: unknown): value is GoalScorer {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const scorer = value as Record<string, unknown>;
  return typeof scorer.teamId === "string"
    && scorer.teamId.trim().length > 0
    && typeof scorer.playerName === "string"
    && scorer.playerName.trim().length > 0
    && (scorer.playerId === undefined
      || (typeof scorer.playerId === "string" && scorer.playerId.trim().length > 0))
    && (scorer.minute === undefined
      || (Number.isSafeInteger(scorer.minute) && Number(scorer.minute) >= 1 && Number(scorer.minute) <= 120))
    && (scorer.type === undefined
      || scorer.type === "regular"
      || scorer.type === "penalty"
      || scorer.type === "own-goal")
    && (scorer.eventId === undefined
      || (typeof scorer.eventId === "string" && scorer.eventId.trim().length > 0));
}

export function isGoalScorerForFixture(scorer: GoalScorer, fixture: Fixture): boolean {
  return scorer.teamId === fixture.homeTeamId || scorer.teamId === fixture.awayTeamId;
}

export function validateGoalScorers(
  scorers: readonly GoalScorer[],
  fixture: Fixture,
): string | undefined {
  if (!scorers.every(isValidGoalScorer)) {
    return "Cada autor debe tener un nombre, pertenecer a uno de los equipos y usar un minuto o tipo de gol válido.";
  }
  if (scorers.some((scorer) => !isGoalScorerForFixture(scorer, fixture))) {
    return "No se puede registrar un autor de gol de un equipo que no participó en el partido.";
  }
  return undefined;
}
