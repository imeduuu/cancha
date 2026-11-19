// API compilada (dist/) sobre un MongoDB en memoria (replica set de un nodo), para
// los e2e de la web con sesión (`npm run test:e2e:session`). No usa Docker ni toca
// la base de desarrollo: los datos desaparecen al terminar.
import { fileURLToPath } from "node:url";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";

// mongodb-memory-server lee la versión del binario de config.mongodbMemoryServer
// del package.json del directorio de trabajo: el de apps/api (igual que en sus pruebas).
process.chdir(fileURLToPath(new URL("..", import.meta.url)));

const replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
process.env.MONGODB_URI = replicaSet.getUri();
process.env.MONGODB_DB ??= "cancha_e2e_session";

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await replicaSet.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await import("../dist/main.js");
