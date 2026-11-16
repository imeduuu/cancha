import type {
  Fixture,
  Matchday,
  MatchResult,
} from "../entities/tournament";

export function getAggregateScoreBeforeFixture(
  matchdays: readonly Matchday[],
  matchday: Matchday,
  fixture: Fixture,
  resultsByFixtureId?: ReadonlyMap<string, MatchResult | undefined>,
) {
  const phaseName = matchday.phaseName;
  const vueltaSuffix = " · Vuelta";
  if (!phaseName?.endsWith(vueltaSuffix)) return undefined;

  const firstLegPhase = `${phaseName.slice(0, -vueltaSuffix.length)} · Ida`;
  for (const firstLegMatchday of matchdays) {
    if (firstLegMatchday.phaseName !== firstLegPhase) continue;
    const firstLegFixture = firstLegMatchday.fixtures.find((candidate) =>
      candidate.homeTeamId === fixture.homeTeamId && candidate.awayTeamId === fixture.awayTeamId
      || candidate.homeTeamId === fixture.awayTeamId && candidate.awayTeamId === fixture.homeTeamId,
    );
    if (!firstLegFixture) continue;
    if (
      firstLegFixture.operationalState
      && firstLegFixture.operationalState.status !== "finished"
    ) return undefined;

    const result = resultsByFixtureId?.has(firstLegFixture.id)
      ? resultsByFixtureId.get(firstLegFixture.id)
      : firstLegFixture.result;
    if (!result || !isValidScore(result)) return undefined;
    return firstLegFixture.homeTeamId === fixture.homeTeamId
      ? { homeGoals: result.homeGoals, awayGoals: result.awayGoals }
      : { homeGoals: result.awayGoals, awayGoals: result.homeGoals };
  }
  return undefined;
}

function isValidScore(result: MatchResult): boolean {
  return [result, result.extraTime, result.penalties]
    .filter((score) => score !== undefined)
    .every((score) =>
      Number.isInteger(score.homeGoals)
      && score.homeGoals >= 0
      && score.homeGoals <= 99
      && Number.isInteger(score.awayGoals)
      && score.awayGoals >= 0
      && score.awayGoals <= 99,
    );
}
