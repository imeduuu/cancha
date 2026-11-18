import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    mongoReplicaSetUri: string;
  }
}

/**
 * Un único mongod real en modo replica set (transacciones reales) para toda la
 * corrida de `npm test -w @cancha/api`; cada prueba usa una base propia.
 * La versión del binario se fija en config.mongodbMemoryServer.version de
 * apps/api/package.json (igual a la imagen de docker-compose.yml) y se descarga
 * una vez a ~/.cache/mongodb-binaries.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  project.provide("mongoReplicaSetUri", replicaSet.getUri());
  return async () => { await replicaSet.stop(); };
}
