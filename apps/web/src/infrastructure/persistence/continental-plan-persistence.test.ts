// @vitest-environment jsdom
import { afterEach,it,expect,vi } from "vitest";
import { LocalStorageTournamentRepository } from "./local-storage-tournament-repository";
import { continentalLeague } from "@cancha/core/test-utils/continental-qualification-fixtures";
import { continentalProjection,entryKey,continentalPlanState } from "@cancha/core/application/services/continental-projection";
import { confirmContinentalEdition,reviewContinentalEdition } from "@cancha/core/application/use-cases/prepare-continental-edition";
import { createTournamentBackup,parseTournamentBackupWithActivity } from "@cancha/core/application/services/tournament-archive";
afterEach(()=>{vi.restoreAllMocks();localStorage.clear();});
function prepare() {
 const repository=new LocalStorageTournamentRepository(false),t=continentalLeague();repository.save(t);
 const review=reviewContinentalEdition({cup:"libertadores",edition:2027,qualifyingSeason:2026,sourceIds:[t.id],selectedKeys:continentalProjection([t.id],2026,"libertadores",[t],[]).entries.map(entryKey),sourceUrl:"https://www.conmebol.com/documento-sintetico",note:"Prueba documental de vinculación"},repository);
 return {repository,t,review};
}
it("persists provenance and restores optional records and coordinated activity in v7",()=>{
 const {repository,review}=prepare();const cup=confirmContinentalEdition(review,repository,true);
 const archive=createTournamentBackup(repository.findAll(),undefined,repository.findActivity());expect(archive.version).toBe(7);
 const data=parseTournamentBackupWithActivity(JSON.stringify(archive));localStorage.clear();repository.importTournaments(data.tournaments,"replace",data.activity);
 const restored=new LocalStorageTournamentRepository(false).findAll().find(t=>t.id===cup.id)!;
 expect(restored.continentalPlans).toEqual(cup.continentalPlans);expect(continentalPlanState(restored.continentalPlans![0],repository.findAll(),repository.findActivity())).toContain("vigentes");
 expect(repository.findActivity().some(e=>e.action==="season-created")).toBe(true);
});
it("leaves the original library intact when the coordinated save fails",()=>{
 const {repository,review,t}=prepare();const before=localStorage.getItem("cancha.tournaments");
 const original=Storage.prototype.setItem;vi.spyOn(Storage.prototype,"setItem").mockImplementation(function(this:Storage,key,value){if(key==="cancha.activity")throw new DOMException("Quota exceeded","QuotaExceededError");return original.call(this,key,value);});
 expect(()=>confirmContinentalEdition(review,repository,true)).toThrow();expect(localStorage.getItem("cancha.tournaments")).toBe(before);expect(repository.findAll()).toHaveLength(1);expect(repository.findAll()[0].id).toBe(t.id);
});
