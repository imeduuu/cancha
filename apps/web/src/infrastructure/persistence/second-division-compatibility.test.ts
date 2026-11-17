// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from "vitest";
import { divisionFixture } from "@cancha/core/domain/services/second-division-test-fixtures";
import { advanceSecondDivision } from "@cancha/core/domain/services/second-division-progression";
import { createTournamentArchive, parseTournamentArchive, createTournamentBackup, parseTournamentBackup, cloneTournamentWithNewIds } from "@cancha/core/application/services/tournament-archive";
import { LocalStorageTournamentRepository } from "./local-storage-tournament-repository";
import { updateTeamAffiliation } from "@cancha/core/application/use-cases/update-team-affiliation";

beforeEach(() => localStorage.clear());
describe("second divisions and version 7 data", () => {
  it.each(["argentina", "brasil"] as const)("round trips %s through localStorage and archives without losing fixtures or rules", kind => {
    const t = advanceSecondDivision(divisionFixture(kind));
    const repository = new LocalStorageTournamentRepository(false); repository.save(t);
    expect(repository.findAll()).toEqual([t]);
    const archive = createTournamentArchive(t);
    expect(archive.version).toBe(7);
    expect(parseTournamentArchive(JSON.stringify(archive))).toEqual(t);
    expect(parseTournamentBackup(JSON.stringify(createTournamentBackup([t])))).toEqual([t]);
    const clone = cloneTournamentWithNewIds(t);
    expect(clone.teams.map(team => team.afaAffiliation)).toEqual(t.teams.map(team => team.afaAffiliation));
  });
  it("keeps old archives without affiliation fields readable", () => {
    const t = divisionFixture("argentina");
    const legacy = { ...t, teams: t.teams.map(({ afaAffiliation: _a, affiliationSourceUrl: _s, ...team }) => team) };
    const archive = { ...createTournamentArchive(legacy), version: 6 };
    expect(parseTournamentArchive(JSON.stringify(archive)).teams[0].afaAffiliation).toBeUndefined();
  });
  it("saves affiliation with its source and activity, rejecting unsupported values", () => {
    const t = divisionFixture("argentina"), repository = new LocalStorageTournamentRepository(false); repository.save(t);
    const next = updateTeamAffiliation(t, "t0", "direct", "https://www.afa.com.ar/", repository);
    expect(repository.findAll()[0].teams[0]).toEqual(next.teams[0]);
    expect(repository.findActivity()[0].action).toBe("roster-updated");
    expect(() => updateTeamAffiliation(next, "t0", "indirect", "https://example.com/", repository)).toThrow("AFA");
    const bad = createTournamentArchive(next) as unknown as { tournament: { teams: { afaAffiliation: string }[] } };
    bad.tournament.teams[0].afaAffiliation = "guess";
    expect(() => parseTournamentArchive(JSON.stringify(bad))).toThrow();
  });
});
