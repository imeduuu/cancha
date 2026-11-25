import { DomainError } from "../domain-error.js";
import type { Fixture, Matchday, Tournament } from "../entities/tournament";
import { calculateStandings } from "./standings";
import { isValidFixtureResult } from "./match-result-validation";
import { validateFixturePairings } from "./fixture-pairing-validation";
import {
  reconcileFixtureParticipants,
  reconcileFixturesWithAdvancers,
} from "./knockout-fixture-reconciliation";

const stageNames = [
  "Octavos de final",
  "Cuartos de final",
  "Semifinales",
  "Final",
] as const;

type TeamPair = readonly [string, string];

function createRoundOf16Pairs(
  zoneA: readonly string[],
  zoneB: readonly string[],
): TeamPair[] {
  return [
    [zoneA[0], zoneB[7]],
    [zoneB[3], zoneA[4]],
    [zoneA[1], zoneB[6]],
    [zoneB[2], zoneA[5]],
    [zoneB[0], zoneA[7]],
    [zoneA[3], zoneB[4]],
    [zoneB[1], zoneA[6]],
    [zoneA[2], zoneB[5]],
  ];
}

function getKnockoutScore(fixture: Fixture): readonly [number, number] | undefined {
  const result = fixture.result;
  if (!result) return undefined;
  return [
    result.homeGoals + (result.extraTime?.homeGoals ?? 0),
    result.awayGoals + (result.extraTime?.awayGoals ?? 0),
  ];
}

function findFixtureForPair(
  fixtures: readonly Fixture[],
  [firstTeamId, secondTeamId]: TeamPair,
): Fixture | undefined {
  return fixtures.find((fixture) =>
    (fixture.homeTeamId === firstTeamId && fixture.awayTeamId === secondTeamId)
    || (fixture.homeTeamId === secondTeamId && fixture.awayTeamId === firstTeamId),
  );
}

function getWinner(fixture: Fixture): string {
  if (!fixture.result) {
    throw new DomainError(`El partido ${fixture.id} aún no tiene resultado.`);
  }
  const winner = getCompletedFixtureWinner(fixture);
  if (!winner) {
    throw new DomainError(`El partido ${fixture.id} está empatado y no tiene una definición válida.`);
  }
  return winner;
}

function getCompletedFixtureWinner(fixture: Fixture): string | undefined {
  const score = getKnockoutScore(fixture);
  if (!score) return undefined;
  if (score[0] > score[1]) return fixture.homeTeamId;
  if (score[1] > score[0]) return fixture.awayTeamId;
  const penalties = fixture.result?.penalties;
  if (!penalties || penalties.homeGoals === penalties.awayGoals) return undefined;
  return penalties.homeGoals > penalties.awayGoals
    ? fixture.homeTeamId
    : fixture.awayTeamId;
}

function getAdvancers(
  tournament: Tournament,
  matchdays: readonly Matchday[],
  unresolvedTeamIds: ReadonlySet<string>,
): Map<string, string | undefined> {
  const advancingTeams = new Map<string, string | undefined>();
  for (const teamId of unresolvedTeamIds) advancingTeams.set(teamId, undefined);

  for (const matchday of matchdays) {
    for (const fixture of matchday.fixtures) {
      const winner = isValidFixtureResult(tournament, matchday, fixture)
        ? getCompletedFixtureWinner(fixture)
        : undefined;
      advancingTeams.set(fixture.homeTeamId, winner);
      advancingTeams.set(fixture.awayTeamId, winner);
    }
  }
  return advancingTeams;
}

function createNextRoundPairs(winners: readonly string[], roundIndex: number): TeamPair[] {
  if (roundIndex === 0) {
    return [[winners[0], winners[1]], [winners[2], winners[3]], [winners[4], winners[5]], [winners[6], winners[7]]];
  }
  if (roundIndex === 1) {
    return [[winners[0], winners[1]], [winners[2], winners[3]]];
  }
  return [[winners[0], winners[1]]];
}

function reconcileFixturesWithPairs(
  fixtures: readonly Fixture[],
  pairs: readonly TeamPair[],
  half: "Apertura" | "Clausura",
  phaseName: string,
): { fixtures: Fixture[]; unresolvedTeamIds: Set<string> } {
  const unresolvedTeamIds = new Set<string>();
  // Published games are chronological, whereas pairs are in bracket order.
  // Reserve existing pairings before reusing any slot for changed participants.
  const matching = pairs.map(([home, away]) => fixtures.find(f => f.homeTeamId === home && f.awayTeamId === away));
  const reserved = new Set(matching.flatMap(f => f ? [f.id] : []));
  const used = new Set<string>();
  const reconciledFixtures = pairs.map(([homeTeamId, awayTeamId], index) => {
    const fallback = fixtures[index] && !reserved.has(fixtures[index].id) && !used.has(fixtures[index].id)
      ? fixtures[index] : fixtures.find(f => !reserved.has(f.id) && !used.has(f.id));
    const existing = matching[index] ?? fallback;
    if (existing) used.add(existing.id);
    if (existing) {
      if (existing.homeTeamId !== homeTeamId) unresolvedTeamIds.add(existing.homeTeamId);
      if (existing.awayTeamId !== awayTeamId) unresolvedTeamIds.add(existing.awayTeamId);
      return reconcileFixtureParticipants(existing, homeTeamId, awayTeamId)
        ?? createFixture(half, phaseName, index, homeTeamId, awayTeamId);
    }
    return createFixture(half, phaseName, index, homeTeamId, awayTeamId);
  });
  return { fixtures: reconciledFixtures, unresolvedTeamIds };
}

function distributeStageFixtures(
  matchdays: readonly Matchday[],
  fixtures: readonly Fixture[],
): Matchday[] {
  const fixturesById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const usedIds = new Set<string>();
  const distributed = matchdays.map((matchday) => ({
    ...matchday,
    fixtures: matchday.fixtures.flatMap((fixture) => {
      const updated = fixturesById.get(fixture.id);
      if (!updated) return [];
      usedIds.add(updated.id);
      return [updated];
    }),
  }));
  const remaining = fixtures.filter((fixture) => !usedIds.has(fixture.id));
  if (remaining.length > 0 && distributed.length > 0) {
    const last = distributed.length - 1;
    distributed[last] = {
      ...distributed[last],
      fixtures: [...distributed[last].fixtures, ...remaining],
    };
  }
  return distributed;
}

function replaceStageMatchdays(
  matchdays: readonly Matchday[],
  phaseName: string,
  replacements: readonly Matchday[],
): Matchday[] {
  const firstIndex = matchdays.findIndex((matchday) => matchday.phaseName === phaseName);
  if (firstIndex < 0) return [...matchdays, ...replacements];
  const result: Matchday[] = [];
  let inserted = false;
  for (let index = 0; index < matchdays.length; index += 1) {
    const matchday = matchdays[index];
    if (matchday.phaseName !== phaseName) {
      result.push(matchday);
    } else if (!inserted) {
      result.push(...replacements);
      inserted = true;
    }
  }
  return result;
}

function createFixture(
  half: "Apertura" | "Clausura",
  phaseName: string,
  index: number,
  homeTeamId: string,
  awayTeamId: string,
): Fixture {
  const stageIndex = stageNames.findIndex((stageName) => phaseName.endsWith(stageName));
  const stageId = ["octavos", "cuartos", "semifinales", "final"][stageIndex];
  return {
    id: `arg-2026-${half.toLowerCase()}-${stageId}-${index + 1}`,
    homeTeamId,
    awayTeamId,
    knockoutResolution: "extra-time-then-penalties",
  };
}

function getCompletedWinners(
  tournament: Tournament,
  matchdays: readonly Matchday[],
  pairs: readonly TeamPair[],
): string[] | undefined {
  const fixtures = matchdays.flatMap((matchday) => matchday.fixtures);
  if (
    fixtures.length !== pairs.length
    || matchdays.some((matchday) => matchday.fixtures.some((fixture) =>
      !isValidFixtureResult(tournament, matchday, fixture),
    ))
  ) {
    return undefined;
  }

  return pairs.map((pair) => {
    const fixture = findFixtureForPair(fixtures, pair);
    if (!fixture) {
      throw new DomainError("Los partidos del cuadro del Clausura no coinciden con sus cruces.");
    }
    return getWinner(fixture);
  });
}

function createMatchday(
  tournament: Tournament,
  half: "Apertura" | "Clausura",
  phaseName: string,
  pairs: readonly TeamPair[],
): Matchday {
  const nextLeg = Math.max(0, ...tournament.matchdays.map((matchday) => matchday.leg)) + 1;
  return {
    number: 1,
    leg: nextLeg,
    phaseName,
    fixtures: reconcileFixturesWithPairs([], pairs, half, phaseName).fixtures,
  };
}

function getRegularPhase(tournament: Tournament, half: "Apertura" | "Clausura"): Matchday[] {
  return tournament.matchdays.filter(
    (matchday) => matchday.phaseName === `Torneo ${half} · Fase regular`,
  );
}

function clearUnresolvedPlayoffFixtures(
  tournament: Tournament,
  half: "Apertura" | "Clausura",
): Tournament {
  const playoffPhaseNames = new Set(stageNames.map((stageName) =>
    `Torneo ${half} · ${stageName}`,
  ));
  const participantIds = new Set(tournament.matchdays
    .filter((matchday) => playoffPhaseNames.has(matchday.phaseName ?? ""))
    .flatMap(({ fixtures }) => fixtures.flatMap(({ homeTeamId, awayTeamId }) => [
      homeTeamId,
      awayTeamId,
    ])));
  if (participantIds.size === 0) return tournament;
  const unresolvedParticipants = new Map<string, string | undefined>(
    [...participantIds].map((teamId) => [teamId, undefined]),
  );
  let changed = false;
  const matchdays = tournament.matchdays.map((matchday) => {
    if (!playoffPhaseNames.has(matchday.phaseName ?? "")) return matchday;
    const reconciled = reconcileFixturesWithAdvancers(matchday.fixtures, unresolvedParticipants);
    if (reconciled.fixtures.length === matchday.fixtures.length) return matchday;
    changed = true;
    return { ...matchday, fixtures: reconciled.fixtures };
  });
  return changed ? { ...tournament, matchdays } : tournament;
}

export function advanceArgentinaPlayoffs(
  tournament: Tournament,
  half: "Apertura" | "Clausura",
): Tournament {
  if (tournament.id !== "arg-liga-profesional-2026") return tournament;

  const regularMatchdays = getRegularPhase(tournament, half);
  const zoneA = tournament.teams.filter((team) => team.groupName === "Zona A");
  const zoneB = tournament.teams.filter((team) => team.groupName === "Zona B");
  if (zoneA.length !== 15 || zoneB.length !== 15) return tournament;

  const expectedRegularFixtures = zoneA.length * (zoneA.length + 1);
  const actualRegularFixtures = regularMatchdays.reduce(
    (count, matchday) => count + matchday.fixtures.length,
    0,
  );
  const pairingIssues = validateFixturePairings(
    regularMatchdays.map((matchday) => ({
      number: matchday.number,
      leg: matchday.leg,
      phaseName: matchday.phaseName,
      fixtures: matchday.fixtures.map((fixture) => ({
        ...fixture,
        homeTeamName: tournament.teams.find(({ id }) => id === fixture.homeTeamId)?.name,
        awayTeamName: tournament.teams.find(({ id }) => id === fixture.awayTeamId)?.name,
      })),
    })),
    {
      format: "staged",
      singleMeetingPhaseNames: regularMatchdays.flatMap(({ phaseName }) =>
        phaseName ? [phaseName] : [],
      ),
    },
  );
  const regularPhaseComplete = regularMatchdays.length === 16
    && actualRegularFixtures === expectedRegularFixtures
    && pairingIssues.length === 0
    && regularMatchdays.every((matchday) => matchday.fixtures.every((fixture) =>
      isValidFixtureResult(tournament, matchday, fixture),
    ));
  if (!regularPhaseComplete) return clearUnresolvedPlayoffFixtures(tournament, half);

  const standingsTournament: Tournament = {
    ...tournament,
    teams: tournament.teams,
    matchdays: regularMatchdays,
  };
  const zoneAStandings = calculateStandings({
    ...standingsTournament,
    teams: zoneA,
  }).slice(0, 8);
  const zoneBStandings = calculateStandings({
    ...standingsTournament,
    teams: zoneB,
  }).slice(0, 8);
  if (zoneAStandings.length !== 8 || zoneBStandings.length !== 8) return tournament;

  let updatedTournament = tournament;
  let unresolvedTeamIds = new Set<string>();
  let previousRoundWinners: string[] | undefined;
  let previousRoundMatchdays: Matchday[] | undefined;
  for (let roundIndex = 0; roundIndex < stageNames.length; roundIndex += 1) {
    const phaseName = `Torneo ${half} · ${stageNames[roundIndex]}`;
    let matchdays = updatedTournament.matchdays.filter(
      (matchday) => matchday.phaseName === phaseName,
    );
    let pairs = roundIndex === 0
      ? createRoundOf16Pairs(
        zoneAStandings.map((standing) => standing.teamId),
        zoneBStandings.map((standing) => standing.teamId),
      )
      : previousRoundWinners
        ? createNextRoundPairs(previousRoundWinners, roundIndex - 1)
        : [];

    if (roundIndex > 0 && matchdays.length > 0 && previousRoundMatchdays) {
      const advancingTeams = getAdvancers(tournament, previousRoundMatchdays, unresolvedTeamIds);
      const reconciledFixtures = reconcileFixturesWithAdvancers(
        matchdays.flatMap((matchday) => matchday.fixtures),
        advancingTeams,
      );
      for (const teamId of reconciledFixtures.unresolvedTeamIds) {
        unresolvedTeamIds.add(teamId);
      }
      matchdays = distributeStageFixtures(matchdays, reconciledFixtures.fixtures);
    }

    // Published later rounds define their own bracket order. Preserve those
    // pairings when they consist exactly of the qualified winners, once each.
    // Reconciliation above still replaces an eliminated participant and clears
    // its old result; local planning retains the existing pairing algorithm.
    if (roundIndex > 0 && previousRoundWinners) {
      const published = matchdays.flatMap(day => day.fixtures);
      const participants = published.flatMap(f => [f.homeTeamId, f.awayTeamId]);
      const qualified = new Set(previousRoundWinners);
      if (published.length === pairs.length && published.every(f => f.id.startsWith("official-"))
        && participants.length === qualified.size && new Set(participants).size === participants.length
        && participants.every(id => qualified.has(id))) {
        pairs = published.map(f => [f.homeTeamId, f.awayTeamId] as TeamPair);
      }
    }

    if (pairs.length > 0) {
      if (matchdays.length === 0) {
        matchdays = [createMatchday(updatedTournament, half, phaseName, pairs)];
      } else {
        const reconciled = reconcileFixturesWithPairs(
          matchdays.flatMap((matchday) => matchday.fixtures),
          pairs,
          half,
          phaseName,
        );
        for (const teamId of reconciled.unresolvedTeamIds) {
          unresolvedTeamIds.add(teamId);
        }
        matchdays = distributeStageFixtures(matchdays, reconciled.fixtures);
      }
      updatedTournament = {
        ...updatedTournament,
        legs: Math.max(updatedTournament.legs, ...matchdays.map(({ leg }) => leg)),
        matchdays: replaceStageMatchdays(updatedTournament.matchdays, phaseName, matchdays),
      };
    } else if (matchdays.length > 0 && roundIndex > 0 && previousRoundMatchdays) {
      updatedTournament = {
        ...updatedTournament,
        matchdays: replaceStageMatchdays(updatedTournament.matchdays, phaseName, matchdays),
      };
    }

    previousRoundWinners = pairs.length > 0
      ? getCompletedWinners(updatedTournament, matchdays, pairs)
      : undefined;
    previousRoundMatchdays = matchdays;
  }

  return updatedTournament;
}

export function advanceArgentinaClausuraPlayoffs(tournament: Tournament): Tournament {
  return advanceArgentinaPlayoffs(tournament, "Clausura");
}

export function advanceArgentinaPlayoffProgress(tournament: Tournament): Tournament {
  return advanceArgentinaPlayoffs(
    advanceArgentinaPlayoffs(tournament, "Apertura"),
    "Clausura",
  );
}
