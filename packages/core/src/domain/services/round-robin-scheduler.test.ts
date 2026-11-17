import { describe, expect, it } from "vitest";
import { generateRoundRobinSchedule } from "./round-robin-scheduler";
import type { Team } from "../entities/team";

function createTeams(count: number): Team[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `team-${index + 1}`,
    name: `Equipo ${index + 1}`,
  }));
}

describe("generateRoundRobinSchedule", () => {
  it("schedules every pair once per leg for an even number of teams", () => {
    const matchdays = generateRoundRobinSchedule(createTeams(4), 1);
    const fixtures = matchdays.flatMap((matchday) => matchday.fixtures);

    expect(matchdays).toHaveLength(3);
    expect(fixtures).toHaveLength(6);
    expect(new Set(fixtures.map((fixture) =>
      [fixture.homeTeamId, fixture.awayTeamId].sort().join(":"),
    )).size).toBe(6);
  });

  it("schedules odd teams with one bye per matchday and reverses home teams on the second leg", () => {
    const matchdays = generateRoundRobinSchedule(createTeams(3), 2);
    const firstLeg = matchdays.filter((matchday) => matchday.leg === 1);
    const secondLeg = matchdays.filter((matchday) => matchday.leg === 2);

    expect(matchdays).toHaveLength(6);
    expect(firstLeg.every((matchday) => matchday.fixtures.length === 1)).toBe(true);
    expect(secondLeg.map((matchday) => matchday.number)).toEqual([4, 5, 6]);

    for (const firstMatchday of firstLeg) {
      const firstFixture = firstMatchday.fixtures[0];
      const reversedMatch = secondLeg
        .flatMap((matchday) => matchday.fixtures)
        .find((fixture) =>
          fixture.homeTeamId === firstFixture.awayTeamId
          && fixture.awayTeamId === firstFixture.homeTeamId,
        );
      expect(reversedMatch).toBeDefined();
    }
  });

  it("continues matchday numbering across legs for 20-team competitions", () => {
    const matchdays = generateRoundRobinSchedule(createTeams(20), 2);
    const secondLeg = matchdays.filter((matchday) => matchday.leg === 2);

    expect(secondLeg[0]).toMatchObject({ number: 20, leg: 2 });
    expect(secondLeg[secondLeg.length - 1]).toMatchObject({ number: 38, leg: 2 });
  });

  it("rejects invalid tournament sizes and leg counts", () => {
    expect(() => generateRoundRobinSchedule(createTeams(1), 1)).toThrow();
    expect(() => generateRoundRobinSchedule(createTeams(2), 0)).toThrow();
  });
});
