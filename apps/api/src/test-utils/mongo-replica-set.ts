import { MongoClient, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";

/**
 * mongod real en modo replica set de un nodo (transacciones reales), sin Docker.
 * La versión del binario se fija en config.mongodbMemoryServer.version de
 * apps/api/package.json (igual a la imagen de docker-compose.yml); se descarga
 * una vez a node_modules/.cache/mongodb-memory-server.
 */
export interface TestReplicaSet {
  readonly uri: string;
  readonly client: MongoClient;
  /** Base de datos nueva y aislada para una prueba. */
  freshDatabase(): Db;
  stop(): Promise<void>;
}

let databaseCounter = 0;

export async function startTestReplicaSet(): Promise<TestReplicaSet> {
  const replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  const uri = replicaSet.getUri();
  const client = new MongoClient(uri);
  await client.connect();
  return {
    uri,
    client,
    freshDatabase: () => client.db(`test_${process.pid}_${Date.now()}_${databaseCounter++}`),
    stop: async () => {
      await client.close();
      await replicaSet.stop();
    },
  };
}

/** Primer arranque: descarga del binario (~80 MB) e inicio del replica set. */
export const replicaSetStartupTimeoutMs = 300_000;
