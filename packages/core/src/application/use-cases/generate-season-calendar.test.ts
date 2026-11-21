import { describe, expect, it } from "vitest";
import type { Tournament } from "../../domain/entities/tournament";
import { hasCompleteRoundRobinSchedule } from "../../domain/services/tournament-history";
import { closureMemory } from "../../test-utils/season-closure-fixtures";
import { canGenerateSeasonCalendar, generateSeasonCalendar, regularRounds } from "./generate-season-calendar";

const teams = Array.from({length: 16}, (_, i) => ({id: `t${i}`, name: `Club ${i}`}));
const planned = (competitionId = "anfp-liga-primera"): Tournament => ({id: "planned-2027", competitionId, name: "Liga 2027", season: 2027,
  createdAt: "2027-01-01T00:00:00.000Z", teams, legs: 1, tieBreakers: ["goalDifference"], matchdays: [], format: "staged",
  seasonPreparation: {schemaVersion: 1, sourceTournamentIds: [], plannedParticipants: teams.map(t => t.name), calendarReviews: []}});

describe("generateSeasonCalendar", () => {
  it("adds a local double round-robin to a planned Chilean season and records it", () => {
    const memory = closureMemory([planned()]);
    let n = 0;
    const next = generateSeasonCalendar("planned-2027", memory.repository, () => `fixture-${n++}`);
    expect(next.matchdays).toHaveLength(30);expect(next.matchdays.flatMap(d => d.fixtures)).toHaveLength(240);
    expect(new Set(next.matchdays.flatMap(d => d.fixtures.map(f => f.id))).size).toBe(240);
    expect(next.format).toBe("round-robin");expect(next.legs).toBe(2);expect(hasCompleteRoundRobinSchedule(next)).toBe(true);
    expect(next.calendarProvenance).toBe("local-generated");
    expect(memory.state.activity.at(-1)?.action).toBe("calendar-programmed");
    expect(memory.state.tournaments[0]).toEqual(next);
  });

  it("never replaces an existing calendar and only applies to planned Chilean seasons", () => {
    const memory = closureMemory([planned()]);
    const withFixtures = generateSeasonCalendar("planned-2027", memory.repository);
    expect(canGenerateSeasonCalendar(withFixtures)).toBe(false);
    expect(() => generateSeasonCalendar("planned-2027", memory.repository)).toThrow();
    expect(canGenerateSeasonCalendar(planned("brasileirao-serie-a"))).toBe(false);
    expect(canGenerateSeasonCalendar({...planned(), seasonPreparation: undefined})).toBe(false);
  });

  it("takes the rounds of the source's regular phase, not its playoff legs", () => {
    const source: Tournament = {...planned("anfp-liga-de-ascenso"), id: "anfp-liga-de-ascenso-2026", season: 2026, legs: 7, format: "staged",
      matchdays: [{number: 1, leg: 1, phaseName: "Fase regular", fixtures: Array.from({length: 360}, (_, i) => ({id: `f${i}`, homeTeamId: "t0", awayTeamId: "t1"}))},
        {number: 31, leg: 2, phaseName: "Liguilla de Ascenso · Cuartos de final · Ida", fixtures: []}],
      placementRules: {championPlaces: 1, playoffPlaces: {from: 2, to: 8}}};
    expect(regularRounds(source)).toBe(3);
    expect(regularRounds(undefined)).toBe(2);
  });
});
