import { describeTournamentRepositoryContract } from "@cancha/core/test-utils/tournament-repository-contract";
import type { Db } from "mongodb";
import { afterAll, beforeAll } from "vitest";
import { replicaSetStartupTimeoutMs, startTestReplicaSet, type TestReplicaSet } from "../../test-utils/mongo-replica-set.js";
import { MongoTournamentRepository } from "./mongo-tournament-repository.js";

// Un replica set real (transacciones) para todo el archivo y una base nueva por caso.
let replicaSet: TestReplicaSet;
let database: Db;

beforeAll(async () => { replicaSet = await startTestReplicaSet(); }, replicaSetStartupTimeoutMs);
afterAll(async () => { await replicaSet?.stop(); });

describeTournamentRepositoryContract("MongoTournamentRepository", {
  create: async () => {
    database = replicaSet.freshDatabase();
    await MongoTournamentRepository.ensureIndexes(database);
    return new MongoTournamentRepository(replicaSet.client, database);
  },
  reopen: () => new MongoTournamentRepository(replicaSet.client, database),
});
