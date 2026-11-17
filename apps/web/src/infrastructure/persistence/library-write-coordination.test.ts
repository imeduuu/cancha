// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStorageTournamentRepository } from "./local-storage-tournament-repository";
import { withLibraryWriteLock, libraryWriteLockName } from "./library-write-lock";
import { installTestWebLocks } from "../../test-utils/web-locks";
import { checkpointLibrary } from "@cancha/core/test-utils/save-checkpoint-fixtures";
import { updateMatchResult } from "@cancha/core/application/use-cases/update-match-result";
import { simulateFixtures } from "@cancha/core/application/use-cases/simulate-fixtures";
import { updateFixtureSchedule } from "@cancha/core/application/use-cases/update-fixture-schedule";
import { createScopedTournamentRepository } from "@cancha/core/application/services/sports-universes";
import { IndexedDbSaveCheckpointStore } from "./indexed-db-save-checkpoint-store";

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
function seed() {
  const data = checkpointLibrary();
  new LocalStorageTournamentRepository(false).importTournaments(data.tournaments, "replace", data.activity, false, data.universes);
  return data;
}
beforeEach(() => { localStorage.clear(); installTestWebLocks(); seed(); });
afterEach(() => vi.restoreAllMocks());

describe("library-wide coordinated sporting commands", () => {
  it.each(["one", "two"])("serializes competing writes, including tournament %s, and rejects the stale command", async id => {
    const a = new LocalStorageTournamentRepository(true), b = new LocalStorageTournamentRepository(true);
    const expected = a.snapshot(), first = a.findAll().find(t => t.id === "one")!, second = b.findAll().find(t => t.id === id)!;
    const entered = barrier(), release = barrier();
    const holder = withLibraryWriteLock(async lease => {
      entered.release(); await release.promise;
      a.commitUnderLibraryLock(expected, () => a.save({...first, name: "Primera escritura"}), lease);
    });
    await entered.promise;
    const action = vi.fn(() => b.save({...second, name: "Obsoleto"}));
    const queued = b.coordinate(expected, action);
    expect(action).not.toHaveBeenCalled();
    release.release(); await holder;
    await expect(queued).rejects.toThrow(/biblioteca cambió/);
    expect(action).not.toHaveBeenCalled();
    expect(b.findAll().find(t => t.id === "one")!.name).toBe("Primera escritura");
    await b.coordinate(b.snapshot(), () => b.save({...b.findAll().find(t => t.id === id)!, name: "Revisado"}));
    expect(b.findAll().find(t => t.id === id)!.name).toBe("Revisado");
  });

  it("rejects duplicate confirmations before entering the second command", async () => {
    const repo = new LocalStorageTournamentRepository(true), expected = repo.snapshot(), t = repo.findAll()[0];
    const action = vi.fn(() => repo.save({...t, name: "Confirmado"}));
    const results = await Promise.allSettled([repo.coordinate(expected, action), repo.coordinate(expected, action)]);
    expect(results.map(r => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("preserves simulated scores and activity when a manual editor is stale; no new randomness", async () => {
    const repo = new LocalStorageTournamentRepository(true), t = repo.findAll().find(t => t.id === "one")!;
    const pending = {...t, matchdays: t.matchdays.map(d => ({...d, fixtures: d.fixtures.map(f => ({...f, result: undefined}))}))};
    await repo.coordinate(repo.snapshot(), () => repo.save(pending));
    const baseline = repo.snapshot(), random = vi.fn(() => .5);
    await repo.coordinate(baseline, () => simulateFixtures(pending, ["f-one"], "pendingOnly", repo, random));
    const saved = repo.snapshot(), calls = random.mock.calls.length;
    await expect(repo.coordinate(baseline, () => updateMatchResult(pending, "f-one", {homeGoals: 9, awayGoals: 0}, repo))).rejects.toThrow(/biblioteca cambió/);
    await expect(repo.coordinate(baseline, () => simulateFixtures(pending, ["f-one"], "pendingOnly", repo, random))).rejects.toThrow();
    expect(repo.snapshot()).toBe(saved); expect(random).toHaveBeenCalledTimes(calls);
    expect(repo.findActivity().some(e => e.action === "matches-simulated")).toBe(true);
  });

  it("rejects a stale calendar without losing the newer manual result", async () => {
    const repo = new LocalStorageTournamentRepository(true), t = repo.findAll().find(t => t.id === "one")!, baseline = repo.snapshot();
    await repo.coordinate(baseline, () => updateMatchResult(t, "f-one", {homeGoals: 4, awayGoals: 3}, repo));
    const saved = repo.snapshot();
    await expect(repo.coordinate(baseline, () => updateFixtureSchedule(t, "f-one", null, repo))).rejects.toThrow();
    expect(repo.snapshot()).toBe(saved);
  });

  it("a replacement invalidates a queued sporting command and keeps recovery", async () => {
    const repo = new LocalStorageTournamentRepository(true), baseline = repo.snapshot(), stale = repo.findAll()[0];
    const original = checkpointLibrary();
    const data = {...original, tournaments: original.tournaments.map((t, index) => index === 0 ? {...t, name: "Restaurado"} : t)};
    await repo.coordinate(baseline, () => repo.importTournaments(data.tournaments, "replace", data.activity, false, data.universes));
    const restored = repo.snapshot();
    await expect(repo.coordinate(baseline, () => repo.save({...stale, name: "Tardío"}))).rejects.toThrow();
    expect(repo.snapshot()).toBe(restored); expect(repo.hasRecoverableSnapshot()).toBe(true);
  });

  it("universe metadata invalidates commands even for different tournaments", async () => {
    const repo = new LocalStorageTournamentRepository(true), baseline = repo.snapshot(), t = repo.findAll()[0];
    await repo.coordinate(baseline, () => repo.setSportsUniverseLibrary({...repo.getSportsUniverseLibrary(), activeUniverseId: "u-two"}));
    await expect(repo.coordinate(baseline, () => repo.save(t))).rejects.toThrow();
    const scoped = createScopedTournamentRepository(repo, "u-one", () => repo.getSportsUniverseLibrary());
    await expect(repo.coordinate(repo.snapshot(), () => scoped.save(t))).rejects.toThrow(/universo activo/);
  });

  it("keeps related tournaments and activity together and compensates an error", async () => {
    const repo = new LocalStorageTournamentRepository(true), before = repo.snapshot(), ts = repo.findAll();
    await expect(repo.coordinate(before, () => { repo.save({...ts[0], name: "Parcial"}); repo.save({...ts[1], name: "Parcial dos"}); throw new Error("fallo final"); })).rejects.toThrow("fallo final");
    expect(repo.snapshot()).toBe(before);
    await repo.coordinate(before, () => repo.save({...ts[0], name: "Disponible de nuevo"}));
  });

  it("quota failure restores results and activity, then releases the lock", async () => {
    const repo = new LocalStorageTournamentRepository(true), before = repo.snapshot(), t = repo.findAll()[0];
    const original = Storage.prototype.setItem;
    let fail = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key, value) {
      if (key === "cancha.activity" && fail) { fail = false; throw new DOMException("Cuota", "QuotaExceededError"); }
      original.call(this, key, value);
    });
    await expect(repo.coordinate(before, () => updateMatchResult(t, t.matchdays[0].fixtures[0].id, {homeGoals: 5, awayGoals: 1}, repo))).rejects.toThrow();
    expect(repo.snapshot()).toBe(before);
    await repo.coordinate(before, () => repo.save(t));
  });

  it("reports incomplete compensation instead of claiming an atomic restore", async () => {
    const repo = new LocalStorageTournamentRepository(true), baseline = repo.snapshot();
    const original = Storage.prototype.setItem;
    await expect(repo.coordinate(baseline, () => { original.call(localStorage, "cancha.tournaments", "[]"); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disco"); }); throw new Error("escritura"); })).rejects.toThrow(/no se pudo recuperar completamente/);
  });

  it("compensates a storage failure even when an inner UI handler catches it", async () => {
    const repo = new LocalStorageTournamentRepository(), before = repo.snapshot(), ts = repo.findAll();
    const original = Storage.prototype.setItem;
    await expect(repo.coordinate(before, () => {
      repo.save({...ts[0], name: "Primer cambio"});
      let once = true;
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key, value) {
        if (key === "cancha.tournaments" && once) { once = false; throw new DOMException("Cuota", "QuotaExceededError"); }
        original.call(this, key, value);
      });
      try { repo.save({...ts[1], name: "Segundo cambio"}); } catch { /* Existing presentation error handling. */ }
    })).rejects.toThrow(/almacenamiento.*lleno/);
    expect(repo.snapshot()).toBe(before);
  });

  it("guards every public sporting mutation outside a lease", () => {
    const repo = new LocalStorageTournamentRepository(true), t = repo.findAll()[0], event = repo.findActivity()[0], before = repo.snapshot();
    const mutations = [() => repo.save(t), () => repo.saveWithActivity(t, event), () => repo.saveManyWithActivity([t], event), () => repo.recordActivity(event), () => repo.deleteById(t.id), () => repo.importTournaments([t], "replace"), () => repo.restoreRecoverySnapshot(), () => repo.setSportsUniverseLibrary(repo.getSportsUniverseLibrary())];
    for (const mutate of mutations) expect(mutate).toThrow(/coordinada/);
    expect(repo.snapshot()).toBe(before);
    // Selection is only a UI preference.
    repo.setActiveTournamentId(t.id); expect(repo.snapshot()).toBe(before);
    expect(() => repo.commitUnderLibraryLock(before, () => repo.save(t))).toThrow(/bloqueo vigente/);
  });

  it("read migrations remain in memory until a coordinated command persists them", async () => {
    const legacy = checkpointLibrary().tournaments;
    const raw = JSON.stringify(legacy, null, 2);
    localStorage.setItem("cancha.tournaments", raw);
    const repo = new LocalStorageTournamentRepository();
    repo.findAllWithRecoveryReport();repo.getSportsUniverseLibrary();
    expect(localStorage.getItem("cancha.tournaments")).toBe(raw);
    await repo.coordinate(repo.snapshot(), () => { repo.findAll(); });
    expect(localStorage.getItem("cancha.tournaments")).not.toBe(raw);
  });

  it("rejects asynchronous sporting callbacks and revokes the synchronous repository lease", async () => {
    const repo = new LocalStorageTournamentRepository(), before = repo.snapshot(), t = repo.findAll()[0];
    const continuation = barrier();
    const command = async () => { repo.save({...t, name: "Parcial"}); await continuation.promise;repo.save(t); };
    await expect(repo.coordinate(before, command)).rejects.toThrow(/sincrónicamente/);
    expect(repo.snapshot()).toBe(before);continuation.release();
    await repo.coordinate(before, () => repo.save(t));
  });

  it("blocks risky operations without Web Locks while retaining export reads", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    const repo = new LocalStorageTournamentRepository(true), before = repo.snapshot(), action = vi.fn();
    await expect(repo.coordinate(before, action)).rejects.toThrow(/Web Locks/);
    await expect(new IndexedDbSaveCheckpointStore().exclusive(async () => {}, true)).rejects.toThrow();
    expect(action).not.toHaveBeenCalled(); expect(repo.findAll()).toHaveLength(3); expect(repo.snapshot()).toBe(before);
  });

  it("checkpoint work and sports use the same lock and expired leases cannot be reused", async () => {
    expect(libraryWriteLockName).toBe("cancha.save-checkpoints");
    const repo = new LocalStorageTournamentRepository(true), store = new IndexedDbSaveCheckpointStore();
    const entered = barrier(), release = barrier(); let expired: Parameters<typeof repo.commitUnderLibraryLock>[2];
    const checkpoint = store.exclusive(async lease => { expired = lease; entered.release(); await release.promise; });
    await entered.promise;
    const action = vi.fn(), sports = repo.coordinate(repo.snapshot(), action);
    expect(action).not.toHaveBeenCalled(); release.release(); await checkpoint; await sports;
    expect(action).toHaveBeenCalledOnce();
    expect(() => repo.commitUnderLibraryLock(repo.snapshot(), action, expired)).toThrow(/bloqueo vigente/);
  });

  it("propagates command errors after the native grant callback resolves and releases its lease", async () => {
    const error = new Error("Revisión obsoleta"), observed: unknown[] = [];
    Object.defineProperty(navigator, "locks", {configurable: true, value: {
      request: async (_name: string, _options: unknown, grant: () => Promise<unknown>) => {
        // A rejection here would escape through Firefox's native callback path.
        const outcome = await grant();observed.push(outcome);return outcome;
      },
    }});
    await expect(withLibraryWriteLock(() => { throw error; })).rejects.toBe(error);
    expect(observed).toEqual([{ok: false, error}]);
  });
});
