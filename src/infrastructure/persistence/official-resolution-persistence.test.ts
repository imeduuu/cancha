// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from "vitest";
import { LocalStorageTournamentRepository } from "./local-storage-tournament-repository";
import { afa, multipleTie, programme, seedTie } from "../../test-utils/official-resolution-fixtures";
import { getOfficialResolutionContexts, getDivisionOutcome } from "../../domain/services/second-division-progression";
import { recordOfficialResolution } from "../../application/use-cases/record-official-resolution";
import { createTournamentArchive, parseTournamentArchive, createTournamentBackup, parseTournamentBackupWithActivity, cloneTournamentWithNewIds } from "../../application/services/tournament-archive";
import { importTournamentArchive } from "../../application/use-cases/import-tournament-archive";
import { duplicateTournament } from "../../application/use-cases/manage-tournaments";
import { validateTournamentIntegrity } from "../../domain/services/tournament-integrity";
import { programmeOrder } from "../../domain/services/official-programme";

beforeEach(() => localStorage.clear());
describe("optional official resolutions in version 7", () => {
  it("persists and restores sourced programmes, status, references and activity", () => {
    const repository = new LocalStorageTournamentRepository(false), t = multipleTie(); repository.save(t);
    const context = getOfficialResolutionContexts(t).find(item => item.scope === "argentina-relegation")!;
    const next = recordOfficialResolution(t, { context, source: afa, verification: "verified", programme: programme(), verifiedByUser: true }, repository);
    expect(repository.findAll()).toEqual([next]);
    const backup = createTournamentBackup([next], undefined, repository.findActivity());
    expect(backup.version).toBe(7);
    const restored = parseTournamentBackupWithActivity(JSON.stringify(backup));
    expect(restored.tournaments).toEqual([next]);
    expect(restored.activity[0].action).toBe("official-resolution-recorded");
    expect(restored.activity[0].imported).toBe(true);
    localStorage.clear();
    const imported = importTournamentArchive(restored.tournaments[0], "add", repository)!;
    expect(programmeOrder(imported, context)).toEqual(["t17", "t16", "t15"]);
    expect(repository.findAll()[0].officialResolutions![0].programme!.matches).toHaveLength(3);
    expect(getDivisionOutcome(imported).relegated.some(row => row.teamId === "t15")).toBe(true);
  });
  it("keeps legacy files without the extension readable and rejects malformed nested fields", () => {
    const t = multipleTie();
    const legacy = { ...createTournamentArchive(t), version: 6 };
    expect(parseTournamentArchive(JSON.stringify(legacy)).officialResolutions).toBeUndefined();
    const repository = new LocalStorageTournamentRepository(false); repository.save(t);
    const context = getOfficialResolutionContexts(t).find(item => item.scope === "argentina-relegation")!;
    const next = recordOfficialResolution(t, { context, source: afa, verification: "verified", programme: programme(), verifiedByUser: true }, repository);
    const before = { ...localStorage };
    const bad = JSON.parse(JSON.stringify(createTournamentArchive(next)));
    bad.tournament.officialResolutions[0].programme.matches[0].awayTeamId = "unknown";
    expect(() => parseTournamentArchive(JSON.stringify(bad))).toThrow();
    expect({ ...localStorage }).toEqual(before);
    const contradictory = JSON.parse(JSON.stringify(createTournamentArchive(next)));
    contradictory.tournament.officialResolutions[0].programme.conclusion = {
      orderedTeamIds: ["t15", "t16", "t17"], source: afa,
    };
    expect(() => parseTournamentArchive(JSON.stringify(contradictory))).toThrow("invertir");
    const malformedScore = JSON.parse(JSON.stringify(createTournamentArchive(next)));
    malformedScore.tournament.officialResolutions[0].programme.matches[0].result.extraTime = null;
    expect(() => parseTournamentArchive(JSON.stringify(malformedScore))).toThrow();
    expect({ ...localStorage }).toEqual(before);
    bad.tournament.officialResolutions = {};
    expect(() => parseTournamentArchive(JSON.stringify(bad))).toThrow();
  });
  it("archives revisions and remaps copied participant references without activating their old decisions", () => {
    const t = seedTie(), repository = new LocalStorageTournamentRepository(false); repository.save(t);
    const context = getOfficialResolutionContexts(t)[0];
    const provisional = recordOfficialResolution(t, { context, source: afa, verification: "provisional", orderedTeamIds: ["t22", "t4"], verifiedByUser: false }, repository);
    const next = recordOfficialResolution(provisional, { context, source: afa, verification: "verified", orderedTeamIds: ["t22", "t4"], verifiedByUser: true }, repository);
    const restored = parseTournamentArchive(JSON.stringify(createTournamentArchive(next)));
    expect(restored.officialResolutions).toEqual(next.officialResolutions);
    const copied = cloneTournamentWithNewIds(restored);
    expect(validateTournamentIntegrity(copied)).toEqual([]);
    expect(copied.officialResolutions!.every(record => record.invalidation)).toBe(true);
    expect(copied.officialResolutions![1].participantIds.every(id => copied.teams.some(team => team.id === id))).toBe(true);
    expect(copied.officialResolutions![0].supersededBy).toBe(copied.officialResolutions![1].id);
    const duplicate = duplicateTournament(next, "reset", repository);
    expect(duplicate.officialResolutions!.every(record => record.invalidation)).toBe(true);
    expect(next.officialResolutions![1].invalidation).toBeUndefined();
  });
});
