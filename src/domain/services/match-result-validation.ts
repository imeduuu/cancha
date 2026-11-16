import type {
  Fixture,
  KnockoutResolution,
  Matchday,
  MatchResult,
  Tournament,
} from "../entities/tournament";
import { getAggregateScoreBeforeFixture } from "./aggregate-knockout-score";

export function isValidMatchResult(result: MatchResult): boolean {
  return isValidScore(result)
    && (result.extraTime === undefined || isValidScore(result.extraTime))
    && (result.penalties === undefined || isValidScore(result.penalties));
}

export function isValidKnockoutResult(
  result: MatchResult,
  resolution: KnockoutResolution | undefined,
  aggregateScore?: { readonly homeGoals: number; readonly awayGoals: number },
): boolean {
  if (!isValidMatchResult(result)) {
    return false;
  }

  if (!resolution) {
    return result.extraTime === undefined && result.penalties === undefined;
  }
  if (resolution === "aggregate-then-penalties") {
    const aggregateIsTied = aggregateScore !== undefined
      && aggregateScore.homeGoals + result.homeGoals
        === aggregateScore.awayGoals + result.awayGoals;
    return result.extraTime === undefined
      && (result.penalties === undefined
        ? !aggregateIsTied
        : aggregateIsTied && result.penalties.homeGoals !== result.penalties.awayGoals);
  }
  const isRegulationDraw = result.homeGoals === result.awayGoals;
  if (!isRegulationDraw) {
    return result.extraTime === undefined && result.penalties === undefined;
  }
  if (resolution === "penalties") {
    return result.extraTime === undefined
      && result.penalties !== undefined
      && result.penalties.homeGoals !== result.penalties.awayGoals;
  }
  if (!result.extraTime) {
    return false;
  }
  const homeAfterExtraTime = result.homeGoals + result.extraTime.homeGoals;
  const awayAfterExtraTime = result.awayGoals + result.extraTime.awayGoals;
  if (homeAfterExtraTime !== awayAfterExtraTime) {
    return result.penalties === undefined;
  }
  return result.penalties !== undefined
    && result.penalties.homeGoals !== result.penalties.awayGoals;
}

export function isValidFixtureResult(
  tournament: Tournament,
  matchday: Matchday,
  fixture: Fixture,
  validationMatchdays: readonly Matchday[] = tournament.matchdays,
): boolean {
  if (fixture.operationalState && fixture.operationalState.status !== "finished") return false;
  const result = fixture.result;
  if (!result) return false;
  const aggregateScore = getAggregateScoreBeforeFixture(validationMatchdays, matchday, fixture);
  if (isValidKnockoutResult(result, fixture.knockoutResolution, aggregateScore)) return true;

  return tournament.id === "arg-liga-profesional-2026"
    && fixture.knockoutResolution === "extra-time-then-penalties"
    && result.homeGoals === result.awayGoals
    && result.extraTime === undefined
    && result.penalties !== undefined
    && result.penalties.homeGoals !== result.penalties.awayGoals
    && isValidMatchResult(result);
}

function isValidScore(score: { readonly homeGoals: number; readonly awayGoals: number }): boolean {
  return Number.isInteger(score.homeGoals)
    && score.homeGoals >= 0
    && score.homeGoals <= 99
    && Number.isInteger(score.awayGoals)
    && score.awayGoals >= 0
    && score.awayGoals <= 99;
}
