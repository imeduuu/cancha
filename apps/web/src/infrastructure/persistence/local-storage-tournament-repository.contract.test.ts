import { describeTournamentRepositoryContract } from "@cancha/core/test-utils/tournament-repository-contract";
import { LocalStorageTournamentRepository } from "./local-storage-tournament-repository";

// localStorage en memoria (mismo patrón que local-storage-tournament-repository.test.ts).
// Sin exigir el lease de escritura: es coordinación entre pestañas del navegador,
// no parte del contrato del repositorio (lo prueban library-write-coordination.test.ts).
let storedValues = new Map<string, string>();

function installMemoryStorage(): void {
  storedValues = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storedValues.get(key) ?? null,
      setItem: (key: string, value: string) => { storedValues.set(key, String(value)); },
      removeItem: (key: string) => { storedValues.delete(key); },
    },
  });
}

describeTournamentRepositoryContract("LocalStorageTournamentRepository", {
  create: () => {
    installMemoryStorage();
    return new LocalStorageTournamentRepository(false);
  },
  reopen: () => new LocalStorageTournamentRepository(false),
});
