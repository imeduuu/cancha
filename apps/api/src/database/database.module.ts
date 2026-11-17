import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MongoClient, type Db } from "mongodb";
import type { ApiEnvironment } from "../config/env.validation.js";
import { MONGO_CLIENT, MONGO_DATABASE } from "./database.tokens.js";

/**
 * El cliente no se conecta al construirse: el driver abre la conexión con la
 * primera operación. Así la API arranca aunque Mongo no esté disponible y
 * GET /health puede informarlo en vez de impedir el inicio.
 */
export function createMongoClient(uri: string): MongoClient {
  return new MongoClient(uri, {
    serverSelectionTimeoutMS: 5_000,
    appName: "cancha-api",
  });
}

@Injectable()
class MongoClientLifecycle implements OnApplicationShutdown {
  constructor(@Inject(MONGO_CLIENT) private readonly client: MongoClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: MONGO_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnvironment, true>) =>
        createMongoClient(config.get("MONGODB_URI", { infer: true })),
    },
    {
      provide: MONGO_DATABASE,
      inject: [MONGO_CLIENT, ConfigService],
      useFactory: (client: MongoClient, config: ConfigService<ApiEnvironment, true>): Db =>
        client.db(config.get("MONGODB_DB", { infer: true })),
    },
    MongoClientLifecycle,
  ],
  exports: [MONGO_CLIENT, MONGO_DATABASE],
})
export class DatabaseModule {}
