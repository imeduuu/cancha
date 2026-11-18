import { MongoClient, type Db } from "mongodb";
import { inject } from "vitest";

/**
 * Conexión al replica set compartido que arranca `mongo-global-setup.ts`
 * (mongod real de mongodb-memory-server, sin Docker).
 */
export interface TestReplicaSet {
  readonly uri: string;
  readonly client: MongoClient;
  /** Base de datos nueva y aislada para una prueba. */
  freshDatabase(): Db;
  /** Cierra la conexión de este archivo (el replica set lo detiene el globalSetup). */
  stop(): Promise<void>;
}

let databaseCounter = 0;

export async function startTestReplicaSet(): Promise<TestReplicaSet> {
  const uri = inject("mongoReplicaSetUri");
  const client = new MongoClient(uri);
  await client.connect();
  return {
    uri,
    client,
    freshDatabase: () => client.db(`test_${process.pid}_${Date.now()}_${databaseCounter++}`),
    stop: () => client.close(),
  };
}

/** Conectar puede tardar si la máquina está cargada. */
export const replicaSetStartupTimeoutMs = 60_000;
