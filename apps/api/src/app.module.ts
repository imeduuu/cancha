import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module.js";
import { validateEnvironment } from "./config/env.validation.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { TournamentPersistenceModule } from "./infrastructure/persistence/tournament-persistence.module.js";
import { ApiGraphqlModule } from "./graphql/graphql.module.js";
import { LibraryModule } from "./library/library.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // .env junto a apps/api (npm -w ejecuta con ese directorio de trabajo).
      envFilePath: ".env",
      validate: validateEnvironment,
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    TournamentPersistenceModule,
    LibraryModule,
    ApiGraphqlModule,
  ],
})
export class AppModule {}
