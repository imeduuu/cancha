import { describe, expect, it, vi } from "vitest";
import { simulateMatchResult } from "./match-simulator";
import type { Fixture } from "../entities/tournament";

const fixture: Fixture = {
  id: "fixture-1",
  homeTeamId: "team-1",
  awayTeamId: "team-2",
};

describe("simulateMatchResult", () => {
  it("generates zero goals when random draws are zero", () => {
    expect(simulateMatchResult(fixture, () => 0)).toEqual({
      homeGoals: 0,
      awayGoals: 0,
    });
  });

  it("generates ordinary scores for ordinary random values", () => {
    const draws = [0.5, 0.5, 0.5, 0.5];
    const random = vi.fn(() => draws.shift() ?? 0.5);

    const result = simulateMatchResult(fixture, random);

    expect(result.homeGoals).toBe(2);
    expect(result.awayGoals).toBe(1);
    expect(result.homeGoals).toBeLessThanOrEqual(99);
    expect(result.awayGoals).toBeLessThanOrEqual(99);
  });

  it("rejects invalid random values", () => {
    expect(() => simulateMatchResult(fixture, () => 1)).toThrow(
      "La fuente aleatoria debe entregar valores entre 0 y 1.",
    );
  });

  it("keeps even extremely unlikely scores within the accepted range", () => {
    const result = simulateMatchResult(fixture, () => 0.99);

    expect(result.homeGoals).toBeLessThanOrEqual(99);
    expect(result.awayGoals).toBeLessThanOrEqual(99);
  });

  it("makes ordinary scores common and extreme scorelines exceptionally rare", () => {
    let seed = 123456789;
    const random = () => {
      seed = (1664525 * seed + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const results = Array.from({ length: 10000 }, () => simulateMatchResult(fixture, random));
    const averageHomeGoals = results.reduce((sum, result) => sum + result.homeGoals, 0) / results.length;
    const averageAwayGoals = results.reduce((sum, result) => sum + result.awayGoals, 0) / results.length;
    const ordinaryScoreCount = results.filter((result) =>
      result.homeGoals === 1 && result.awayGoals === 1,
    ).length;
    const extremeScoreCount = results.filter((result) =>
      result.homeGoals >= 8 || result.awayGoals >= 8,
    ).length;

    expect(averageHomeGoals).toBeGreaterThan(1.45);
    expect(averageHomeGoals).toBeLessThan(1.65);
    expect(averageAwayGoals).toBeGreaterThan(1.05);
    expect(averageAwayGoals).toBeLessThan(1.25);
    expect(ordinaryScoreCount).toBeGreaterThan(800);
    expect(extremeScoreCount).toBeLessThan(20);
  });
});
