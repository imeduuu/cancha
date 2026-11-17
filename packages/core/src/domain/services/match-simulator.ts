import type { Fixture, MatchResult } from "../entities/tournament";

const maximumGoals = 99;
const homeExpectedGoals = 1.55;
const awayExpectedGoals = 1.15;
const extraTimeHomeExpectedGoals = 0.4;
const extraTimeAwayExpectedGoals = 0.3;

function samplePoisson(lambda: number, random: () => number): number {
  const threshold = Math.exp(-lambda);
  let product = 1;
  let goals = 0;

  do {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new Error("La fuente aleatoria debe entregar valores entre 0 y 1.");
    }
    product *= value;
    goals += 1;
  } while (product > threshold && goals <= maximumGoals);

  return Math.min(goals - 1, maximumGoals);
}

export function simulateMatchResult(
  _fixture: Fixture,
  random: () => number = Math.random,
): MatchResult {
  return {
    homeGoals: samplePoisson(homeExpectedGoals, random),
    awayGoals: samplePoisson(awayExpectedGoals, random),
  };
}

export function simulateExtraTimeResult(
  random: () => number = Math.random,
): MatchResult {
  return {
    homeGoals: samplePoisson(extraTimeHomeExpectedGoals, random),
    awayGoals: samplePoisson(extraTimeAwayExpectedGoals, random),
  };
}
