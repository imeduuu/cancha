import { Field, ID, InputType, Int, ObjectType, registerEnumType } from "@nestjs/graphql";
import { JsonScalar } from "./json.scalar.js";

// Code-first: cada @Field/@Args declara su tipo con una función explícita porque
// Vitest (oxc) no emite los metadatos de decoradores que Nest usaría para inferirlo.

export enum SimulationModeInput {
  PENDING_ONLY = "pendingOnly",
  OVERWRITE = "overwrite",
}
registerEnumType(SimulationModeInput, {
  name: "SimulationMode",
  description: "PENDING_ONLY simula sólo partidos sin resultado; OVERWRITE reemplaza también los existentes.",
});

export enum DuplicateModeInput {
  COPY = "copy",
  RESET = "reset",
}
registerEnumType(DuplicateModeInput, {
  name: "DuplicateMode",
  description: "COPY conserva los resultados; RESET los reinicia.",
});

export enum ImportDecisionInput {
  ADD = "add",
  COPY = "copy",
  UPDATE = "update",
}
registerEnumType(ImportDecisionInput, {
  name: "ImportDecision",
  description: "ADD agrega un torneo nuevo; COPY lo importa con ids nuevos; UPDATE reemplaza el torneo con el mismo id.",
});

export enum RestoreModeInput {
  MERGE = "merge",
  REPLACE = "replace",
}
registerEnumType(RestoreModeInput, {
  name: "RestoreMode",
  description: "MERGE agrega los torneos cuyo id no existe; REPLACE reemplaza la biblioteca y el historial completos.",
});

@ObjectType("RestoreResult")
export class RestoreResultModel {
  @Field(() => Int) added!: number;
  @Field(() => Int) skipped!: number;
  @Field(() => Int) libraryVersion!: number;
}

@ObjectType({ description: "Marcador de un tramo del partido." })
export class MatchScoreModel {
  @Field(() => Int) homeGoals!: number;
  @Field(() => Int) awayGoals!: number;
}

@ObjectType("MatchResult")
export class MatchResultModel {
  @Field(() => Int) homeGoals!: number;
  @Field(() => Int) awayGoals!: number;
  @Field(() => MatchScoreModel, { nullable: true }) extraTime?: MatchScoreModel;
  @Field(() => MatchScoreModel, { nullable: true }) penalties?: MatchScoreModel;
}

@ObjectType("Fixture")
export class FixtureModel {
  @Field(() => ID) id!: string;
  @Field(() => ID) homeTeamId!: string;
  @Field(() => String) homeTeamName!: string;
  @Field(() => ID) awayTeamId!: string;
  @Field(() => String) awayTeamName!: string;
  @Field(() => MatchResultModel, { nullable: true }) result?: MatchResultModel;
}

@ObjectType("Matchday")
export class MatchdayModel {
  @Field(() => Int, { description: "Posición en el calendario (la usa simulateMatchday)." }) index!: number;
  @Field(() => Int) number!: number;
  @Field(() => Int) leg!: number;
  @Field(() => String, { nullable: true }) phaseName?: string;
  @Field(() => [FixtureModel]) fixtures!: FixtureModel[];
}

@ObjectType("Standing")
export class StandingModel {
  @Field(() => Int) position!: number;
  @Field(() => ID) teamId!: string;
  @Field(() => String) teamName!: string;
  @Field(() => Int) played!: number;
  @Field(() => Int) wins!: number;
  @Field(() => Int) draws!: number;
  @Field(() => Int) losses!: number;
  @Field(() => Int) goalsFor!: number;
  @Field(() => Int) goalsAgainst!: number;
  @Field(() => Int) goalDifference!: number;
  @Field(() => Int) points!: number;
}

@ObjectType("TournamentSummary", { description: "Fila del listado de la biblioteca." })
export class TournamentSummaryModel {
  @Field(() => ID) id!: string;
  @Field(() => String) name!: string;
  @Field(() => Int, { description: "Versión para concurrencia optimista: envíala como expectedVersion." }) version!: number;
  @Field(() => String, { nullable: true }) competitionId?: string;
  @Field(() => Int, { nullable: true }) season?: number;
  @Field(() => String, { nullable: true }) format?: string;
  @Field(() => Boolean) archived!: boolean;
  @Field(() => Int) teamCount!: number;
  @Field(() => Int) playedMatches!: number;
  @Field(() => Int) totalMatches!: number;
  @Field(() => String, { description: "Finalizado, En curso, Incompleto o Indeterminado." }) status!: string;
}

@ObjectType("Tournament")
export class TournamentModel extends TournamentSummaryModel {
  @Field(() => [MatchdayModel]) matchdays!: MatchdayModel[];
  @Field(() => [StandingModel], { description: "Tabla general calculada por core con los desempates configurados." })
  standings!: StandingModel[];
  @Field(() => Int, { description: "Empates en la tabla que los criterios configurados no resuelven." })
  unresolvedTies!: number;
  @Field(() => JsonScalar, { description: "Documento completo del torneo (tipo Tournament de @cancha/core)." })
  document!: unknown;
}

@ObjectType("ActivityEvent")
export class ActivityEventModel {
  @Field(() => ID) id!: string;
  @Field(() => String) occurredAt!: string;
  @Field(() => String) action!: string;
  @Field(() => ID) tournamentId!: string;
  @Field(() => String) tournamentName!: string;
  @Field(() => Int, { nullable: true }) season?: number;
  @Field(() => String, { nullable: true }) entityType?: string;
  @Field(() => String, { nullable: true }) entityId?: string;
  @Field(() => String) summary!: string;
  @Field(() => String, { nullable: true }) note?: string;
  @Field(() => String, { nullable: true }) outcome?: string;
  @Field(() => Boolean) imported!: boolean;
  @Field(() => JsonScalar, { nullable: true }) before?: unknown;
  @Field(() => JsonScalar, { nullable: true }) after?: unknown;
}

@ObjectType("LibraryInfo")
export class LibraryInfoModel {
  @Field(() => Int, { description: "Versión de la biblioteca: sube con cada escritura." }) libraryVersion!: number;
  @Field(() => ID, { nullable: true }) activeTournamentId!: string | null;
}

@ObjectType("SimulationResult")
export class SimulationResultModel {
  @Field(() => Int) simulatedCount!: number;
  @Field(() => TournamentModel) tournament!: TournamentModel;
}

@InputType()
export class PointsSystemInput {
  @Field(() => Int) win!: number;
  @Field(() => Int) draw!: number;
  @Field(() => Int) loss!: number;
}

@InputType()
export class CreateTournamentInput {
  @Field(() => String) name!: string;
  @Field(() => [String]) teamNames!: string[];
  @Field(() => Int) legs!: number;
  @Field(() => [String], { description: "Criterios de desempate de core (p. ej. goalDifference, goalsFor, wins)." })
  tieBreakers!: string[];
  @Field(() => PointsSystemInput, { nullable: true }) pointsSystem?: PointsSystemInput;
}

@InputType()
export class MatchScoreInput {
  @Field(() => Int) homeGoals!: number;
  @Field(() => Int) awayGoals!: number;
}

@InputType()
export class MatchResultInput {
  @Field(() => Int) homeGoals!: number;
  @Field(() => Int) awayGoals!: number;
  @Field(() => MatchScoreInput, { nullable: true }) extraTime?: MatchScoreInput;
  @Field(() => MatchScoreInput, { nullable: true }) penalties?: MatchScoreInput;
}
