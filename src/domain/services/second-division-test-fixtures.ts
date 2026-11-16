import type { Matchday, Tournament } from "../entities/tournament";
import { generateRoundRobinSchedule } from "./round-robin-scheduler";
import { applyCompetitionRulesConfiguration } from "./competition-rules";
import { NACIONAL_ID, SERIE_B_ID, REGULAR_PHASE } from "./second-division-rules";

/** Synthetic clubs and scores, exclusively for deterministic tests. */
export function divisionFixture(kind: "argentina" | "brasil"): Tournament {
  const size = kind === "argentina" ? 36 : 20;
  const teams = Array.from({ length: size }, (_, index) => ({
    id: `t${index}`, name: `Test Club ${index}`,
    ...(kind === "argentina" ? { groupName: index < 18 ? "Zona A" : "Zona B",
      afaAffiliation: index % 2 ? "direct" as const : "indirect" as const,
      affiliationSourceUrl: "https://www.afa.com.ar/" } : {}),
  }));
  const score = (home: string, away: string) => Number(home.slice(1)) < Number(away.slice(1))
    ? { homeGoals: 2, awayGoals: 0 } : { homeGoals: 0, awayGoals: 2 };
  let matchdays: Matchday[];
  if (kind === "brasil") matchdays = generateRoundRobinSchedule(teams, 2);
  else {
    const a = generateRoundRobinSchedule(teams.slice(0, 18), 2);
    const b = generateRoundRobinSchedule(teams.slice(18), 2);
    matchdays = a.map((day, index) => ({ ...day, fixtures: [...day.fixtures, ...b[index].fixtures] }));
    for (let leg = 0; leg < 2; leg++) matchdays.push({ number: 35 + leg, leg: 2, fixtures: Array.from({ length: 18 }, (_, index) => ({
      id: `inter-${leg}-${index}`, homeTeamId: `t${index + (leg ? 18 : 0)}`, awayTeamId: `t${index + (leg ? 0 : 18)}`,
    })) });
  }
  return applyCompetitionRulesConfiguration({
    id: kind === "argentina" ? NACIONAL_ID : SERIE_B_ID,
    competitionId: kind === "argentina" ? "arg-primera-nacional" : "brasileirao-serie-b",
    name: kind === "argentina" ? "Primera Nacional 2026" : "Série B 2026", season: 2026,
    createdAt: "2026-01-01T00:00:00.000Z", teams, format: "staged", competitionType: "league", legs: 1,
    tieBreakers: ["goalDifference", "goalsFor"],
    matchdays: matchdays.map(day => ({ ...day, leg: 1, phaseName: REGULAR_PHASE,
      fixtures: day.fixtures.map(fixture => ({ ...fixture, result: score(fixture.homeTeamId, fixture.awayTeamId) })) })),
  });
}
