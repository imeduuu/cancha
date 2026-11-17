// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalStorageTournamentRepository } from "../../infrastructure/persistence/local-storage-tournament-repository";
import { withLibraryWriteLock } from "../../infrastructure/persistence/library-write-lock";
import { installTestWebLocks } from "../../test-utils/web-locks";
import { closureLeague } from "@cancha/core/test-utils/season-closure-fixtures";
import { createScopedTournamentRepository } from "@cancha/core/application/services/sports-universes";
import { reviewSeasonClosure, confirmSeasonClosure } from "@cancha/core/application/use-cases/confirm-season-closure";
import { updateMatchResult } from "@cancha/core/application/use-cases/update-match-result";
import { evaluateSeasonClosure } from "@cancha/core/application/services/season-closure";
import { createTournamentBackup, parseTournamentBackupWithActivity } from "@cancha/core/application/services/tournament-archive";

function barrier() { let release!: () => void;const promise = new Promise<void>(resolve => {release = resolve;});return {promise,release}; }
beforeEach(() => {localStorage.clear();installTestWebLocks();new LocalStorageTournamentRepository(false).save(closureLeague());});
afterEach(() => vi.restoreAllMocks());
function setup() {
  const a = new LocalStorageTournamentRepository(), b = new LocalStorageTournamentRepository();
  const scoped = createScopedTournamentRepository(b,null,() => b.getSportsUniverseLibrary());
  const t = b.findAll()[0], review = reviewSeasonClosure(t.id,null,scoped), baseline = b.snapshot();
  return {a,b,scoped,t,review,baseline};
}
it("a queued closure revalidates after the same global lock and preserves the other tab's result", async () => {
  const {a,b,scoped,t,review,baseline} = setup(), entered = barrier(), release = barrier();
  const writer = withLibraryWriteLock(async lease => { entered.release();await release.promise;
    a.commitUnderLibraryLock(baseline,() => updateMatchResult(t,t.matchdays[0].fixtures[0].id,{homeGoals:8,awayGoals:0},a),lease);
  });
  await entered.promise;
  const close = vi.fn(() => confirmSeasonClosure(review,null,scoped,true));
  const queued = b.coordinate(baseline,close);expect(close).not.toHaveBeenCalled();
  release.release();await writer;
  await expect(queued).rejects.toThrow(/biblioteca cambió/);expect(close).not.toHaveBeenCalled();
  expect(b.findActivity().filter(e => e.action === "season-closure-confirmed")).toEqual([]);
  expect(b.findAll()[0].matchdays[0].fixtures[0].result).toEqual({homeGoals:8,awayGoals:0});
});
it("simultaneous reviewed closures append exactly one confirmation", async () => {
  const {a,b,scoped,t,review,baseline} = setup(), other = reviewSeasonClosure(t.id,null,a);
  const results = await Promise.allSettled([a.coordinate(baseline,()=>confirmSeasonClosure(other,null,a,true)),b.coordinate(baseline,()=>confirmSeasonClosure(review,null,scoped,true))]);
  expect(results.map(r=>r.status)).toEqual(["fulfilled","rejected"]);
  expect(b.findActivity().filter(e=>e.action === "season-closure-confirmed")).toHaveLength(1);
});
it("universe reassignment invalidates an earlier closure review", async () => {
  const {a,b,scoped,t,review,baseline} = setup();
  await a.coordinate(baseline,()=>a.setSportsUniverseLibrary({version:1,activeUniverseId:"new",universes:[{id:"new",name:"Other game"}],assignments:{[t.id]:"new"}}));
  await expect(b.coordinate(baseline,()=>confirmSeasonClosure(review,null,scoped,true))).rejects.toThrow();
  expect(b.findActivity().some(e=>e.action === "season-closure-confirmed")).toBe(false);
});
it("quota failure cannot leave a false closure and the lock is released", async () => {
  const {b,scoped,review,baseline} = setup(), original = Storage.prototype.setItem;let fail = true;
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(function(this: Storage,key,value) {if(key==="cancha.activity" && fail){fail=false;throw new DOMException("Quota","QuotaExceededError");}original.call(this,key,value);});
  await expect(b.coordinate(baseline,()=>confirmSeasonClosure(review,null,scoped,true))).rejects.toThrow();
  expect(b.snapshot()).toBe(baseline);
  await b.coordinate(baseline,()=>confirmSeasonClosure(review,null,scoped,true));
  expect(b.findActivity()).toHaveLength(1);
});
it("without Web Locks confirmation is blocked without losing JSON export", async () => {
  const {b,scoped,review,baseline} = setup();Object.defineProperty(navigator,"locks",{configurable:true,value:undefined});
  await expect(b.coordinate(baseline,()=>confirmSeasonClosure(review,null,scoped,true))).rejects.toThrow(/Web Locks/);
  expect(b.snapshot()).toBe(baseline);expect(createTournamentBackup(b.findAll()).version).toBe(7);
});
it("JSON restoration retains a matching closure and its provenance without changing backup version", async () => {
  const {b,scoped,t,review,baseline} = setup();
  await b.coordinate(baseline,()=>confirmSeasonClosure(review,null,scoped,true));
  const backup = createTournamentBackup(b.findAll(),undefined,b.findActivity(),b.getSportsUniverseLibrary());
  await b.coordinate(b.snapshot(),()=>updateMatchResult(t,t.matchdays[0].fixtures[0].id,{homeGoals:7,awayGoals:0},b));
  const parsed = parseTournamentBackupWithActivity(JSON.stringify(backup));
  await b.coordinate(b.snapshot(),()=>b.importTournaments(parsed.tournaments,"replace",parsed.activity,false,parsed.universes));
  expect(evaluateSeasonClosure(b.findAll()[0],b.findAll(),b.findActivity(),null).confirmed).toBe(true);
  expect(b.findActivity().find(e=>e.action==="season-closure-confirmed")?.imported).toBe(true);
  expect(b.getRecoverySnapshotStatus().available).toBe(true);
});
