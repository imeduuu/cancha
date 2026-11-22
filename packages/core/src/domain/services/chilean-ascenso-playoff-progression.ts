import type { Fixture, KnockoutResolution, Matchday, Tournament } from "../entities/tournament";
import type { Team } from "../entities/team";
import { calculateStandings } from "./standings";
import { reconcileFixtureParticipants } from "./knockout-fixture-reconciliation";
import { isValidFixtureResult } from "./match-result-validation";
import { normalizeTeamName } from "./team-name";

const ASCENSO_COMPETITION_ID = "anfp-liga-de-ascenso";
/** Competition identity without depending on the season year (2026 id or a planned season's UUID). */
const competitionOf = (tournament: Tournament) =>
  tournament.competitionId ?? /^(.*?)-(?:19|20)\d{2}$/.exec(tournament.id)?.[1] ?? tournament.id;
const PLAYOFF_PREFIX = "Liguilla de Ascenso";
const REGULAR_PHASE = "Fase regular";
const TITLE_PHASE = "Definición del título";
const FORMAT_NOTE =
  "Liga de Ascenso 2026: partido único de definición del título si hay empate en el primer lugar; Liguilla oficial a ida y vuelta.";

interface Tie {
  readonly homeTeamId: string;
  readonly awayTeamId: string;
}

interface StageSpec {
  readonly name: string;
  readonly leg: number;
  readonly returnLeg: boolean;
  readonly resolution: KnockoutResolution | false;
}

const stages: readonly StageSpec[] = [
  { name: "Cuartos de final", leg: 2, returnLeg: false, resolution: false },
  { name: "Cuartos de final", leg: 3, returnLeg: true, resolution: "aggregate-then-penalties" },
  { name: "Semifinal", leg: 4, returnLeg: false, resolution: false },
  { name: "Semifinal", leg: 5, returnLeg: true, resolution: "aggregate-then-penalties" },
  { name: "Final", leg: 6, returnLeg: false, resolution: false },
  { name: "Final", leg: 7, returnLeg: true, resolution: "extra-time-then-penalties" },
];

function isPlayoffMatchday(matchday: Matchday): boolean {
  const phaseName = normalizeTeamName(matchday.phaseName ?? "");
  return phaseName.startsWith(normalizeTeamName(PLAYOFF_PREFIX))
    || phaseName.startsWith("liguilla ascenso")
    || phaseName === normalizeTeamName(TITLE_PHASE);
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
  phaseName: string,
  expectedTie: Tie,
): string | undefined {
  // Fixture ids are prefixed by the tournament id: for 2026 that is exactly "anfp-liga-de-ascenso-2026", so they do not change.
  const stageKey = normalizeTeamName(phaseName);
  const stageMatches = (day: Matchday) => {
    const name = normalizeTeamName(day.phaseName ?? "");
    return (name.includes(stageKey) && !(stageKey === "final"
      && (name.includes("semifinal") || name.includes("cuartos de final"))))
      || (stageKey === "cuartos de final" && name.startsWith("liguilla ascenso"));
  };
  const firstMatchday = matchdays.find(day => stageMatches(day)
    && normalizeTeamName(day.phaseName ?? "").endsWith("ida"));
  const returnMatchday = matchdays.find(day => stageMatches(day)
    && normalizeTeamName(day.phaseName ?? "").endsWith("vuelta"));
  const firstLeg = firstMatchday?.fixtures.find(fixture =>
    fixture.homeTeamId === expectedTie.homeTeamId && fixture.awayTeamId === expectedTie.awayTeamId);
  const returnLeg = returnMatchday?.fixtures.find(fixture =>
    fixture.homeTeamId === expectedTie.awayTeamId && fixture.awayTeamId === expectedTie.homeTeamId);
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
  let homeAggregate = firstResult.homeGoals
    + (returnLeg.homeTeamId === firstLeg.homeTeamId ? returnResult.homeGoals : returnResult.awayGoals);
  let awayAggregate = firstResult.awayGoals
    + (returnLeg.homeTeamId === firstLeg.awayTeamId ? returnResult.homeGoals : returnResult.awayGoals);
  if (phaseName === "Final" && returnResult.extraTime) {
    homeAggregate += returnLeg.homeTeamId === firstLeg.homeTeamId
      ? returnResult.extraTime.homeGoals : returnResult.extraTime.awayGoals;
    awayAggregate += returnLeg.homeTeamId === firstLeg.awayTeamId
      ? returnResult.extraTime.homeGoals : returnResult.extraTime.awayGoals;
  }
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
  prefix: string,
  phaseName: string,
  tieNumber: number,
  tie: Tie,
  returnLeg: boolean,
  resolution: KnockoutResolution | false,
): Fixture {
  return {
    id: `${prefix}-${phaseName}-${tieNumber}-${returnLeg ? "vuelta" : "ida"}`,
    homeTeamId: returnLeg ? tie.awayTeamId : tie.homeTeamId,
    awayTeamId: returnLeg ? tie.homeTeamId : tie.awayTeamId,
    ...(resolution ? { knockoutResolution: resolution } : {}),
  };
}

function reconcileStageMatchday(
  current: Tournament,
  regularMatchdays: readonly Matchday[],
  spec: StageSpec,
  ties: readonly (Tie | undefined)[],
): Matchday {
  const phaseName = `${PLAYOFF_PREFIX} · ${spec.name}${spec.returnLeg ? " · Vuelta" : " · Ida"}`;
  const previousFixtures = current.matchdays.find(({ phaseName: name }) => name === phaseName)?.fixtures
    ?? (spec.name === "Cuartos de final"
      ? current.matchdays.find(day => normalizeTeamName(day.phaseName ?? "").startsWith("liguilla ascenso")
        && normalizeTeamName(day.phaseName ?? "").endsWith(spec.returnLeg ? "vuelta" : "ida"))?.fixtures
      : undefined)
    ?? [];
  const fixtures: Fixture[] = [];
  const usedTeams = new Set<string>();

  ties.forEach((tie, index) => {
    if (!tie || tie.homeTeamId === tie.awayTeamId) return;
    if (usedTeams.has(tie.homeTeamId) || usedTeams.has(tie.awayTeamId)) return;
    usedTeams.add(tie.homeTeamId);
    usedTeams.add(tie.awayTeamId);

    const candidate = makeFixture(current.id, spec.name, index + 1, tie, spec.returnLeg, spec.resolution);
    const previous = previousFixtures.find(({ id }) => id === candidate.id)
      ?? previousFixtures.find(fixture => fixture.homeTeamId === candidate.homeTeamId
        && fixture.awayTeamId === candidate.awayTeamId);
    const reconciled = previous
      ? reconcileFixtureParticipants(previous, candidate.homeTeamId, candidate.awayTeamId)
      : candidate;
    if (!reconciled) return;
    fixtures.push({
      ...reconciled,
      ...(spec.resolution ? { knockoutResolution: spec.resolution } : {}),
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

/** Liga de Ascenso (any season) with the Liguilla (2.º–8.º) configured in its placement rules. */
export function isChileanAscenso(tournament: Tournament): boolean {
  return competitionOf(tournament) === ASCENSO_COMPETITION_ID
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
  const tiedForFirst = standings.length > 1 && standings[0].points === standings[1].points;
  const definition = tournament.matchdays
    .filter(day => normalizeTeamName(day.phaseName ?? "") === normalizeTeamName(TITLE_PHASE))
    .flatMap(day => day.fixtures)[0];
  const titleWinner = tiedForFirst && definition?.result && definition.homeTeamId === seeds[0]
    && definition.awayTeamId === seeds[1]
    && isValidFixtureResult(tournament, tournament.matchdays.find(day => day.fixtures.includes(definition))!, definition)
    ? definition.result.homeGoals === definition.result.awayGoals
      ? definition.result.penalties && definition.result.penalties.homeGoals !== definition.result.penalties.awayGoals
        ? definition.result.penalties.homeGoals > definition.result.penalties.awayGoals ? definition.homeTeamId : definition.awayTeamId
        : undefined
      : definition.result.homeGoals > definition.result.awayGoals ? definition.homeTeamId : definition.awayTeamId
    : undefined;
  const quarterfinals: Tie[] = [
    { homeTeamId: seeds[7], awayTeamId: seeds[2] },
    { homeTeamId: seeds[6], awayTeamId: seeds[3] },
    { homeTeamId: seeds[5], awayTeamId: seeds[4] },
  ];
  const quarterfinalWinners = quarterfinals.map((tie) =>
    getTieWinner(tournament, tournament.matchdays, "Cuartos de final", tie),
  );
  const titleLoser = tiedForFirst && titleWinner ? (titleWinner === seeds[0] ? seeds[1] : seeds[0]) : undefined;
  const topSeed = tiedForFirst ? titleLoser : seeds[1];
  const availableWinners = quarterfinalWinners.filter((id): id is string => !!id);
  const lowestWinner = availableWinners.length === 3
    ? [...availableWinners].sort((a, b) => seeds.indexOf(b) - seeds.indexOf(a))[0]
    : undefined;
  const otherWinners = lowestWinner
    ? availableWinners.filter(id => id !== lowestWinner)
    : [];
  const semifinalPairs: (readonly [string, string] | undefined)[] = [
    topSeed && lowestWinner ? [topSeed, lowestWinner] : undefined,
    otherWinners.length === 2 ? [otherWinners[0], otherWinners[1]] : undefined,
  ];
  const semifinals: (Tie | undefined)[] = semifinalPairs.map(pair => !pair ? undefined
    : seeds.indexOf(pair[0]) > seeds.indexOf(pair[1])
      ? { homeTeamId: pair[0], awayTeamId: pair[1] }
      : { homeTeamId: pair[1], awayTeamId: pair[0] });
  while (semifinals.length < 2) semifinals.push(undefined);
  const semifinalWinners = semifinals.map((tie) =>
    tie ? getTieWinner(tournament, tournament.matchdays, "Semifinal", tie) : undefined,
  );
  const final: Tie[] = semifinalWinners[0] && semifinalWinners[1]
    ? [seeds.indexOf(semifinalWinners[0]) > seeds.indexOf(semifinalWinners[1])
      ? { homeTeamId: semifinalWinners[0], awayTeamId: semifinalWinners[1] }
      : { homeTeamId: semifinalWinners[1], awayTeamId: semifinalWinners[0] }]
    : [];
  const finalWinner = final[0] ? getTieWinner(tournament, tournament.matchdays, "Final", final[0]) : undefined;
  return { regularMatchdays, quarterfinals, semifinals, final, ...(finalWinner ? { finalWinner } : {}) };
}

/** Winner of the Liguilla final (aggregate, then return-leg penalties); undefined while undecided. */
export function getChileanAscensoPlayoffWinner(tournament: Tournament): string | undefined {
  return isChileanAscenso(tournament) ? computeBracket(tournament)?.finalWinner : undefined;
}

export function getChileanAscensoTitleWinner(tournament: Tournament): string | undefined {
  if (!isChileanAscenso(tournament)) return undefined;
  const regular = chileanAscensoRegularMatchdays(tournament);
  if (!hasCompleteRoundRobin(tournament, regular)) return undefined;
  const standings = calculateStandings({ ...tournament, matchdays: regular });
  if (standings.length < 2 || standings[0].points !== standings[1].points) return standings[0]?.teamId;
  const definitionDay = tournament.matchdays.find(day =>
    normalizeTeamName(day.phaseName ?? "") === normalizeTeamName(TITLE_PHASE));
  const fixture = definitionDay?.fixtures[0];
  if (!fixture || fixture.homeTeamId !== standings[0].teamId || fixture.awayTeamId !== standings[1].teamId
    || !isValidFixtureResult(tournament, definitionDay, fixture)) return undefined;
  if (fixture.result!.homeGoals !== fixture.result!.awayGoals) {
    return fixture.result!.homeGoals > fixture.result!.awayGoals ? fixture.homeTeamId : fixture.awayTeamId;
  }
  const penalties = fixture.result!.penalties;
  if (!penalties || penalties.homeGoals === penalties.awayGoals) return undefined;
  return penalties.homeGoals > penalties.awayGoals ? fixture.homeTeamId : fixture.awayTeamId;
}

export function advanceChileanAscensoPlayoff(tournament: Tournament): Tournament {
  if (!isChileanAscenso(tournament)) return tournament;
  // Keep published fixture ids and schedules while resolving their winners by participants.
  const bracket = computeBracket(tournament);
  if (!bracket) return removeStalePlayoff(tournament);
  const { regularMatchdays, quarterfinals, semifinals, final } = bracket;

  const regular = regularMatchdays.map((matchday) => ({
    ...matchday,
    leg: 1,
    phaseName: REGULAR_PHASE,
  }));
  const standings = calculateStandings({ ...tournament, matchdays: regularMatchdays });
  const needsTitleDefinition = standings.length > 1 && standings[0].points === standings[1].points;
  const hasPublishedTitleDefinition = tournament.matchdays.some(day =>
    normalizeTeamName(day.phaseName ?? "") === normalizeTeamName(TITLE_PHASE));
  const generatedDefinition: Matchday | undefined = needsTitleDefinition && !hasPublishedTitleDefinition
    ? { number: regularMatchdays.length + 1, leg: 1, phaseName: TITLE_PHASE, fixtures: [{
      id: `${tournament.id}-definicion-titulo-1`,
      homeTeamId: standings[0].teamId,
      awayTeamId: standings[1].teamId,
      knockoutResolution: "penalties",
    }] }
    : undefined;
  const definition = generatedDefinition ?? (needsTitleDefinition
    ? tournament.matchdays.find(day => normalizeTeamName(day.phaseName ?? "") === normalizeTeamName(TITLE_PHASE))
    : undefined);
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
  const matchdays = [...regular, ...(definition ? [definition] : []), ...playoffMatchdays];
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
