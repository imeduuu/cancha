import { beforeEach, describe, expect, it } from "vitest";
import type { OfficialLeagueSeason } from "@cancha/core/application/ports/official-league-source";
import type { TournamentPlacementRules } from "@cancha/core/domain/entities/tournament";
import { importOfficialTournament } from "@cancha/core/application/use-cases/import-official-tournament";
import { simulateChampionship } from "@cancha/core/application/use-cases/simulate-championship";
import { evaluateSeasonClosure } from "@cancha/core/application/services/season-closure";
import { projectSeasonPlanning } from "@cancha/core/application/services/season-planning";
import { confirmSeasonClosure, reviewSeasonClosure } from "@cancha/core/application/use-cases/confirm-season-closure";
import { confirmSeasonPlanning, reviewSeasonPlanning } from "@cancha/core/application/use-cases/plan-season";
import { generateRoundRobinSchedule } from "@cancha/core/domain/services/round-robin-scheduler";
import { chileanPrimera2026PlacementRules } from "@cancha/core/domain/services/chilean-primera-placement-rules";
import { getChileanAscensoOutcome } from "@cancha/core/domain/services/chilean-division-outcome";
import { getDivisionTransition } from "@cancha/core/domain/services/division-season-transition";
import { LocalStorageTournamentRepository } from "../../infrastructure/persistence/local-storage-tournament-repository";

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
});

/** A season as the ANFP importer delivers it: 16 clubs, 30 rounds, no results, undeclared coverage. */
function anfpSeason(id: string, name: string, prefix: string, placementRules: TournamentPlacementRules): OfficialLeagueSeason {
  const teams = Array.from({length: 16}, (_, i) => ({id: `${prefix}-${i}`, name: `${name} Club ${String.fromCharCode(65 + i)}`}));
  const names = new Map(teams.map(team => [team.id, team.name]));
  return {id, name, season: 2026, sourceUrl: "https://www.campeonatochileno.cl/", placementRules,
    matchdays: generateRoundRobinSchedule(teams, 2).map((day, index) => ({number: index + 1,
      matches: day.fixtures.map(f => ({id: `${prefix}-${f.id}`, homeTeamName: names.get(f.homeTeamId)!, awayTeamName: names.get(f.awayTeamId)!}))}))};
}
function seeded(seed: number) {
  let state = seed;
  return () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
}

describe("Chile 2026 → 2027 from simulated seasons (fase 10D)", () => {
  it("closes Primera and Ascenso, then creates both 2027 divisions with the computed movements", async () => {
    const repository = new LocalStorageTournamentRepository(false);
    const now = () => new Date("2026-03-01T00:00:00.000Z");
    await importOfficialTournament({fetchSeason: async () => anfpSeason("anfp-liga-primera-2026", "Liga de Primera", "pri",
      chileanPrimera2026PlacementRules)}, repository, now);
    await importOfficialTournament({fetchSeason: async () => anfpSeason("anfp-liga-de-ascenso-2026", "Liga de Ascenso", "asc",
      {championPlaces: 1, playoffPlaces: {from: 2, to: 8}, relegationPlaces: 1})}, repository, now);
    const find = (id: string) => repository.findAll().find(t => t.id === id)!;
    simulateChampionship(find("anfp-liga-primera-2026"), "pendingOnly", repository, seeded(11));
    simulateChampionship(find("anfp-liga-de-ascenso-2026"), "pendingOnly", repository, seeded(23));
    const primera = find("anfp-liga-primera-2026"), ascenso = find("anfp-liga-de-ascenso-2026");

    const outcome = getChileanAscensoOutcome(ascenso);
    expect(outcome.pending).toEqual([]);
    expect(ascenso.matchdays.some(day => day.phaseName?.startsWith("Liguilla de Ascenso · Final"))).toBe(true);
    const transition = getDivisionTransition(primera, ascenso, repository.findAll());
    expect(transition.pending).toEqual([]);
    expect(transition.upperRelegated).toHaveLength(2);expect(transition.promoted).toHaveLength(2);
    expect(transition.lowerRelegated).toHaveLength(1);

    for (const t of [primera, ascenso]) {
      const view = evaluateSeasonClosure(t, repository.findAll(), repository.findActivity(), null);
      expect(view.closureTier).toBe("simulated");expect(view.blockers).toEqual([]);
      confirmSeasonClosure(reviewSeasonClosure(t.id, null, repository), null, repository, true);
    }

    const input = {mode: "divisions" as const, sourceId: primera.id, partnerId: ascenso.id, targetSeason: 2027,
      incoming: [{id: "incoming-0", name: "Club ascendido de Segunda"}], universeId: null};
    const plan = projectSeasonPlanning(input, repository.findAll(), repository.findActivity());
    expect(plan.blockers).toEqual([]);
    const [upper, lower] = confirmSeasonPlanning(reviewSeasonPlanning(input, repository), repository, true);

    const names = (ids: readonly string[], from: typeof primera) => ids.map(id => from.teams.find(team => team.id === id)!.name);
    const upperNames = upper.teams.map(team => team.name), lowerNames = lower.teams.map(team => team.name);
    expect(upper.teams).toHaveLength(16);expect(lower.teams).toHaveLength(16);
    expect(upperNames).toEqual(expect.arrayContaining(names(transition.promoted, ascenso)));
    expect(upperNames.some(name => names(transition.upperRelegated, primera).includes(name))).toBe(false);
    expect(lowerNames).toEqual(expect.arrayContaining([...names(transition.upperRelegated, primera), "Club ascendido de Segunda"]));
    expect(lowerNames.some(name => names(transition.lowerRelegated, ascenso).includes(name))).toBe(false);
    expect(repository.findAll().filter(t => t.season === 2027)).toHaveLength(2);
    expect(repository.findActivity().at(-1)?.action).toBe("season-created");
  });
});
