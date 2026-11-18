import { Module } from "@nestjs/common";
import { TournamentPersistenceModule } from "../infrastructure/persistence/tournament-persistence.module.js";
import { LibraryUnitOfWork } from "./library-unit-of-work.js";

/** Casos de uso de core sobre la biblioteca en Mongo, mediante la unidad de trabajo. */
@Module({
  imports: [TournamentPersistenceModule],
  providers: [LibraryUnitOfWork],
  exports: [LibraryUnitOfWork],
})
export class LibraryModule {}
