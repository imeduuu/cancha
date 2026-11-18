import { describeTournamentRepositoryContract, contractTournament } from "@cancha/core/test-utils/tournament-repository-contract";
import { createActivityEvent } from "@cancha/core/application/services/activity-log";
import type { Db } from "mongodb";
import { afterAll, beforeAll } from "vitest";
import { replicaSetStartupTimeoutMs, startTestReplicaSet, type TestReplicaSet } from "../../test-utils/mongo-replica-set.js";
import { MongoTournamentRepository } from "./mongo-tournament-repository.js";

// Un replica set real (transacciones) para todo el archivo y una base nueva por caso.
let replicaSet: TestReplicaSet;
let database: Db;

beforeAll(async () => { replicaSet = await startTestReplicaSet(); }, replicaSetStartupTimeoutMs);
afterAll(async () => { await replicaSet?.stop(); });

const owner = "user-a";

/**
 * Otro usuario con datos en la misma base, con ids que suelen usar las pruebas
 * del contrato: si algo de su biblioteca se filtrara a la de `owner` (lecturas,
 * versión de biblioteca, torneo activo, eventos deduplicados), el contrato fallaría.
 */
async function seedOtherUser(db: Db): Promise<void> {
  const other = new MongoTournamentRepository(replicaSet.client, db, "user-b");
  const tournaments = ["contrato-a", "contrato-b", "contrato-c", "ajeno"].map(id => contractTournament(id, `Ajeno ${id}`));
  await other.saveManyWithActivity(tournaments, createActivityEvent(tournaments[0], {
    action: "regulations-updated", entityType: "tournament", summary: "Evento de otro usuario.",
  }));
  await other.setActiveTournamentId("contrato-a");
}

describeTournamentRepositoryContract("MongoTournamentRepository (acotado a un usuario)", {
  create: async () => {
    database = replicaSet.freshDatabase();
    await MongoTournamentRepository.ensureIndexes(database);
    await seedOtherUser(database);
    return new MongoTournamentRepository(replicaSet.client, database, owner);
  },
  reopen: () => new MongoTournamentRepository(replicaSet.client, database, owner),
});
