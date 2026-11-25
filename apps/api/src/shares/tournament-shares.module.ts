import { Module } from "@nestjs/common";
import { LibraryModule } from "../library/library.module.js";
import { TournamentSharesResolver } from "./tournament-shares.resolver.js";
import { TournamentSharesService } from "./tournament-shares.service.js";

@Module({ imports: [LibraryModule], providers: [TournamentSharesService, TournamentSharesResolver] })
export class TournamentSharesModule {}
