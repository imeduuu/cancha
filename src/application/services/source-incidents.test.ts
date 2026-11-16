// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { OfficialLeagueSeason } from "../ports/official-league-source";
import { importOfficialTournament } from "../use-cases/import-official-tournament";
import { LocalStorageTournamentRepository } from "../../infrastructure/persistence/local-storage-tournament-repository";
import { applySourceCorrections, listSourceIncidents, reviewSourceIncident, revokeSourceIncident } from "./source-incidents";
import { createTournamentBackup, parseTournamentBackupWithActivity } from "./tournament-archive";
import { isActivityEvent } from "../../domain/entities/activity-event";
import type { SourceCorrection } from "../../domain/entities/source-incident";
import sample from "../../test-utils/fixtures/live/anfa-repeated-home.json";

// Synthetic four-club season: a correction in this fixture is NOT an assertion about ANFA's real match.
function season(): OfficialLeagueSeason {
  const pairs = [["Club A", "Club B"], ["Club C", "Club D"], ["Club A", "Club C"], ["Club B", "Club D"],
    ["Club A", "Club D"], ["Club B", "Club C"], ["Club A", "Club B"], ["Club D", "Club C"],
    ["Club C", "Club A"], ["Club D", "Club B"], ["Club D", "Club A"], ["Club C", "Club B"]];
  return { id: "test-source-2026", name: "Liga de prueba", season: 2026,
    sourceUrl: "https://anfaterceradivision.cl/test", sourceName: "ANFA (fixture sintético)",
    matchdays: Array.from({ length: 6 }, (_, i) => ({ number: i + 1, matches: pairs.slice(i * 2, i * 2 + 2)
      .map(([homeTeamName, awayTeamName], j) => ({ id: `${i}-${j}`, homeTeamName, awayTeamName, homeGoals: 1, awayGoals: 0 })) })) };
}
let repository: LocalStorageTournamentRepository;
beforeEach(() => { localStorage.clear(); repository = new LocalStorageTournamentRepository(false); });
async function reject(data = season()) {
  await expect(importOfficialTournament({ fetchSeason: async () => data }, repository)).rejects.toThrow();
  expect(repository.findAll()).toEqual([]);
  return listSourceIncidents(repository)[0];
}
async function verify() {
  const incident = await reject();
  const original = incident.matches.find(m => m.matchId === "3-0")!;
  const correction: SourceCorrection = { original, replacement: { homeTeamName: "Club B", awayTeamName: "Club A", homeGoals: 1, awayGoals: 0 },
    documentUrl: "https://anfaterceradivision.cl/documento-de-prueba", reference: "Documento sintético para prueba", confirmed: true };
  return { incident, correction };
}
describe("external source incidents", () => {
  it("records automatic duplicate home incidents and deduplicates retries, preserving original scores and both matches", async () => {
    const incident = await reject();
    expect(incident).toMatchObject({ status: "pending", origin: "automatic", type: "repeated-home", season: 2026 });
    expect(incident.matches.map(m => m.matchId)).toEqual(["0-0", "3-0"]);
    await reject(); expect(listSourceIncidents(repository)).toHaveLength(1);
    expect(JSON.parse(incident.matches[1].published)).toMatchObject({ homeTeamName: "Club A", homeGoals: 1, awayGoals: 0 });
  });
  it("records the real captured ANFA inconsistency without proposing or applying a correction", async () => {
    const data: OfficialLeagueSeason = { ...season(), matchdays: sample.matches.map((m, i) => ({ number: m.round,
      matches: [{ id: `captured-${i}`, homeTeamName: m.home, awayTeamName: m.away, homeGoals: i ? 2 : 1, awayGoals: i ? 3 : 0 }] })) };
    const incident = await reject(data);
    expect(incident.matches).toHaveLength(2); expect(incident.corrections).toEqual([]);
    expect(JSON.parse(incident.matches[0].published).homeTeamName).toBe("Comunal Cabrero");
  });
  it("requires documentation and confirmation, and provisional corrections cannot bypass validation", async () => {
    const { incident, correction } = await verify();
    expect(() => reviewSourceIncident(repository, incident.id, 1, [{ ...correction, reference: "" }], true, true, "Motivo")).toThrow();
    expect(() => reviewSourceIncident(repository, incident.id, 1, [{ ...correction, documentUrl: "http://example.com" }], true, true, "Motivo")).toThrow();
    expect(() => reviewSourceIncident(repository, incident.id, 1, [correction], true, false, "Motivo")).toThrow();
    reviewSourceIncident(repository, incident.id, 1, [correction], false, true, "Pendiente de contrastar");
    await expect(importOfficialTournament({ fetchSeason: async () => season() }, repository)).rejects.toThrow("localía");
  });
  it("applies verified values before sports validation, retains IDs and original data, and never swaps scores", async () => {
    const { incident, correction } = await verify();
    reviewSourceIncident(repository, incident.id, 1, [correction], true, true, "Contrastado");
    const data = season(); const before = JSON.stringify(data);
    const imported = await importOfficialTournament({ fetchSeason: async () => data }, repository);
    const match = imported.matchdays.flatMap(d => d.fixtures).find(f => f.id === "official-2026-3-0")!;
    expect(imported.teams.find(t => t.id === match.homeTeamId)?.name).toBe("Club B");
    expect(match.result).toEqual({ homeGoals: 1, awayGoals: 0 }); expect(JSON.stringify(data)).toBe(before);
    expect(JSON.parse(listSourceIncidents(repository)[0].matches[1].published).homeTeamName).toBe("Club A");
    expect(repository.findActivity().filter(e => e.action === "source-incident-reviewed")).toHaveLength(2);
  });
  it("invalidates when the provider changes and does not reactivate if it reverts", async () => {
    const { incident, correction } = await verify();
    reviewSourceIncident(repository, incident.id, 1, [correction], true, true, "Contrastado");
    const data = season(); const changed = { ...data, matchdays: data.matchdays.map(d => ({ ...d, matches: d.matches.map(m => m.id === "3-0" ? { ...m, homeGoals: 2 } : m) })) };
    expect(applySourceCorrections(repository, changed)).toEqual(changed);
    expect(listSourceIncidents(repository)[0].status).toBe("stale");
    expect(applySourceCorrections(repository, data)).toEqual(data);
    expect(repository.findAll()).toEqual([]);
    await reject(); expect(listSourceIncidents(repository)).toHaveLength(2);
  });
  it("recognizes when the provider publishes the correction, and scopes corrections to year and competition", async () => {
    const { incident, correction } = await verify();
    reviewSourceIncident(repository, incident.id, 1, [correction], true, true, "Contrastado");
    const data = season();
    const future = { ...data, season: 2027, id: "test-source-2027" };
    expect(applySourceCorrections(repository, future)).toEqual(future);
    const other = { ...data, id: "other-source-2026" };
    expect(applySourceCorrections(repository, other)).toEqual(other);
    const corrected = applySourceCorrections(repository, data);
    expect(applySourceCorrections(repository, corrected)).toEqual(corrected);
    expect(listSourceIncidents(repository)[0].status).toBe("provider-corrected");
  });
  it("does not modify stored seasons when registering corrections, preserves local results and requires explicit reimport mode", async () => {
    const { incident, correction } = await verify();
    reviewSourceIncident(repository, incident.id, 1, [correction], true, true, "Contrastado");
    const imported = await importOfficialTournament({ fetchSeason: async () => season() }, repository);
    const local = { ...imported, matchdays: imported.matchdays.map(d => ({ ...d, fixtures: d.fixtures.map(f => ({ ...f, result: { homeGoals: 4, awayGoals: 2 } })) })) };
    repository.save(local);
    await expect(importOfficialTournament({ fetchSeason: async () => season() }, repository)).rejects.toThrow("ya existe");
    const updated = await importOfficialTournament({ fetchSeason: async () => season() }, repository, undefined, "primera", undefined,
      { conflictResolution: "update-preserving-results" });
    expect(updated.matchdays.flatMap(d => d.fixtures).every(f => f.result?.homeGoals === 4)).toBe(true);
    revokeSourceIncident(repository, incident.id, 2, "Revisar acta");
    expect(repository.findAll()[0]).toEqual(updated);
  });
  it("round-trips incident history in v7 backups even without any saved tournament, and accepts old backups", async () => {
    const { incident, correction } = await verify();
    reviewSourceIncident(repository, incident.id, 1, [correction], true, true, "Contrastado");
    const backup = createTournamentBackup([], undefined, repository.findActivity());
    const parsed = parseTournamentBackupWithActivity(JSON.stringify(backup));
    expect(parsed.activity).toHaveLength(2);
    localStorage.clear(); repository.importTournaments(parsed.tournaments, "replace", parsed.activity);
    expect(listSourceIncidents(repository)[0].status).toBe("verified");
    expect(applySourceCorrections(repository, season()).matchdays[3].matches[0].homeTeamName).toBe("Club B");
    const legacy = { ...backup, version: 6, activity: undefined };
    expect(parseTournamentBackupWithActivity(JSON.stringify(legacy)).activity).toEqual([]);
    const old = { ...backup, activity: [] };
    expect(parseTournamentBackupWithActivity(JSON.stringify(old)).activity).toEqual([]);
    const malformed = { ...backup, activity: [{ ...backup.activity[1], after: { ...incident, status: "verified", corrections: [] } }] };
    expect(() => parseTournamentBackupWithActivity(JSON.stringify(malformed))).toThrow();
    expect(isActivityEvent(malformed.activity[0])).toBe(false);
  });
  it("invalidates changed publication URLs and requires a new revision after revocation", async () => {
    const { incident, correction } = await verify();
    reviewSourceIncident(repository, incident.id, 1, [correction], true, true, "Contrastado");
    const moved = { ...season(), sourceUrl: "https://anfaterceradivision.cl/new-calendar" };
    expect(applySourceCorrections(repository, moved)).toEqual(moved);
    expect(listSourceIncidents(repository)[0].status).toBe("stale");
    expect(() => reviewSourceIncident(repository, incident.id, 2, [correction], true, true, "Antiguo")).toThrow();
  });
  it("rejects stale forms and corrections targeting encounters outside the incident", async () => {
    const { incident, correction } = await verify();
    expect(() => reviewSourceIncident(repository, incident.id, 1, [{ ...correction,
      original: { ...correction.original, matchId: "other" } }], true, true, "Otro encuentro")).toThrow();
    reviewSourceIncident(repository, incident.id, 1, [correction], true, true, "Contrastado");
    expect(() => reviewSourceIncident(repository, incident.id, 1, [correction], true, true, "Formulario antiguo")).toThrow("cambió");
  });
  it("preserves the registry on a failed storage write", async () => {
    const { incident, correction } = await verify();
    const before = repository.findActivity();
    const failing = { findAll: () => [], save: () => {}, findActivity: () => before,
      recordActivity: () => { throw new Error("Sin espacio"); } };
    expect(() => reviewSourceIncident(failing, incident.id, 1, [correction], true, true, "Contrastado")).toThrow("Sin espacio");
    expect(repository.findActivity()).toEqual(before);
    expect(listSourceIncidents(repository)[0].status).toBe("pending");
  });

  it("runs the complete sports validation even after a verified correction", async () => {
    const { incident, correction } = await verify();
    reviewSourceIncident(repository, incident.id, 1, [{ ...correction,
      replacement: { homeTeamName: "Club A", awayTeamName: "Club B", homeGoals: 2, awayGoals: 0 } }], true, true, "Solo marcador");
    await expect(importOfficialTournament({ fetchSeason: async () => season() }, repository)).rejects.toThrow("localía");
    expect(repository.findAll()).toEqual([]);
  });
  it("refuses participant changes over a saved encounter with local data in conservative mode", async () => {
    const { incident, correction } = await verify();
    reviewSourceIncident(repository, incident.id, 1, [correction], true, true, "Contrastado");
    const imported = await importOfficialTournament({ fetchSeason: async () => season() }, repository);
    const target = imported.matchdays.flatMap(d => d.fixtures).find(f => f.id === "official-2026-3-0")!;
    // A historical local record with a different participant assignment must never be overwritten implicitly.
    const prior = { ...imported, matchdays: imported.matchdays.map(d => ({ ...d, fixtures: d.fixtures.map(f => [target.id, "official-2026-0-0"].includes(f.id)
      ? { ...f, homeTeamId: f.awayTeamId, awayTeamId: f.homeTeamId, result: { homeGoals: 7, awayGoals: 1 } } : f) })) };
    repository.save(prior);
    await expect(importOfficialTournament({ fetchSeason: async () => season() }, repository, undefined, "primera", undefined,
      { conflictResolution: "update-preserving-results" })).rejects.toThrow("datos locales");
    expect(repository.findAll()[0]).toEqual(prior);
  });

});
