import { normalizeTeamName } from "./team-name";
import type { Fixture, Matchday, Tournament } from "../entities/tournament";
import { calculateStandings, type TeamStanding } from "./standings";
import { getCompletedStageWinners } from "./official-cup-progression";
import { isValidFixtureResult } from "./match-result-validation";
import { validateContinentalGroupSchedule } from "./continental-group-schedule";

const groupMatchCount = 6;
const libName = "Copa Libertadores";
const sudName = "Copa Sudamericana";
const autoFixtureMarker = "-continental-auto-";

interface GroupEntry extends TeamStanding {
  readonly groupName: string;
}

interface Tie {
  readonly homeTeamId: string;
  readonly awayTeamId: string;
}

function comparePerformance(first: TeamStanding, second: TeamStanding): number {
  return second.points - first.points
    || second.goalDifference - first.goalDifference
    || second.goalsFor - first.goalsFor
    || second.wins - first.wins
    || first.teamName.localeCompare(second.teamName, "es", { sensitivity: "base" })
    || first.teamId.localeCompare(second.teamId);
}

function getCompletedGroups(tournament: Tournament, cupName: string): GroupEntry[] | undefined {
  const groupTeams = tournament.teams.filter((team) => team.groupName);
  const teamsByGroup = new Map<string, typeof groupTeams>();
  for (const team of groupTeams) {
    if (!team.groupName) continue;
    const group = teamsByGroup.get(team.groupName) ?? [];
    group.push(team);
    teamsByGroup.set(team.groupName, group);
  }
  if (
    groupTeams.length !== 32
    || teamsByGroup.size !== 8
    || [...teamsByGroup.values()].some((group) => group.length !== 4)
  ) {
    return undefined;
  }

  const groupMatchdays = tournament.matchdays.filter((matchday) =>
    matchday.phaseName?.toLocaleLowerCase("es")
      .includes(`${cupName} · fase de grupos`.toLocaleLowerCase("es")),
  );
  const fixtures = groupMatchdays.flatMap((matchday) => matchday.fixtures);
  const appearances = new Map(groupTeams.map((team) => [team.id, 0]));
  if (fixtures.length !== 96) return undefined;
  if (validateContinentalGroupSchedule(tournament, groupMatchdays).length > 0) return undefined;
  for (const matchday of groupMatchdays) {
    for (const fixture of matchday.fixtures) {
    const home = tournament.teams.find((team) => team.id === fixture.homeTeamId);
    const away = tournament.teams.find((team) => team.id === fixture.awayTeamId);
    if (
      !isValidFixtureResult(tournament, matchday, fixture)
      || !home?.groupName
      || home.groupName !== away?.groupName
      || !appearances.has(home.id)
      || !away
    ) {
      return undefined;
    }
    appearances.set(home.id, (appearances.get(home.id) ?? 0) + 1);
    appearances.set(away.id, (appearances.get(away.id) ?? 0) + 1);
    }
  }
  if ([...appearances.values()].some((played) => played !== groupMatchCount)) {
    return undefined;
  }

  return [...teamsByGroup].flatMap(([groupName, teams]) =>
    calculateStandings({ ...tournament, teams, matchdays: groupMatchdays })
      .map((standing) => ({ ...standing, groupName })),
  );
}

function getCrossGroupTies(
  winners: readonly GroupEntry[],
  runnersUp: readonly GroupEntry[],
): Tie[] {
  const rankedWinners = [...winners].sort(comparePerformance);
  const availableRunners = [...runnersUp].sort((first, second) =>
    comparePerformance(second, first),
  );
  const assigned: Tie[] = [];

  function assign(index: number, remaining: readonly GroupEntry[]): boolean {
    if (index === rankedWinners.length) return true;
    const winner = rankedWinners[index];
    for (const runner of remaining) {
      if (runner.groupName === winner.groupName) continue;
      assigned.push({ homeTeamId: runner.teamId, awayTeamId: winner.teamId });
      if (assign(index + 1, remaining.filter((candidate) => candidate !== runner))) return true;
      assigned.pop();
    }
    return false;
  }

  return assign(0, availableRunners) ? assigned : [];
}

function getRankedEntries(entries: readonly GroupEntry[], position: number): GroupEntry[] {
  return entries
    .filter((entry) => {
      const group = entries
        .filter((candidate) => candidate.groupName === entry.groupName)
        .sort(comparePerformance);
      return group[position - 1]?.teamId === entry.teamId;
    })
    .sort(comparePerformance);
}

function getAutoPairKey(fixture: Fixture): string {
  return `${fixture.homeTeamId}|${fixture.awayTeamId}`;
}

function phaseName(cupName: string, stageName: string, leg: 1 | 2): string {
  return `${cupName} · ${stageName} · ${leg === 1 ? "Ida" : "Vuelta"}`;
}

function setStagePairs(
  tournament: Tournament,
  cupName: string,
  stageName: string,
  pairs: readonly Tie[],
): Tournament {
  const firstName = phaseName(cupName, stageName, 1);
  const returnName = phaseName(cupName, stageName, 2);
  const autoPrefix = `${tournament.id}${autoFixtureMarker}${stageName.toLocaleLowerCase("es").replace(/[^a-z0-9]+/g, "-")}-`;
  const firstMatchday = tournament.matchdays.find((matchday) => matchday.phaseName === firstName);
  const returnMatchday = tournament.matchdays.find((matchday) => matchday.phaseName === returnName);
  const existingFirst = firstMatchday?.fixtures ?? [];
  const existingReturn = returnMatchday?.fixtures ?? [];
  const officialFirst = existingFirst.filter((fixture) => !fixture.id.startsWith(autoPrefix));
  const officialReturn = existingReturn.filter((fixture) => !fixture.id.startsWith(autoPrefix));
  const officiallyAssigned = new Set(
    [...officialFirst, ...officialReturn].flatMap((fixture) => [
      fixture.homeTeamId,
      fixture.awayTeamId,
    ]),
  );
  const remainingPairs = pairs.filter((pair) =>
    !officiallyAssigned.has(pair.homeTeamId) && !officiallyAssigned.has(pair.awayTeamId),
  );
  const currentAutoPairs = existingFirst
    .filter((fixture) => fixture.id.startsWith(autoPrefix))
    .map(getAutoPairKey);
  const desiredAutoPairs = remainingPairs
    .map((pair) => `${pair.homeTeamId}|${pair.awayTeamId}`);
  if (
    currentAutoPairs.length === desiredAutoPairs.length
    && currentAutoPairs.every((pair, index) => pair === desiredAutoPairs[index])
  ) {
    return tournament;
  }

  const nextFixtures = remainingPairs.flatMap((pair, index) => {
    const id = `${autoPrefix}${index + 1}`;
    const currentFirst = existingFirst.find((fixture) => fixture.id === `${id}-1`);
    const currentReturn = existingReturn.find((fixture) => fixture.id === `${id}-2`);
    const firstTeamsMatch = currentFirst?.homeTeamId === pair.homeTeamId
      && currentFirst.awayTeamId === pair.awayTeamId;
    const returnTeamsMatch = currentReturn?.homeTeamId === pair.awayTeamId
      && currentReturn.awayTeamId === pair.homeTeamId;
    return [
      {
        id: `${id}-1`,
        homeTeamId: pair.homeTeamId,
        awayTeamId: pair.awayTeamId,
        ...(firstTeamsMatch && currentFirst?.result ? { result: currentFirst.result } : {}),
      },
      {
        id: `${id}-2`,
        homeTeamId: pair.awayTeamId,
        awayTeamId: pair.homeTeamId,
        knockoutResolution: "aggregate-then-penalties" as const,
        ...(returnTeamsMatch && currentReturn?.result ? { result: currentReturn.result } : {}),
      },
    ];
  });

  const nextMatchdays: Matchday[] = tournament.matchdays.map((matchday) => {
    if (matchday.phaseName === firstName) {
      return {
        ...matchday,
        fixtures: [
          ...officialFirst,
          ...nextFixtures.filter((fixture) => fixture.id.endsWith("-1")),
        ],
      };
    }
    if (matchday.phaseName === returnName) {
      return {
        ...matchday,
        fixtures: [
          ...officialReturn,
          ...nextFixtures.filter((fixture) => fixture.id.endsWith("-2")),
        ],
      };
    }
    return matchday;
  });
  const stageIndex = tournament.knockoutStages?.findIndex(
    (stage) => stage.name === `${cupName} · ${stageName}`,
  ) ?? -1;
  const laterStageNames = new Set(
    stageIndex < 0
      ? []
      : tournament.knockoutStages?.slice(stageIndex + 1).map(({ name }) => name) ?? [],
  );
  return {
    ...tournament,
    matchdays: nextMatchdays.map((matchday) => {
      const laterStage = [...laterStageNames].some((name) =>
        matchday.phaseName?.toLocaleLowerCase("es").startsWith(name.toLocaleLowerCase("es")),
      );
      return laterStage
        ? {
          ...matchday,
          fixtures: matchday.fixtures.filter((fixture) =>
            !fixture.id.includes(`${tournament.id}-cup-stage-`)
            && !fixture.id.includes(autoFixtureMarker),
          ),
        }
        : matchday;
    }),
  };
}

function getStageWinners(tournament: Tournament, stageName: string): string[] | undefined {
  const stage = tournament.knockoutStages?.find((candidate) =>
    candidate.name === `${tournament.name.replace(/ \d{4}$/, "")} · ${stageName}`,
  );
  return stage ? getCompletedStageWinners(tournament.matchdays, stage) : undefined;
}

function replaceTournament(
  tournaments: readonly Tournament[],
  updated: Tournament,
): Tournament[] {
  return tournaments.map((tournament) => tournament.id === updated.id ? updated : tournament);
}

export function advanceContinentalCupProgression(
  tournaments: readonly Tournament[],
): Tournament[] {
  let libertadores = tournaments.find((tournament) =>
    tournament.id === "conmebol-libertadores-2026",
  );
  let sudamericana = tournaments.find((tournament) =>
    tournament.id === "conmebol-sudamericana-2026",
  );
  if (!libertadores && !sudamericana) return [...tournaments];

  const libGroups = libertadores ? getCompletedGroups(libertadores, libName) : undefined;
  const sudaGroups = sudamericana ? getCompletedGroups(sudamericana, sudName) : undefined;

  if (libertadores) {
    const winners = libGroups ? getRankedEntries(libGroups, 1) : [];
    const runnersUp = libGroups ? getRankedEntries(libGroups, 2) : [];
    libertadores = setStagePairs(
      libertadores,
      libName,
      "Octavos de final",
      getCrossGroupTies(winners, runnersUp),
    );
  }

  if (sudamericana) {
    const libThirds = libGroups ? getRankedEntries(libGroups, 3) : [];
    const sudaRunnersUp = sudaGroups ? getRankedEntries(sudaGroups, 2) : [];
    const incomingIds = new Map<string, string>();
    const teams = [...sudamericana.teams];
    for (const third of libThirds) {
      const source = libertadores?.teams.find(team => team.id === third.teamId);
      if (!source) continue;
      const sameId = teams.find(team => team.id === source.id);
      if (sameId && normalizeTeamName(sameId.name) !== normalizeTeamName(source.name)) {
        throw new Error("Las copas contienen identidades de clubes incompatibles; revisa los participantes antes de generar el playoff.");
      }
      const existing = sameId ?? teams.find(team => normalizeTeamName(team.name) === normalizeTeamName(source.name));
      incomingIds.set(source.id, existing?.id ?? source.id);
      if (!existing) {
        // A Libertadores entrant joins the knockout stage, never Sudamericana's groups.
        teams.push({ ...source, groupName: undefined, competitionNumber: undefined });
      }
    }
    if (teams.length !== sudamericana.teams.length) sudamericana = { ...sudamericana, teams };
    const playoffPairs = libThirds.map((third, index) => ({
      homeTeamId: incomingIds.get(third.teamId) ?? third.teamId,
      awayTeamId: sudaRunnersUp[index]?.teamId,
    })).filter((pair): pair is Tie => Boolean(pair.awayTeamId));
    sudamericana = setStagePairs(
      sudamericana,
      sudName,
      "Playoff de octavos",
      playoffPairs,
    );

    const playoffWinners = playoffPairs.length === 8
      ? getStageWinners(sudamericana, "Playoff de octavos")
      : undefined;
    const octavos = sudaGroups ? getRankedEntries(sudaGroups, 1) : [];
    sudamericana = setStagePairs(
      sudamericana,
      sudName,
      "Octavos de final",
      playoffWinners?.length === 8
        ? octavos.map((winner, index) => ({
          homeTeamId: playoffWinners[index],
          awayTeamId: winner.teamId,
        }))
        : [],
    );
  }

  let updated = [...tournaments];
  if (libertadores) updated = replaceTournament(updated, libertadores);
  if (sudamericana) updated = replaceTournament(updated, sudamericana);
  return updated;
}
