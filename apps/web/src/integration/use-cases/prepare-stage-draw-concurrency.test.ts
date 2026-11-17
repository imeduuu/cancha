// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {LocalStorageTournamentRepository} from "../../infrastructure/persistence/local-storage-tournament-repository";
import {withLibraryWriteLock} from "../../infrastructure/persistence/library-write-lock";
import {installTestWebLocks} from "../../test-utils/web-locks";
import {drawCup} from "@cancha/core/test-utils/stage-draw-fixtures";
import {reviewStageDraw,confirmStageDraw,reviewDrawCalendar,confirmDrawCalendar,type StageDrawInput} from "@cancha/core/application/use-cases/prepare-stage-draw";
import {createScopedTournamentRepository} from "@cancha/core/application/services/sports-universes";
import {inspectDrawPreparation} from "@cancha/core/application/services/draw-and-bracket";
import {createTournamentBackup,parseTournamentBackupWithActivity} from "@cancha/core/application/services/tournament-archive";
beforeEach(()=>{localStorage.clear();installTestWebLocks();new LocalStorageTournamentRepository(false).save(drawCup());});
afterEach(()=>vi.restoreAllMocks());
function barrier(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
function setup(){const a=new LocalStorageTournamentRepository(),b=new LocalStorageTournamentRepository(),t=b.findAll()[0];
  const input:StageDrawInput={tournamentId:t.id,universeId:null,stage:"Semifinal",mode:"manual",resolution:"penalties",pairs:[{homeTeamId:t.teams[0].id,awayTeamId:t.teams[1].id},{homeTeamId:t.teams[2].id,awayTeamId:t.teams[3].id}]};
  const scoped=createScopedTournamentRepository(b,null,()=>b.getSportsUniverseLibrary());return {a,b,t,input,scoped,baseline:b.snapshot()};}
it("two reviewed draws under the real coordinator append exactly one record",async()=>{
  const s=setup(),a=reviewStageDraw(s.input,s.a),b=reviewStageDraw(s.input,s.scoped);
  const results=await Promise.allSettled([s.a.coordinate(s.baseline,()=>confirmStageDraw(a,s.a,null,true)),s.b.coordinate(s.baseline,()=>confirmStageDraw(b,s.scoped,null,true))]);
  expect(results.map(r=>r.status)).toEqual(["fulfilled","rejected"]);expect(s.b.findActivity().filter(e=>e.action==="stage-draw-confirmed")).toHaveLength(1);expect(s.b.findAll()).toEqual([s.t]);
});
it("queued confirmation rejects after an earlier writer releases the shared lease",async()=>{
  const s=setup(),review=reviewStageDraw(s.input,s.scoped),entered=barrier(),release=barrier();
  const writer=withLibraryWriteLock(async lease=>{entered.release();await release.promise;s.a.commitUnderLibraryLock(s.baseline,()=>s.a.save({...s.t,name:"Changed by other tab"}),lease);});
  await entered.promise;const confirm=vi.fn(()=>confirmStageDraw(review,s.scoped,null,true)),queued=s.b.coordinate(s.baseline,confirm);
  release.release();await writer;await expect(queued).rejects.toThrow(/biblioteca cambió/);expect(confirm).not.toHaveBeenCalled();expect(s.b.findActivity()).toEqual([]);
});
it("universe reassignment invalidates the review and preserves all participants",async()=>{
  const s=setup(),review=reviewStageDraw(s.input,s.scoped);await s.a.coordinate(s.baseline,()=>s.a.setSportsUniverseLibrary({version:1,activeUniverseId:"u",universes:[{id:"u",name:"Other game"}],assignments:{[s.t.id]:"u"}}));
  await expect(s.b.coordinate(s.baseline,()=>confirmStageDraw(review,s.scoped,null,true))).rejects.toThrow();expect(s.b.findActivity()).toEqual([]);expect(s.b.findAll()).toEqual([s.t]);
});
it("two fixture confirmations do not duplicate matches or overwrite reviewed IDs",async()=>{
  const s=setup(),r=reviewStageDraw(s.input,s.a),{event}=await s.a.coordinate(s.baseline,()=>confirmStageDraw(r,s.a,null,true));
  const a=reviewDrawCalendar(s.t.id,event.id,null,s.a),b=reviewDrawCalendar(s.t.id,event.id,null,s.b),baseline=s.a.snapshot();
  const results=await Promise.allSettled([s.a.coordinate(baseline,()=>confirmDrawCalendar(a,s.a,null,true)),s.b.coordinate(baseline,()=>confirmDrawCalendar(b,s.b,null,true))]);
  expect(results.map(r=>r.status)).toEqual(["fulfilled","rejected"]);expect(s.b.findAll()[0].matchdays.flatMap(d=>d.fixtures).map(f=>f.id)).toEqual(a.calendar.proposed.matchdays.flatMap(d=>d.fixtures).map(f=>f.id));
});
it("activity quota failure leaves no false confirmation and releases the lock",async()=>{
  const s=setup(),r=reviewStageDraw(s.input,s.a),original=Storage.prototype.setItem,spy=vi.spyOn(Storage.prototype,"setItem").mockImplementation(function(this:Storage,key,value){if(key==="cancha.activity")throw new DOMException("Quota","QuotaExceededError");return original.call(this,key,value);});
  await expect(s.a.coordinate(s.baseline,()=>confirmStageDraw(r,s.a,null,true))).rejects.toThrow();spy.mockRestore();expect(s.a.findActivity()).toEqual([]);expect(s.a.findAll()).toEqual([s.t]);
  const fresh=reviewStageDraw(s.input,s.a);await s.a.coordinate(s.a.snapshot(),()=>confirmStageDraw(fresh,s.a,null,true));expect(s.a.findActivity()).toHaveLength(1);
});
it("JSON restoration retains confirmed draw provenance and recovery support",async()=>{
  const s=setup(),r=reviewStageDraw(s.input,s.a);await s.a.coordinate(s.baseline,()=>confirmStageDraw(r,s.a,null,true));
  const backup=createTournamentBackup(s.a.findAll(),undefined,s.a.findActivity(),s.a.getSportsUniverseLibrary());
  await s.a.coordinate(s.a.snapshot(),()=>s.a.save({...s.t,name:"Edited"}));const parsed=parseTournamentBackupWithActivity(JSON.stringify(backup));
  await s.a.coordinate(s.a.snapshot(),()=>s.a.importTournaments(parsed.tournaments,"replace",parsed.activity,false,parsed.universes));
  expect(inspectDrawPreparation(s.a.findAll()[0],s.a.findAll(),s.a.findActivity(),null).stages[0].current).toBe(true);expect(s.a.findActivity().find(e=>e.action==="stage-draw-confirmed")?.imported).toBe(true);expect(s.a.getRecoverySnapshotStatus().available).toBe(true);
});
it("without Web Locks drawing remains read-only and JSON v7 export remains available",async()=>{
  const s=setup(),r=reviewStageDraw(s.input,s.a);Object.defineProperty(navigator,"locks",{configurable:true,value:undefined});
  await expect(s.a.coordinate(s.baseline,()=>confirmStageDraw(r,s.a,null,true))).rejects.toThrow(/Web Locks/);expect(s.a.findActivity()).toEqual([]);expect(createTournamentBackup(s.a.findAll()).version).toBe(7);
});
