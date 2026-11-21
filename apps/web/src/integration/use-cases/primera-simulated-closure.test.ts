import { beforeEach, describe, expect, it } from "vitest";
import type { OfficialLeagueSeason } from "@cancha/core/application/ports/official-league-source";
import { importOfficialTournament } from "@cancha/core/application/use-cases/import-official-tournament";
import { simulateChampionship } from "@cancha/core/application/use-cases/simulate-championship";
import { evaluateSeasonClosure } from "@cancha/core/application/services/season-closure";
import { confirmSeasonClosure, reviewSeasonClosure } from "@cancha/core/application/use-cases/confirm-season-closure";
import { generateRoundRobinSchedule } from "@cancha/core/domain/services/round-robin-scheduler";
import { chileanPrimera2026PlacementRules } from "@cancha/core/domain/services/chilean-primera-placement-rules";
import { calculateStandings } from "@cancha/core/domain/services/standings";
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

/** Primera 2026 as the ANFP importer delivers it: 16 clubs, 30 rounds, no results, undeclared coverage. */
function primera2026(): OfficialLeagueSeason {
  const teams = Array.from({length: 16}, (_, i) => ({id: `club-${i}`, name: `Club ${String.fromCharCode(65 + i)}`}));
  const names = new Map(teams.map(team => [team.id, team.name]));
  return {id: "anfp-liga-primera-2026", name: "Liga de Primera Mercado Libre", season: 2026,
    sourceUrl: "https://www.campeonatochileno.cl/ligas/liga-de-primera-mercado-libre/",
    placementRules: chileanPrimera2026PlacementRules,
    matchdays: generateRoundRobinSchedule(teams, 2).map((day, index) => ({number: index + 1,
      matches: day.fixtures.map(f => ({id: f.id, homeTeamName: names.get(f.homeTeamId)!, awayTeamName: names.get(f.awayTeamId)!}))}))};
}

/** Deterministic generator: the same simulated season on every run. */
function seeded(seed: number) {
  let state = seed;
  return () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
}

describe("Primera 2026 simulated end to end (fase 10A)", () => {
  it("declares a simulated champion, table relegations and a confirmable simulated closure", async () => {
    const repository = new LocalStorageTournamentRepository(false);
    await importOfficialTournament({fetchSeason: async () => primera2026()}, repository, () => new Date("2026-03-01T00:00:00.000Z"));
    const imported = repository.findAll().find(t => t.id === "anfp-liga-primera-2026")!;
    expect(imported.competitionRules?.verification.standings).toBe("pending");
    expect(imported.importCoverage).toBe("unknown");

    simulateChampionship(imported, "pendingOnly", repository, seeded(20261));
    const simulated = repository.findAll().find(t => t.id === imported.id)!;
    const table = calculateStandings(simulated);
    const view = evaluateSeasonClosure(simulated, repository.findAll(), repository.findActivity(), null);

    expect(view.overview.played).toBe(view.overview.total);
    expect(view.closureTier).toBe("simulated");
    expect(view.honours.awards.find(a => a.label === "Campeón")).toEqual({teamId: table[0].teamId, label: "Campeón", tier: "simulated"});
    expect(view.relegated.map(r => r.teamId)).toEqual([table[14].teamId, table[15].teamId]);
    expect(view.international?.entries.filter(e => e.destination === "libertadores").map(e => e.sourceTeamId))
      .toEqual([table[0].teamId, table[1].teamId]);
    expect(view.nextSeasonPending).not.toContain("La liga todavía tiene partidos sin resultado.");
    expect(view.blockers).toEqual([]);
    expect(view.canConfirm).toBe(true);

    confirmSeasonClosure(reviewSeasonClosure(simulated.id, null, repository), null, repository, true);
    const closed = evaluateSeasonClosure(simulated, repository.findAll(), repository.findActivity(), null);
    expect(closed.state).toBe("Cierre confirmado");
  });
});
