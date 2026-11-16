import type { Fixture } from "../entities/tournament";

export function reconcileFixtureParticipants(
  fixture: Fixture,
  homeTeamId: string,
  awayTeamId: string,
): Fixture | undefined {
  if (homeTeamId === awayTeamId) return undefined;
  if (fixture.homeTeamId === homeTeamId && fixture.awayTeamId === awayTeamId) {
    return fixture;
  }

  const {
    result: _result,
    goalScorers: _goalScorers,
    lineups: _lineups,
    substitutions: _substitutions,
    events: _events,
    eventsCoverage: _eventsCoverage,
    operationalState: _operationalState,
    ...fixtureWithoutMatchData
  } = fixture;
  return {
    ...fixtureWithoutMatchData,
    homeTeamId,
    awayTeamId,
  };
}

export function reconcileFixturesWithAdvancers(
  fixtures: readonly Fixture[],
  advancingTeams: ReadonlyMap<string, string | undefined>,
): { fixtures: Fixture[]; unresolvedTeamIds: Set<string> } {
  const reconciled: Fixture[] = [];
  const unresolvedTeamIds = new Set<string>();
  const usedTeamIds = new Set<string>();

  for (const fixture of fixtures) {
    const homeTeamId = advancingTeams.has(fixture.homeTeamId)
      ? advancingTeams.get(fixture.homeTeamId)
      : fixture.homeTeamId;
    const awayTeamId = advancingTeams.has(fixture.awayTeamId)
      ? advancingTeams.get(fixture.awayTeamId)
      : fixture.awayTeamId;

    if (homeTeamId === undefined || awayTeamId === undefined) {
      unresolvedTeamIds.add(fixture.homeTeamId);
      unresolvedTeamIds.add(fixture.awayTeamId);
      if (homeTeamId !== undefined) unresolvedTeamIds.add(homeTeamId);
      if (awayTeamId !== undefined) unresolvedTeamIds.add(awayTeamId);
      continue;
    }

    const updated = reconcileFixtureParticipants(fixture, homeTeamId, awayTeamId);
    if (!updated || usedTeamIds.has(homeTeamId) || usedTeamIds.has(awayTeamId)) {
      unresolvedTeamIds.add(fixture.homeTeamId);
      unresolvedTeamIds.add(fixture.awayTeamId);
      unresolvedTeamIds.add(homeTeamId);
      unresolvedTeamIds.add(awayTeamId);
      continue;
    }

    if (homeTeamId !== fixture.homeTeamId) unresolvedTeamIds.add(fixture.homeTeamId);
    if (awayTeamId !== fixture.awayTeamId) unresolvedTeamIds.add(fixture.awayTeamId);
    usedTeamIds.add(homeTeamId);
    usedTeamIds.add(awayTeamId);
    reconciled.push(updated);
  }

  return { fixtures: reconciled, unresolvedTeamIds };
}
