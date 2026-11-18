import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from "@nestjs/common";
import type { Db, MongoClient } from "mongodb";
import { MONGO_CLIENT, MONGO_DATABASE } from "../../database/database.tokens.js";
import { MongoTournamentRepository } from "./mongo-tournament-repository.js";

/**
 * Crea un repositorio nuevo acotado a la biblioteca de `userId`: cada instancia
 * es una unidad de trabajo con sus versiones leídas.
 */
export type TournamentRepositoryFactory = (userId: string) => MongoTournamentRepository;
export const TOURNAMENT_REPOSITORY_FACTORY = Symbol("TOURNAMENT_REPOSITORY_FACTORY");

@Injectable()
class TournamentIndexes implements OnApplicationBootstrap {
  private readonly logger = new Logger("TournamentIndexes");

  constructor(@Inject(MONGO_DATABASE) private readonly database: Db) {}

  /** No bloquea el arranque: si Mongo no responde, la API inicia y /health lo informa. */
  onApplicationBootstrap(): void {
    MongoTournamentRepository.ensureIndexes(this.database).catch((error: unknown) => {
      this.logger.warn(`No se pudieron crear los índices de torneos: ${error instanceof Error ? error.message : String(error)}`);
    });
    MongoTournamentRepository.countLegacyDocuments(this.database).then(count => {
      if (count > 0) {
        this.logger.warn(
          `La base contiene ${count} documento(s) de la biblioteca global anterior a la fase 4B: ningún usuario los ve. `
          + "Exporta lo que necesites con una versión anterior y vacía la base con `npm run db:reset` (ver README, MongoDB).",
        );
      }
    }).catch(() => undefined);
  }
}

@Module({
  providers: [
    {
      provide: TOURNAMENT_REPOSITORY_FACTORY,
      inject: [MONGO_CLIENT, MONGO_DATABASE],
      useFactory: (client: MongoClient, database: Db): TournamentRepositoryFactory =>
        userId => new MongoTournamentRepository(client, database, userId),
    },
    TournamentIndexes,
  ],
  exports: [TOURNAMENT_REPOSITORY_FACTORY],
})
export class TournamentPersistenceModule {}
