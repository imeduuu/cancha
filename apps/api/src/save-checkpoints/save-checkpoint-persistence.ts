import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import type { Db, MongoClient } from "mongodb";
import { MONGO_CLIENT, MONGO_DATABASE } from "../database/database.tokens.js";
import { MongoSaveCheckpointStore } from "./mongo-save-checkpoint-store.js";

/** Crea el almacén de puntos de guardado de `userId`. */
export type SaveCheckpointStoreFactory = (userId: string) => MongoSaveCheckpointStore;
export const SAVE_CHECKPOINT_STORE_FACTORY = Symbol("SAVE_CHECKPOINT_STORE_FACTORY");

export const saveCheckpointStoreFactoryProvider = {
  provide: SAVE_CHECKPOINT_STORE_FACTORY,
  inject: [MONGO_CLIENT, MONGO_DATABASE],
  useFactory: (client: MongoClient, database: Db): SaveCheckpointStoreFactory =>
    userId => new MongoSaveCheckpointStore(client, database, userId),
};

@Injectable()
export class SaveCheckpointIndexes implements OnApplicationBootstrap {
  private readonly logger = new Logger("SaveCheckpointIndexes");

  constructor(@Inject(MONGO_DATABASE) private readonly database: Db) {}

  /** No bloquea el arranque; el índice sólo acelera el listado (no garantiza unicidad). */
  onApplicationBootstrap(): void {
    MongoSaveCheckpointStore.ensureIndexes(this.database).catch((error: unknown) => {
      this.logger.warn(`No se pudieron crear los índices de puntos de guardado: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}
