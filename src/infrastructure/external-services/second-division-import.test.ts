import { afterEach, describe, it, expect, vi } from "vitest";
import { divisionFixture } from "../../domain/services/second-division-test-fixtures";
import { EspnSouthAmericanLeagueSource } from "./espn-south-american-league-source";
import { importOfficialTournament } from "../../application/use-cases/import-official-tournament";
import type { Tournament } from "../../domain/entities/tournament";

function payload(kind: "argentina" | "brasil") {
  const t = divisionFixture(kind);
  const teams = new Map(t.teams.map(team => [team.id, team]));
  const events = t.matchdays.flatMap(day => day.fixtures.map(f => ({
    id: f.id, date: "2026-02-14T20:00Z", season: { year: 2026,
      slug: kind === "argentina" ? "regular-season" : "2026-brasileiro-serie-b" },
    competitions: [{ status: { type: { completed: true, state: "post", name: "STATUS_FULL_TIME" } },
      competitors: [
        { homeAway: "home", team: { id: f.homeTeamId, displayName: teams.get(f.homeTeamId)!.name }, score: String(f.result!.homeGoals) },
        { homeAway: "away", team: { id: f.awayTeamId, displayName: teams.get(f.awayTeamId)!.name }, score: String(f.result!.awayGoals) },
      ] }],
  })));
  const standings = { children: ["Zona A", "Zona B"].map((zone, index) => ({ name: index === 0 ? "Group A" : "Group B",
    standings: { season: 2026, entries: t.teams.filter(team => team.groupName === zone)
      .map(team => ({ team: { displayName: team.name } })) },
  })) };
  return { events, standings };
}
function stub(data: ReturnType<typeof payload>) {
  return vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
    url.includes("/standings?") ? data.standings : { events: data.events }), { status: 200 })));
}
afterEach(() => vi.unstubAllGlobals());

describe("second division ESPN imports", () => {
  it.each(["argentina", "brasil"] as const)("imports the real provider shape for %s and builds its pending promotion stages", async kind => {
    stub(payload(kind));
    const source = new EspnSouthAmericanLeagueSource();
    let saved: Tournament[] = [];
    const repository = { findAll: () => saved, save: (t: Tournament) => { saved = [t]; },
      saveWithActivity: (t: Tournament) => { saved = [t]; } };
    const league = kind === "argentina" ? "argentina-nacional" : "brasil-serie-b";
    const season = await source.fetchSeason(league);
    expect(season.sourceName).toContain("proveedor externo");
    expect(season.coverage).toBe("unknown");
    const imported = await importOfficialTournament(source, repository, undefined, league, undefined, { seasonData: season });
    expect(imported.teams).toHaveLength(kind === "argentina" ? 36 : 20);
    expect(imported.competitionRules?.verification.standings).toBe("verified");
    expect(imported.matchdays.flatMap(day => day.fixtures).filter(f => !f.result).length).toBeGreaterThan(0);
    expect(imported.rulesNote).toContain("no representan el orden oficial");
    // Preserve a manually entered playoff on update without replacing real regular scores.
    const phase = imported.matchdays.find(day => day.fixtures.some(f => !f.result))!;
    const f = phase.fixtures[0];
    saved = [{ ...imported, teams: imported.teams.map((team, index) => kind === "argentina" && index === 0
      ? { ...team, afaAffiliation: "direct", affiliationSourceUrl: "https://www.afa.com.ar/" } : team),
      matchdays: imported.matchdays.map(day => day === phase ? { ...day, fixtures: day.fixtures.map(item => item.id === f.id
        ? { ...item, result: { homeGoals: 2, awayGoals: 0 } } : item) } : day) }];
    const updated = await importOfficialTournament(source, repository, undefined, league, undefined,
      { seasonData: season, conflictResolution: "update-preserving-results" });
    expect(updated.matchdays.flatMap(day => day.fixtures).find(item => item.id === f.id)?.result).toEqual({ homeGoals: 2, awayGoals: 0 });
    if (kind === "argentina") expect(updated.teams[0].afaAffiliation).toBe("direct");
  });
  it("excludes provider placeholders instead of inventing playoff participants", async () => {
    const data = payload("brasil");
    data.events.push({ ...data.events[0], id: "placeholder", competitions: [{ ...data.events[0].competitions[0],
      competitors: data.events[0].competitions[0].competitors.map((team, index) => ({ ...team,
        team: { ...team.team, displayName: index === 0 ? "TBD Home" : "TBD Away" } })) }] });
    stub(data);
    const result = await new EspnSouthAmericanLeagueSource().fetchSeason("brasil-serie-b");
    expect(result.teams).toHaveLength(20);
    expect(result.matchdays.flatMap(day => day.matches)).toHaveLength(380);
  });
  it("rejects another year and unknown knockout mappings without partial success", async () => {
    const data = payload("brasil"); data.events[0].season.year = 2025; stub(data);
    await expect(new EspnSouthAmericanLeagueSource().fetchSeason("brasil-serie-b")).rejects.toThrow("otra temporada");
    data.events[0].season.year = 2026; data.events[0].season.slug = "unmapped-playoff"; stub(data);
    await expect(new EspnSouthAmericanLeagueSource().fetchSeason("brasil-serie-b")).rejects.toThrow("No se importaron datos parciales");
  });
  it("rejects missing, inconsistent or out-of-season Argentine groups", async () => {
    const data = payload("argentina"); data.standings.children[0].standings.season = 2025; stub(data);
    await expect(new EspnSouthAmericanLeagueSource().fetchSeason("argentina-nacional")).rejects.toThrow("2026");
    data.standings.children[0].standings.season = 2026;
    data.standings.children[0].standings.entries[0].team.displayName = "Unknown Club"; stub(data);
    await expect(new EspnSouthAmericanLeagueSource().fetchSeason("argentina-nacional")).rejects.toThrow("no coinciden");
  });
});
