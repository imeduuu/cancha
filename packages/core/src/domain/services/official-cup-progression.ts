import type {
  Fixture,
  KnockoutStage,
  Matchday,
  Tournament,
} from "../entities/tournament";
import {
  reconcileFixtureParticipants,
  reconcileFixturesWithAdvancers,
} from "./knockout-fixture-reconciliation";
import { isOperationallyFinished } from "./match-operational-status";
import { isValidFixtureResult, isValidMatchResult } from "./match-result-validation";
import {
  calculateStandings,
  getUnresolvedStandingsTieDetails,
} from "./standings";

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("es");
}

function getStageMatchdays(
  matchdays: readonly Matchday[],
  stage: KnockoutStage,
  leg: 1 | 2,
): Matchday[] {
  const suffix = stage.legs === 1 ? "" : leg === 1 ? " · Ida" : " · Vuelta";
  const expected = normalized(`${stage.name}${suffix}`);
  return matchdays.filter((matchday) => normalized(matchday.phaseName ?? "") === expected);
}

function scoreForTeam(fixture: Fixture, teamId: string): number | undefined {
  if (!fixture.result || !isOperationallyFinished(fixture) || !isValidMatchResult(fixture.result)) {
    return undefined;
  }
  const score = fixture.result.homeGoals
    + (fixture.result.extraTime?.homeGoals ?? 0);
  const opposingScore = fixture.result.awayGoals
    + (fixture.result.extraTime?.awayGoals ?? 0);
  if (fixture.homeTeamId === teamId) return score;
  if (fixture.awayTeamId === teamId) return opposingScore;
  return undefined;
}

function getSingleMatchWinner(fixture: Fixture): string | undefined {
  const homeScore = scoreForTeam(fixture, fixture.homeTeamId);
  const awayScore = scoreForTeam(fixture, fixture.awayTeamId);
  if (homeScore === undefined || awayScore === undefined) return undefined;
  if (homeScore !== awayScore) return homeScore > awayScore ? fixture.homeTeamId : fixture.awayTeamId;

  const penalties = fixture.result?.penalties;
  if (!penalties || penalties.homeGoals === penalties.awayGoals) return undefined;
  return penalties.homeGoals > penalties.awayGoals ? fixture.homeTeamId : fixture.awayTeamId;
}

function getTwoLegWinners(
  firstLegs: readonly Fixture[],
  returnLegs: readonly Fixture[],
): string[] | undefined {
  if (firstLegs.length === 0 || firstLegs.length !== returnLegs.length) return undefined;
  const winners: string[] = [];
  for (const firstLeg of firstLegs) {
    if (!firstLeg.result) return undefined;
    const returnLeg = returnLegs.find((fixture) =>
      fixture.homeTeamId === firstLeg.homeTeamId && fixture.awayTeamId === firstLeg.awayTeamId
      || fixture.homeTeamId === firstLeg.awayTeamId && fixture.awayTeamId === firstLeg.homeTeamId,
    );
    if (!returnLeg?.result) return undefined;

    const firstHome = scoreForTeam(firstLeg, firstLeg.homeTeamId);
    const firstAway = scoreForTeam(firstLeg, firstLeg.awayTeamId);
    const returnHome = scoreForTeam(returnLeg, firstLeg.homeTeamId);
    const returnAway = scoreForTeam(returnLeg, firstLeg.awayTeamId);
    if (
      firstHome === undefined
      || firstAway === undefined
      || returnHome === undefined
      || returnAway === undefined
    ) {
      return undefined;
    }
    const homeAggregate = firstHome + returnHome;
    const awayAggregate = firstAway + returnAway;
    if (homeAggregate !== awayAggregate) {
      winners.push(homeAggregate > awayAggregate ? firstLeg.homeTeamId : firstLeg.awayTeamId);
      continue;
    }

    const penalties = returnLeg.result.penalties;
    if (!penalties || penalties.homeGoals === penalties.awayGoals) return undefined;
    winners.push(
      penalties.homeGoals > penalties.awayGoals ? returnLeg.homeTeamId : returnLeg.awayTeamId,
    );
  }
  return winners;
}

function getCopaLigaSemifinalWinners(
  tournament: Tournament,
  stage: KnockoutStage,
): string[] | undefined {
  const firstDays = getStageMatchdays(tournament.matchdays, stage, 1);
  const returnDays = getStageMatchdays(tournament.matchdays, stage, 2);
  const firstLegs = firstDays.flatMap(({ fixtures }) => fixtures);
  const returnLegs = returnDays.flatMap(({ fixtures }) => fixtures);
  if (firstLegs.length !== 2 || returnLegs.length !== 2
    || [...firstDays, ...returnDays].some((matchday) => matchday.fixtures.some((fixture) =>
      !isValidFixtureResult(tournament, matchday, fixture)))) return undefined;

  const pointsSystem = tournament.pointsSystem
    ?? tournament.competitionRules?.points
    ?? { win: 3, draw: 1, loss: 0 };
  const winners: string[] = [];
  const usedReturnLegs = new Set<Fixture>();
  for (const first of firstLegs) {
    const matchingReturns = returnLegs.filter((fixture) =>
      (fixture.homeTeamId === first.homeTeamId && fixture.awayTeamId === first.awayTeamId)
      || (fixture.homeTeamId === first.awayTeamId && fixture.awayTeamId === first.homeTeamId),
    );
    if (matchingReturns.length !== 1 || usedReturnLegs.has(matchingReturns[0])) return undefined;
    const second = matchingReturns[0];
    usedReturnLegs.add(second);
    const firstResult = first.result;
    const secondResult = second.result;
    if (!firstResult || !secondResult) return undefined;

    const pointsFor = (teamId: string): number => {
      let points = 0;
      for (const fixture of [first, second]) {
        const result = fixture.result;
        if (!result) return 0;
        const teamGoals = fixture.homeTeamId === teamId ? result.homeGoals : result.awayGoals;
        const opponentGoals = fixture.homeTeamId === teamId ? result.awayGoals : result.homeGoals;
        points += teamGoals > opponentGoals
          ? pointsSystem.win
          : teamGoals === opponentGoals ? pointsSystem.draw : pointsSystem.loss;
      }
      return points;
    };
    const homePoints = pointsFor(first.homeTeamId);
    const awayPoints = pointsFor(first.awayTeamId);
    if (homePoints !== awayPoints) {
      winners.push(homePoints > awayPoints ? first.homeTeamId : first.awayTeamId);
      continue;
    }

    const homeAggregate = scoreForTeam(first, first.homeTeamId)! + scoreForTeam(second, first.homeTeamId)!;
    const awayAggregate = scoreForTeam(first, first.awayTeamId)! + scoreForTeam(second, first.awayTeamId)!;
    if (homeAggregate !== awayAggregate) {
      winners.push(homeAggregate > awayAggregate ? first.homeTeamId : first.awayTeamId);
      continue;
    }

    const penalties = secondResult.penalties;
    if (!penalties || penalties.homeGoals === penalties.awayGoals) return undefined;
    winners.push(penalties.homeGoals > penalties.awayGoals ? second.homeTeamId : second.awayTeamId);
  }
  return usedReturnLegs.size === returnLegs.length ? winners : undefined;
}

export function getCompletedStageWinners(
  matchdays: readonly Matchday[],
  stage: KnockoutStage,
): string[] | undefined {
  if (stage.legs === 1) {
    const fixtures = getStageMatchdays(matchdays, stage, 1).flatMap(({ fixtures }) => fixtures);
    if (fixtures.length === 0) return undefined;
    const winners = fixtures.map(getSingleMatchWinner);
    return winners.some((winner) => !winner)
      ? undefined
      : winners.filter((winner): winner is string => winner !== undefined);
  }

  const firstLegs = getStageMatchdays(matchdays, stage, 1).flatMap(({ fixtures }) => fixtures);
  const returnLegs = getStageMatchdays(matchdays, stage, 2).flatMap(({ fixtures }) => fixtures);
  return getTwoLegWinners(firstLegs, returnLegs);
}

function getStageAdvancers(
  matchdays: readonly Matchday[],
  stage: KnockoutStage,
  unresolvedTeamIds: ReadonlySet<string>,
): Map<string, string | undefined> {
  const advancingTeams = new Map<string, string | undefined>();
  for (const teamId of unresolvedTeamIds) advancingTeams.set(teamId, undefined);

  if (stage.legs === 1) {
    for (const matchday of getStageMatchdays(matchdays, stage, 1)) {
      for (const fixture of matchday.fixtures) {
        const winner = getSingleMatchWinner(fixture);
        advancingTeams.set(fixture.homeTeamId, winner);
        advancingTeams.set(fixture.awayTeamId, winner);
      }
    }
    return advancingTeams;
  }

  const firstLegs = getStageMatchdays(matchdays, stage, 1).flatMap(({ fixtures }) => fixtures);
  const returnLegs = getStageMatchdays(matchdays, stage, 2).flatMap(({ fixtures }) => fixtures);
  for (const firstLeg of firstLegs) {
    const returnLeg = returnLegs.find((fixture) =>
      fixture.homeTeamId === firstLeg.homeTeamId && fixture.awayTeamId === firstLeg.awayTeamId
      || fixture.homeTeamId === firstLeg.awayTeamId && fixture.awayTeamId === firstLeg.homeTeamId,
    );
    const winner = returnLeg
      ? getTwoLegWinners([firstLeg], [returnLeg])?.[0]
      : undefined;
    advancingTeams.set(firstLeg.homeTeamId, winner);
    advancingTeams.set(firstLeg.awayTeamId, winner);
  }
  for (const returnLeg of returnLegs) {
    if (!advancingTeams.has(returnLeg.homeTeamId)) {
      advancingTeams.set(returnLeg.homeTeamId, undefined);
    }
    if (!advancingTeams.has(returnLeg.awayTeamId)) {
      advancingTeams.set(returnLeg.awayTeamId, undefined);
    }
  }
  return advancingTeams;
}

function stageTieCount(matchdays: readonly Matchday[], stage: KnockoutStage): number {
  return getStageMatchdays(matchdays, stage, 1)
    .reduce((count, matchday) => count + matchday.fixtures.length, 0);
}

function reconcileStageFromPrevious(
  tournament: Tournament,
  previousStage: KnockoutStage,
  stage: KnockoutStage,
  unresolvedTeamIds: ReadonlySet<string>,
): { tournament: Tournament; unresolvedTeamIds: Set<string> } {
  const advancingTeams = getStageAdvancers(
    tournament.matchdays,
    previousStage,
    unresolvedTeamIds,
  );
  const phaseNames = stage.legs === 1
    ? [stage.name]
    : [`${stage.name} · Ida`, `${stage.name} · Vuelta`];
  const nextUnresolvedTeamIds = new Set(unresolvedTeamIds);
  const usedTeamIdsByPhase = new Map<string, Set<string>>();
  let changed = false;
  const matchdays = tournament.matchdays.map((matchday) => {
    if (!phaseNames.some((name) => normalized(name) === normalized(matchday.phaseName ?? ""))) {
      return matchday;
    }
    const result = reconcileFixturesWithAdvancers(matchday.fixtures, advancingTeams);
    for (const teamId of result.unresolvedTeamIds) nextUnresolvedTeamIds.add(teamId);
    const phaseKey = stage.legs === 2
      && normalized(matchday.phaseName ?? "").endsWith(" · vuelta")
      ? "return"
      : "first";
    const usedTeamIds = usedTeamIdsByPhase.get(phaseKey) ?? new Set<string>();
    usedTeamIdsByPhase.set(phaseKey, usedTeamIds);
    const fixtures = result.fixtures.filter((fixture) => {
      if (usedTeamIds.has(fixture.homeTeamId) || usedTeamIds.has(fixture.awayTeamId)) {
        nextUnresolvedTeamIds.add(fixture.homeTeamId);
        nextUnresolvedTeamIds.add(fixture.awayTeamId);
        return false;
      }
      usedTeamIds.add(fixture.homeTeamId);
      usedTeamIds.add(fixture.awayTeamId);
      return true;
    });
    if (
      fixtures.length === matchday.fixtures.length
      && fixtures.every((fixture, index) => fixture === matchday.fixtures[index])
    ) {
      return matchday;
    }
    changed = true;
    return { ...matchday, fixtures };
  });
  return {
    tournament: changed ? { ...tournament, matchdays } : tournament,
    unresolvedTeamIds: nextUnresolvedTeamIds,
  };
}

function removeInvalidAggregatePenalties(
  tournament: Tournament,
  stage: KnockoutStage,
): Tournament {
  if (stage.legs !== 2) return tournament;

  const firstLegs = getStageMatchdays(tournament.matchdays, stage, 1).flatMap(
    ({ fixtures }) => fixtures,
  );
  let changed = false;
  const matchdays = tournament.matchdays.map((matchday) => {
    if (!getStageMatchdays([matchday], stage, 2).length) return matchday;
    return {
      ...matchday,
      fixtures: matchday.fixtures.map((fixture) => {
        const result = fixture.result;
        if (
          !result?.penalties
          || !isOperationallyFinished(fixture)
          || !isValidMatchResult(result)
        ) return fixture;
        const firstLeg = firstLegs.find((candidate) =>
          candidate.homeTeamId === fixture.homeTeamId && candidate.awayTeamId === fixture.awayTeamId
          || candidate.homeTeamId === fixture.awayTeamId && candidate.awayTeamId === fixture.homeTeamId,
        );
        if (
          !firstLeg?.result
          || !isOperationallyFinished(firstLeg)
          || !isValidMatchResult(firstLeg.result)
        ) return fixture;
        const firstHome = firstLeg.homeTeamId === fixture.homeTeamId
          ? firstLeg.result.homeGoals
          : firstLeg.result.awayGoals;
        const firstAway = firstLeg.homeTeamId === fixture.homeTeamId
          ? firstLeg.result.awayGoals
          : firstLeg.result.homeGoals;
        if (firstHome + result.homeGoals === firstAway + result.awayGoals) return fixture;
        const { penalties: _penalties, ...score } = result;
        changed = true;
        return { ...fixture, result: score };
      }),
    };
  });
  return changed ? { ...tournament, matchdays } : tournament;
}

function emptyMatchday(name: string, leg: number): Matchday {
  return { number: 1, leg, phaseName: name, fixtures: [] };
}

function orderAndCompleteCupPhases(tournament: Tournament): Tournament {
  const stages = tournament.knockoutStages ?? [];
  if (stages.length === 0) return tournament;

  const phaseNames = new Set<string>();
  const orderedStages: Matchday[] = [];
  for (const stage of stages) {
    const phaseNamesForStage = stage.legs === 1
      ? [stage.name]
      : [`${stage.name} · Ida`, `${stage.name} · Vuelta`];
    for (const phaseName of phaseNamesForStage) {
      phaseNames.add(normalized(phaseName));
      const existing = tournament.matchdays.filter(
        (matchday) => normalized(matchday.phaseName ?? "") === normalized(phaseName),
      );
      if (existing.length > 0) {
        orderedStages.push(...existing);
      } else {
        orderedStages.push(emptyMatchday(phaseName, 1));
      }
    }
  }

  const nonKnockoutMatchdays = tournament.matchdays.filter(
    (matchday) => !phaseNames.has(normalized(matchday.phaseName ?? "")),
  );
  const combined = [...nonKnockoutMatchdays, ...orderedStages];
  let leg = 0;
  const indexed = combined.map((matchday, index) => {
    const previous = combined[index - 1];
    if (!previous || previous.phaseName !== matchday.phaseName) leg += 1;
    return { ...matchday, leg };
  });
  if (indexed.every((matchday, index) =>
    matchday === tournament.matchdays[index]
    || JSON.stringify(matchday) === JSON.stringify(tournament.matchdays[index]),
  )) {
    return tournament;
  }
  return { ...tournament, legs: leg, matchdays: indexed };
}

function createStageFixtures(
  tournament: Tournament,
  stage: KnockoutStage,
  winners: readonly string[],
  stageIndex: number,
): Tournament {
  if (winners.length < 2 || winners.length % 2 !== 0) return tournament;
  const pairs = Array.from({ length: winners.length / 2 }, (_, index) => [
    winners[index * 2],
    winners[index * 2 + 1],
  ] as const);
  const firstLegName = stage.legs === 1 ? stage.name : `${stage.name} · Ida`;
  const returnLegName = `${stage.name} · Vuelta`;
  const fixtureId = (matchIndex: number, leg: number) =>
    `${tournament.id}-cup-stage-${stageIndex + 1}-${matchIndex + 1}-${leg}`;
  const fixtures: Fixture[] = pairs.map(([homeTeamId, awayTeamId], index) => ({
    id: fixtureId(index, 1),
    homeTeamId,
    awayTeamId,
    ...(stage.legs === 1 ? { knockoutResolution: "penalties" as const } : {}),
  }));
  const nextMatchdays = tournament.matchdays.map((matchday) => {
    if (normalized(matchday.phaseName ?? "") === normalized(firstLegName)) {
      return { ...matchday, fixtures };
    }
    if (stage.legs === 2 && normalized(matchday.phaseName ?? "") === normalized(returnLegName)) {
      return {
        ...matchday,
        fixtures: pairs.map(([homeTeamId, awayTeamId], index) => ({
          id: fixtureId(index, 2),
          homeTeamId: awayTeamId,
          awayTeamId: homeTeamId,
          knockoutResolution: "aggregate-then-penalties" as const,
        })),
      };
    }
    return matchday;
  });
  return { ...tournament, matchdays: nextMatchdays };
}

export function advanceOfficialCupProgression(tournament: Tournament): Tournament {
  if (tournament.id === "anfp-copa-de-la-liga-2026" && tournament.season === 2026) {
    return advanceCopaLiga2026(tournament);
  }
  if (tournament.competitionType !== "cup" || !tournament.knockoutStages?.length) {
    return tournament;
  }

  let current = orderAndCompleteCupPhases(tournament);
  const stages = current.knockoutStages ?? [];
  let unresolvedTeamIds = new Set<string>();
  for (let index = 0; index < stages.length - 1; index += 1) {
    const stage = stages[index];
    if (index > 0 && stages[index - 1].advanceWinners !== false) {
      const reconciled = reconcileStageFromPrevious(
        current,
        stages[index - 1],
        stage,
        unresolvedTeamIds,
      );
      current = reconciled.tournament;
      unresolvedTeamIds = reconciled.unresolvedTeamIds;
    }
    current = removeInvalidAggregatePenalties(current, stage);
    if (stage.advanceWinners === false) continue;

    const winners = getCompletedStageWinners(current.matchdays, stage);
    if (!winners) continue;
    const currentTieCount = stageTieCount(current.matchdays, stage);
    if (winners.length !== currentTieCount) continue;
    if (index > 0 && stages[index - 1].advanceWinners !== false) {
      const previousWinners = getCompletedStageWinners(
        current.matchdays,
        stages[index - 1],
      );
      if (!previousWinners || currentTieCount !== Math.ceil(previousWinners.length / 2)) {
        continue;
      }
    }
    const nextStage = stages[index + 1];
    const expectedNextTieCount = Math.ceil(winners.length / 2);
    const nextPhase = nextStage.legs === 1 ? nextStage.name : `${nextStage.name} · Ida`;
    const nextMatchday = current.matchdays.find(
      (matchday) => normalized(matchday.phaseName ?? "") === normalized(nextPhase),
    );
    if (!nextMatchday || nextMatchday.fixtures.length >= expectedNextTieCount) continue;
    if (nextMatchday.fixtures.length > 0) continue;
    current = createStageFixtures(current, nextStage, winners, index + 1);
  }
  if (stages.length > 1 && stages[stages.length - 2].advanceWinners !== false) {
    const reconciled = reconcileStageFromPrevious(
      current,
      stages[stages.length - 2],
      stages[stages.length - 1],
      unresolvedTeamIds,
    );
    current = reconciled.tournament;
  }
  current = removeInvalidAggregatePenalties(current, stages[stages.length - 1]);
  return current;
}

function getCopaLigaGroupWinners(tournament: Tournament): string[] | undefined {
  const groupedTeams = new Map<string, typeof tournament.teams[number][]>();
  for (const team of tournament.teams) {
    if (!team.groupName) return undefined;
    const group = groupedTeams.get(team.groupName) ?? [];
    group.push(team);
    groupedTeams.set(team.groupName, group);
  }
  if (tournament.teams.length !== 16 || groupedTeams.size !== 4
    || [...groupedTeams.values()].some((teams) => teams.length !== 4)) return undefined;

  const numbers = tournament.teams.map(({ competitionNumber }) => competitionNumber);
  if (numbers.some((number) => !Number.isSafeInteger(number) || (number ?? 0) < 1 || (number ?? 0) > 16)
    || new Set(numbers).size !== 16) return undefined;

  const winners: string[] = [];
  for (const [groupName, teams] of groupedTeams) {
    const phaseName = normalized(`Copa de la Liga · ${groupName}`);
    const matchdays = tournament.matchdays.filter((matchday) =>
      normalized(matchday.phaseName ?? "") === phaseName,
    );
    const fixtures = matchdays.flatMap(({ fixtures }) => fixtures);
    if (fixtures.length !== 12) return undefined;
    const teamIds = new Set(teams.map(({ id }) => id));
    const appearances = new Map(teams.map(({ id }) => [id, 0]));
    const meetings = new Map<string, Fixture[]>();
    for (const matchday of matchdays) {
      for (const fixture of matchday.fixtures) {
        if (!teamIds.has(fixture.homeTeamId) || !teamIds.has(fixture.awayTeamId)
          || fixture.homeTeamId === fixture.awayTeamId
          || !isValidFixtureResult(tournament, matchday, fixture)) return undefined;
        appearances.set(fixture.homeTeamId, (appearances.get(fixture.homeTeamId) ?? 0) + 1);
        appearances.set(fixture.awayTeamId, (appearances.get(fixture.awayTeamId) ?? 0) + 1);
        const key = [fixture.homeTeamId, fixture.awayTeamId].sort().join("|");
        meetings.set(key, [...(meetings.get(key) ?? []), fixture]);
      }
    }
    if ([...appearances.values()].some((count) => count !== 6)
      || meetings.size !== 6
      || [...meetings.values()].some((pair) => pair.length !== 2
        || pair[0].homeTeamId === pair[1].homeTeamId)) return undefined;

    const groupTournament = { ...tournament, teams, matchdays };
    const standings = calculateStandings(groupTournament);
    const first = standings[0];
    if (!first || getUnresolvedStandingsTieDetails(groupTournament, standings)
      .some(({ teams: tiedTeams }) => tiedTeams.some(({ teamId }) => teamId === first.teamId))) {
      return undefined;
    }
    winners.push(first.teamId);
  }
  return winners;
}

function phaseMatchdays(tournament: Tournament, phaseName: string): Matchday[] {
  return tournament.matchdays.filter((matchday) =>
    normalized(matchday.phaseName ?? "") === normalized(phaseName),
  );
}

function reconcileCopaLigaFixtures(
  existing: readonly Fixture[],
  expected: readonly Fixture[],
): Fixture[] | undefined {
  const used = new Set<Fixture>();
  const reconciled: Fixture[] = [];
  for (let index = 0; index < expected.length; index += 1) {
    const desired = expected[index];
    const exact = existing.find((fixture) => !used.has(fixture)
      && fixture.homeTeamId === desired.homeTeamId
      && fixture.awayTeamId === desired.awayTeamId);
    const previous = exact ?? existing.find((fixture) => !used.has(fixture));
    if (!previous) {
      reconciled.push(desired);
      continue;
    }
    const participantsChange = previous.homeTeamId !== desired.homeTeamId
      || previous.awayTeamId !== desired.awayTeamId;
    if (participantsChange && hasRegisteredCopaLigaMatchData(previous)) return undefined;
    used.add(previous);
    const updatedFixture = reconcileFixtureParticipants(
      previous,
      desired.homeTeamId,
      desired.awayTeamId,
    );
    if (!updatedFixture) return undefined;
    reconciled.push({
      ...updatedFixture,
      ...(desired.knockoutResolution
        ? { knockoutResolution: desired.knockoutResolution }
        : {}),
    });
  }
  return reconciled;
}

function hasRegisteredCopaLigaMatchData(fixture: Fixture): boolean {
  return fixture.result !== undefined
    || fixture.goalScorers !== undefined
    || fixture.lineups !== undefined
    || fixture.substitutions !== undefined
    || fixture.events !== undefined
    || fixture.operationalState !== undefined
    || fixture.schedule !== undefined;
}

function advanceCopaLiga2026(tournament: Tournament): Tournament {
  const stages = tournament.knockoutStages ?? [];
  const semifinal = stages.find((stage) => normalized(stage.name) === normalized("Copa de la Liga · Semifinales"));
  const final = stages.find((stage) => normalized(stage.name) === normalized("Copa de la Liga · Final"));
  if (!semifinal || semifinal.legs !== 2 || !final || final.legs !== 1) return tournament;

  const groupWinners = getCopaLigaGroupWinners(tournament);
  if (!groupWinners || groupWinners.length !== 4) return tournament;
  const byNumber = new Map(tournament.teams.map((team) => [team.id, team.competitionNumber as number]));
  const ranked = [...groupWinners].sort((first, second) =>
    (byNumber.get(first) ?? Number.MAX_SAFE_INTEGER)
      - (byNumber.get(second) ?? Number.MAX_SAFE_INTEGER),
  );
  const ties = [[ranked[0], ranked[3]], [ranked[1], ranked[2]]] as const;
  const semiBase = semifinal.name;
  const firstName = `${semiBase} · Ida`;
  const returnName = `${semiBase} · Vuelta`;
  const makeLegFixtures = (leg: 1 | 2): Fixture[] => ties.map(([better, worse], index) => ({
    id: `${tournament.id}-copa-liga-2026-semifinal-${index + 1}-${leg === 1 ? "ida" : "vuelta"}`,
    homeTeamId: leg === 1 ? worse : better,
    awayTeamId: leg === 1 ? better : worse,
    ...(leg === 2 ? { knockoutResolution: "aggregate-then-penalties" as const } : {}),
  }));
  let current = orderAndCompleteCupPhases(tournament);
  const existingFirst = phaseMatchdays(current, firstName);
  const existingReturn = phaseMatchdays(current, returnName);
  const firstFixtures = reconcileCopaLigaFixtures(existingFirst[0]?.fixtures ?? [], makeLegFixtures(1));
  const returnFixtures = reconcileCopaLigaFixtures(existingReturn[0]?.fixtures ?? [], makeLegFixtures(2));
  if (!firstFixtures || !returnFixtures) return current;
  current = {
    ...current,
    matchdays: current.matchdays.map((matchday) => {
      if (normalized(matchday.phaseName ?? "") === normalized(firstName)) {
        return { ...matchday, fixtures: firstFixtures };
      }
      if (normalized(matchday.phaseName ?? "") === normalized(returnName)) {
        return { ...matchday, fixtures: returnFixtures };
      }
      return matchday;
    }),
  };

  const semiFirst = phaseMatchdays(current, `${semiBase} · Ida`);
  const semiReturn = phaseMatchdays(current, `${semiBase} · Vuelta`);
  if (semiFirst.length === 0 || semiReturn.length === 0
    || [...semiFirst, ...semiReturn].some((matchday) =>
      matchday.fixtures.length !== 2
      || matchday.fixtures.some((fixture) => !isValidFixtureResult(current, matchday, fixture)))) {
    return current;
  }
  const winners = getCopaLigaSemifinalWinners(current, semifinal);
  if (!winners || winners.length !== 2) return current;
  const finalName = final.name;
  const firstFinal = phaseMatchdays(current, finalName)[0];
  if (!firstFinal) return current;
  const desiredFinal: Fixture = {
    id: `${tournament.id}-copa-liga-2026-final`,
    homeTeamId: winners[0],
    awayTeamId: winners[1],
    knockoutResolution: "penalties",
  };
  const reconciled = reconcileCopaLigaFixtures(firstFinal.fixtures, [desiredFinal]);
  if (!reconciled) return current;
  return {
    ...current,
    matchdays: current.matchdays.map((matchday) => matchday === firstFinal
      ? { ...matchday, fixtures: reconciled }
      : matchday),
  };
}
