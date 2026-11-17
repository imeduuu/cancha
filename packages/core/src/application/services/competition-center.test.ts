import { describe, expect, it } from "vitest";
import type { Tournament } from "../../domain/entities/tournament";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import { groupCompetitions, seasonOverview, seasonOrigins, recordedSeasonMovements } from "./competition-center";
import { createTournamentBackup, parseTournamentBackup } from "./tournament-archive";
const t: Tournament = { id: "a", competitionId: "brasileirao-serie-a", name: "Liga", season: 2026,
 teams: [{id:"a1",name:"Alfa"},{id:"a2",name:"Beta"}], legs: 1, tieBreakers: [], matchdays: [], createdAt:"2026-01-01T00:00:00.000Z" };
const event = (action: ActivityEvent["action"], before?: unknown): ActivityEvent => ({id:"event",occurredAt:t.createdAt,action,tournamentId:t.id,tournamentName:t.name,summary:"Cambio",before});
describe("competition center read model", () => {
 it("groups exact identities across years and includes archived records without mutation", () => {
  const values = [t,{...t,id:"b",season:2027,archived:true}]; const snapshot=JSON.stringify(values);
  const groups=groupCompetitions(values); expect(groups).toHaveLength(1); expect(groups[0].territory).toBe("Brasil");
  expect(groups[0].seasons.map(t=>t.season)).toEqual([2027,2026]); expect(JSON.stringify(values)).toBe(snapshot);
 });
 it.each(["anfp-liga-segunda-ascenso", "anfp-liga-segunda-descenso"])("recognizes the configured Chilean zone identity %s", id => {
  const group=groupCompetitions([{...t,competitionId:id}])[0];
  expect(group.territory).toBe("Chile"); expect(group.category).toBe("Tercera");
 });
 it("does not infer relationships from similar names or unknown legacy identifiers", () => {
  expect(groupCompetitions([{...t,competitionId:undefined,id:"Liga-2026"},{...t,competitionId:undefined,id:"Liga-2027"}])).toHaveLength(2);
 });
 it("recognizes only registered legacy competition identifiers", () => {
  expect(groupCompetitions([{...t,competitionId:undefined,id:"brasileirao-serie-a-2026"},t])).toHaveLength(1);
 });
 it("separates imported provenance from local simulation without certifying results", () => {
  const imported={...t,sourceUrl:"https://www.espn.com/"};
  expect(seasonOverview(imported,[]).provenance).toContain("sin certificación");
  expect(seasonOverview(imported,[event("matches-simulated")]).provenance).toContain("Escenario local");
 });
 it("shows verified regulations for the matching year without certifying results", () => {
  const overview=seasonOverview({...t,competitionRules:{season:2026,verification:{standings:"verified",placements:"verified"}}},[]);
  expect(overview.rules).toBe("Tabla: verificado; clasificaciones: verificado");
  expect(overview.provenance).not.toContain("oficial confirmada");
 });
 it("lists pending division progression through the existing sporting service", () => {
  const overview=seasonOverview({...t,competitionId:"brasileirao-serie-b"},[]);
  expect(overview.pending.some(p => /incompleta|pendiente/.test(p))).toBe(true);
 });
 it("keeps future regulations pending when the configured year differs", () => {
  const overview=seasonOverview({...t,season:2027,competitionRules:{season:2026,verification:{standings:"verified",placements:"verified"}}},[]);
  expect(overview.rules).toContain("Tabla: pendiente"); expect(overview.pending.length).toBeGreaterThan(0);
 });
 it("uses explicit origin references and keeps missing source identifiers", () => {
  const planned={...t,seasonPreparation:{schemaVersion:1 as const,sourceTournamentIds:["upper","lower"],plannedParticipants:["Alfa","Beta"],calendarReviews:[]}};
  expect(seasonOrigins(planned,[])).toEqual(["upper","lower"]); expect(seasonOverview(planned,[]).provenance).toContain("Planificación");
  expect(seasonOrigins(t,[event("season-created",{sourceTournamentId:"history"})])).toEqual(["history"]);
 });
 it("finds historical movements for both prepared divisions only from the coordinated event", () => {
  const movements={...event("season-created"),after:{tournamentIds:["a","other"],promoted:["club"],upperRelegated:["down"],lowerRelegated:[]}};
  expect(recordedSeasonMovements(t,[movements])?.promoted).toEqual(["club"]);
  expect(recordedSeasonMovements({...t,id:"other"},[movements])?.upperRelegated).toEqual(["down"]);
  expect(recordedSeasonMovements({...t,id:"unrelated"},[movements])).toBeUndefined();
 });
 it("accepts a legacy backup without optional season extensions and changes no saved data", () => {
  const archive={...createTournamentBackup([{...t,competitionId:undefined,season:undefined}]),version:1};
  const restored=parseTournamentBackup(JSON.stringify(archive));
  const overview=seasonOverview(restored[0],[]); expect(overview.total).toBe(0);
  expect(groupCompetitions(restored)[0].territory).toBe("Sin país registrado");
  expect(restored[0].seasonPreparation).toBeUndefined();
 });
});
