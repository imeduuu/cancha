// Keep the historical checkpoint lock name so both protocols coordinate.
export const libraryWriteLockName = "cancha.save-checkpoints";

import type { LibraryWriteLease } from "@cancha/core/application/ports/library-write-lease";

const activeLeases = new WeakSet<object>();
export function assertLibraryWriteLease(lease?: LibraryWriteLease): void {
  if (!lease || !activeLeases.has(lease)) throw new Error("La escritura requiere el bloqueo vigente de la biblioteca.");
}

export async function withLibraryWriteLock<T>(action: (lease: LibraryWriteLease) => T | Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks) throw new Error("Este navegador no permite coordinar escrituras entre pestañas. Usa un navegador con Web Locks. Puedes descargar un respaldo JSON.");
  const outcome = await locks.request(libraryWriteLockName, { mode: "exclusive" }, async () => {
    const lease = {} as LibraryWriteLease;
    activeLeases.add(lease);
    // Keep expected command failures out of the native grant callback. The
    // installed Firefox reports its rejection as pageerror even when request()
    // is caught. Propagate the same error to our caller after releasing the lock.
    try { return {ok: true as const, value: await action(lease)}; }
    catch (error) { return {ok: false as const, error}; }
    finally { activeLeases.delete(lease); }
  });
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

export const sportingStorageKeys = ["cancha.tournaments", "cancha.activity", "cancha.sportsUniverses", "cancha.recovery"] as const;

export function libraryStorageSnapshot(): string {
  return JSON.stringify(sportingStorageKeys.map(key => localStorage.getItem(key)));
}
