import { Inject, UseGuards } from "@nestjs/common";
import { Args, Field, ID, Int, Mutation, ObjectType, Query, Resolver } from "@nestjs/graphql";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser, Public } from "../auth/auth.guard.js";
import type { SessionUser } from "../auth/auth.service.js";
import { GqlThrottlerGuard } from "../auth/gql-throttler.guard.js";
import { MatchdayModel, StandingModel } from "../graphql/models.js";
import { TournamentSharesService } from "./tournament-shares.service.js";

@ObjectType("PublicTournament", { description: "Datos deportivos públicos de un torneo compartido." })
class PublicTournamentModel {
  @Field(() => String) name!: string;
  @Field(() => Int, { nullable: true }) season?: number;
  @Field(() => [StandingModel]) standings!: StandingModel[];
  @Field(() => [MatchdayModel]) matchdays!: MatchdayModel[];
}

@Resolver()
export class TournamentSharesResolver {
  constructor(@Inject(TournamentSharesService) private readonly shares: TournamentSharesService) {}

  @Mutation(() => String, { description: "Crea un enlace público de solo lectura para un torneo." })
  async createTournamentShare(@CurrentUser() user: SessionUser, @Args("tournamentId", { type: () => ID }) id: string): Promise<string> {
    return (await this.shares.create(user.id, id)).token;
  }

  @Mutation(() => Boolean, { description: "Revoca un enlace público de torneo." })
  async revokeTournamentShare(@CurrentUser() user: SessionUser, @Args("token", { type: () => String }) token: string): Promise<boolean> {
    return this.shares.revoke(user.id, token);
  }

  @Mutation(() => Boolean, { description: "Revoca todos los enlaces públicos de un torneo." })
  async revokeTournamentShares(@CurrentUser() user: SessionUser, @Args("tournamentId", { type: () => ID }) id: string): Promise<boolean> {
    return this.shares.revokeForTournament(user.id, id);
  }

  @Public()
  @UseGuards(GqlThrottlerGuard)
  @Throttle({ auth: { limit: 30, ttl: 60_000 } })
  @Query(() => PublicTournamentModel, { nullable: true, description: "Consulta pública de un torneo compartido." })
  async publicTournament(@Args("token", { type: () => String }) token: string): Promise<unknown | null> {
    return this.shares.read(token);
  }
}
