import type { Fixture, Matchday, Tournament } from "../entities/tournament";
import type { Team } from "../entities/team";
import { calculateStandings } from "./standings";
import { reconcileFixtureParticipants } from "./knockout-fixture-reconciliation";
import { isValidFixtureResult } from "./match-result-validation";

const ASCENSO_TOURNAMENT_ID = "anfp-liga-de-ascenso-2026";
const PLAYOFF_PREFIX = "Liguilla de Ascenso";
const REGULAR_PHASE = "Fase regular";
const FORMAT_NOTE =
  "Liguilla de Ascenso basada en el formato ANFP documentado para 2025; estructura provisional para 2026.";

interface Tie {
  readonly homeTeamId: string;
  readonly awayTeamId: string;
}

interface StageSpec {
  readonly name: string;
  readonly leg: number;
  readonly returnLeg: boolean;
  readonly resolution: boolean;
}

const stages: readonly StageSpec[] = [
  { name: "Cuartos de final", leg: 2, returnLeg: false, resolution: false },
  { name: "Cuartos de final", leg: 3, returnLeg: true, resolution: true },
  { name: "Semifinal", leg: 4, returnLeg: false, resolution: false },
  { name: "Semifinal", leg: 5, returnLeg: true, resolution: true },
  { name: "Final", leg: 6, returnLeg: false, resolution: false },
  { name: "Final", leg: 7, returnLeg: true, resolution: true },
];

function isPlayoffMatchday(matchday: Matchday): boolean {
  return matchday.phaseName?.startsWith(PLAYOFF_PREFIX) ?? false;
}

function isRegularMatchday(matchday: Matchday): boolean {
  return !isPlayoffMatchday(matchday)
    && (!matchday.phaseName || matchday.phaseName === REGULAR_PHASE);
}

function hasValidTeams(teams: readonly Team[]): boolean {
  return teams.length >= 8
    && new Set(teams.map(({ id }) => id)).size === teams.length
    && teams.every(({ id, name }) => id.trim().length > 0 && name.trim().length > 0);
}

function hasCompleteRoundRobin(
  tournament: Tournament,
  matchdays: readonly Matchday[],
): boolean {
  const teamIds = new Set(tournament.teams.map(({ id }) => id));
  const pairs = new Map<string, number>();
  const matchdayNumbers = new Set<number>();
  let matchCount = 0;

  for (const matchday of matchdays) {
    if (matchdayNumbers.has(matchday.number)) return false;
    matchdayNumbers.add(matchday.number);
    const teamsInMatchday = new Set<string>();
    for (const fixture of matchday.fixtures) {
      if (
        !teamIds.has(fixture.homeTeamId)
        || !teamIds.has(fixture.awayTeamId)
        || fixture.homeTeamId === fixture.awayTeamId
        || teamsInMatchday.has(fixture.homeTeamId)
        || teamsInMatchday.has(fixture.awayTeamId)
        || !isValidFixtureResult(tournament, matchday, fixture)
      ) {
        return false;
      }
      teamsInMatchday.add(fixture.homeTeamId);
      teamsInMatchday.add(fixture.awayTeamId);
      const pair = [fixture.homeTeamId, fixture.awayTeamId].sort().join("|");
      pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
      matchCount += 1;
    }
  }

  const teamCount = tournament.teams.length;
  const pairCount = teamCount * (teamCount - 1) / 2;
  if (pairCount === 0 || matchCount % pairCount !== 0) return false;
  const legs = matchCount / pairCount;
  const roundsPerLeg = teamCount % 2 === 0 ? teamCount - 1 : teamCount;
  return legs > 0
    && pairs.size === pairCount
    && [...pairs.values()].every((count) => count === legs)
    && matchdayNumbers.size === roundsPerLeg * legs;
}

function getTieWinner(
  tournament: Tournament,
  matchdays: readonly Matchday[],
  tieNumber: number,
  phaseName: string,
  expectedTie: Tie,
): string | undefined {
  const tieId = `${ASCENSO_TOURNAMENT_ID}-${phaseName}-${tieNumber}`;
  const fixtures = matchdays.flatMap(({ fixtures: dayFixtures }) => dayFixtures);
  const firstLeg = fixtures.find(({ id }) => id === `${tieId}-ida`);
  const returnLeg = fixtures.find(({ id }) => id === `${tieId}-vuelta`);
  const firstMatchday = matchdays.find(({ fixtures: dayFixtures }) =>
    dayFixtures.some(({ id }) => id === firstLeg?.id),
  );
  const returnMatchday = matchdays.find(({ fixtures: dayFixtures }) =>
    dayFixtures.some(({ id }) => id === returnLeg?.id),
  );
  if (
    !firstLeg?.result
    || !returnLeg?.result
    || !firstMatchday
    || !returnMatchday
    || !isValidFixtureResult(tournament, firstMatchday, firstLeg)
    || !isValidFixtureResult(tournament, returnMatchday, returnLeg)
    || firstLeg.homeTeamId !== expectedTie.homeTeamId
    || firstLeg.awayTeamId !== expectedTie.awayTeamId
    || returnLeg.homeTeamId !== expectedTie.awayTeamId
    || returnLeg.awayTeamId !== expectedTie.homeTeamId
  ) {
    return undefined;
  }

  const firstResult = firstLeg.result;
  const returnResult = returnLeg.result;
  const homeAggregate = firstResult.homeGoals
    + (returnLeg.homeTeamId === firstLeg.homeTeamId
      ? returnResult.homeGoals
      : returnResult.awayGoals);
  const awayAggregate = firstResult.awayGoals
    + (returnLeg.homeTeamId === firstLeg.awayTeamId
      ? returnResult.homeGoals
      : returnResult.awayGoals);
  if (homeAggregate !== awayAggregate) {
    return homeAggregate > awayAggregate ? firstLeg.homeTeamId : firstLeg.awayTeamId;
  }
  const penalties = returnLeg.result.penalties;
  if (!penalties || penalties.homeGoals === penalties.awayGoals) return undefined;
  return penalties.homeGoals > penalties.awayGoals
    ? returnLeg.homeTeamId
    : returnLeg.awayTeamId;
}

function makeFixture(
  phaseName: string,
  tieNumber: number,
  tie: Tie,
  returnLeg: boolean,
  aggregateResolution: boolean,
): Fixture {
  return {
    id: `${ASCENSO_TOURNAMENT_ID}-${phaseName}-${tieNumber}-${returnLeg ? "vuelta" : "ida"}`,
    homeTeamId: returnLeg ? tie.awayTeamId : tie.homeTeamId,
    awayTeamId: returnLeg ? tie.homeTeamId : tie.awayTeamId,
    ...(aggregateResolution ? { knockoutResolution: "aggregate-then-penalties" as const } : {}),
  };
}

function reconcileStageMatchday(
  current: Tournament,
  regularMatchdays: readonly Matchday[],
  spec: StageSpec,
  ties: readonly (Tie | undefined)[],
): Matchday {
  const phaseName = `${PLAYOFF_PREFIX} · ${spec.name}${spec.returnLeg ? " · Vuelta" : " · Ida"}`;
  const previousFixtures = current.matchdays.find(({ phaseName: name }) => name === phaseName)
    ?.fixtures ?? [];
  const fixtures: Fixture[] = [];
  const usedTeams = new Set<string>();

  ties.forEach((tie, index) => {
    if (!tie || tie.homeTeamId === tie.awayTeamId) return;
    if (usedTeams.has(tie.homeTeamId) || usedTeams.has(tie.awayTeamId)) return;
    usedTeams.add(tie.homeTeamId);
    usedTeams.add(tie.awayTeamId);

    const candidate = makeFixture(spec.name, index + 1, tie, spec.returnLeg, spec.resolution);
    const previous = previousFixtures.find(({ id }) => id === candidate.id);
    const reconciled = previous
      ? reconcileFixtureParticipants(previous, candidate.homeTeamId, candidate.awayTeamId)
      : candidate;
    if (!reconciled) return;
    fixtures.push({
      ...reconciled,
      ...(spec.resolution ? { knockoutResolution: "aggregate-then-penalties" } : {}),
    });
  });

  return {
    number: regularMatchdays.length + spec.leg - 1,
    leg: spec.leg,
    phaseName,
    fixtures,
  };
}

function removeStalePlayoff(tournament: Tournament): Tournament {
  const matchdays = tournament.matchdays.filter((matchday) => !isPlayoffMatchday(matchday));
  if (matchdays.length === tournament.matchdays.length && tournament.format !== "staged") {
    return tournament;
  }
  return {
    ...tournament,
    format: "round-robin",
    legs: Math.max(1, ...matchdays.map(({ leg }) => leg)),
    matchdays: matchdays.map(({ phaseName: _phaseName, ...matchday }) => matchday),
  };
}

/** Liga de Ascenso 2026 with the Liguilla (2.º–8.º) configured; the only season with this bracket. */
export function isChileanAscenso(tournament: Tournament): boolean {
  return tournament.id === ASCENSO_TOURNAMENT_ID
    && tournament.placementRules?.playoffPlaces?.from === 2
    && tournament.placementRules.playoffPlaces.to === 8
    && hasValidTeams(tournament.teams);
}

/** Regular-phase matchdays of the Liga de Ascenso (without the Liguilla). */
export function chileanAscensoRegularMatchdays(tournament: Tournament): readonly Matchday[] {
  return tournament.matchdays.filter(isRegularMatchday);
}

interface AscensoBracket {
  readonly regularMatchdays: readonly Matchday[];
  readonly quarterfinals: readonly Tie[];
  readonly semifinals: readonly (Tie | undefined)[];
  readonly final: readonly Tie[];
  readonly finalWinner?: string;
}

function computeBracket(tournament: Tournament): AscensoBracket | undefined {
  const regularMatchdays = tournament.matchdays.filter(isRegularMatchday);
  if (!hasCompleteRoundRobin(tournament, regularMatchdays)) return undefined;
  const standings = calculateStandings({ ...tournament, matchdays: regularMatchdays });
  if (standings.length < 8) return undefined;
  const seeds = standings.slice(0, 8).map(({ teamId }) => teamId);
  const quarterfinals: Tie[] = [
    { homeTeamId: seeds[2], awayTeamId: seeds[7] },
    { homeTeamId: seeds[3], awayTeamId: seeds[6] },
    { homeTeamId: seeds[4], awayTeamId: seeds[5] },
  ];
  const quarterfinalWinners = quarterfinals.map((tie, index) =>
    getTieWinner(tournament, tournament.matchdays, index + 1, "Cuartos de final", tie),
  );
  const semifinals: (Tie | undefined)[] = [
    quarterfinalWinners[0]
      ? { homeTeamId: seeds[1], awayTeamId: quarterfinalWinners[0] }
      : undefined,
    quarterfinalWinners[1] && quarterfinalWinners[2]
      ? { homeTeamId: quarterfinalWinners[1], awayTeamId: quarterfinalWinners[2] }
      : undefined,
  ];
  const semifinalWinners = semifinals.map((tie, index) =>
    tie ? getTieWinner(tournament, tournament.matchdays, index + 1, "Semifinal", tie) : undefined,
  );
  const final: Tie[] = semifinalWinners[0] && semifinalWinners[1]
    ? [{ homeTeamId: semifinalWinners[0], awayTeamId: semifinalWinners[1] }]
    : [];
  const finalWinner = final[0] ? getTieWinner(tournament, tournament.matchdays, 1, "Final", final[0]) : undefined;
  return { regularMatchdays, quarterfinals, semifinals, final, ...(finalWinner ? { finalWinner } : {}) };
}

/** Winner of the Liguilla final (aggregate, then return-leg penalties); undefined while undecided. */
export function getChileanAscensoPlayoffWinner(tournament: Tournament): string | undefined {
  return isChileanAscenso(tournament) ? computeBracket(tournament)?.finalWinner : undefined;
}

export function advanceChileanAscensoPlayoff(tournament: Tournament): Tournament {
  if (!isChileanAscenso(tournament)) return tournament;
  const bracket = computeBracket(tournament);
  if (!bracket) return removeStalePlayoff(tournament);
  const { regularMatchdays, quarterfinals, semifinals, final } = bracket;

  const regular = regularMatchdays.map((matchday) => ({
    ...matchday,
    leg: 1,
    phaseName: REGULAR_PHASE,
  }));
  const playoffMatchdays = stages.map((spec) => reconcileStageMatchday(
    tournament,
    regularMatchdays,
    spec,
    spec.name === "Cuartos de final"
      ? quarterfinals
      : spec.name === "Semifinal"
        ? semifinals
        : final,
  ));
  const matchdays = [...regular, ...playoffMatchdays];
  if (
    JSON.stringify(matchdays) === JSON.stringify(tournament.matchdays)
    && tournament.format === "staged"
    && tournament.legs === stages[stages.length - 1].leg
  ) {
    return tournament;
  }
  return {
    ...tournament,
    format: "staged",
    legs: stages[stages.length - 1].leg,
    matchdays,
    rulesNote: tournament.rulesNote?.includes(FORMAT_NOTE)
      ? tournament.rulesNote
      : [tournament.rulesNote, FORMAT_NOTE].filter(Boolean).join(" "),
  };
}
