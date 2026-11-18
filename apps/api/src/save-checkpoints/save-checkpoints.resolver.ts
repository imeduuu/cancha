import type { SaveCheckpointSummary } from "@cancha/core/application/ports/async-save-checkpoint-store";
import { Inject } from "@nestjs/common";
import { Args, Field, ID, Int, Mutation, ObjectType, Query, Resolver } from "@nestjs/graphql";
import { CurrentUser } from "../auth/auth.guard.js";
import type { SessionUser } from "../auth/auth.service.js";
import { JsonScalar } from "../graphql/json.scalar.js";
import { RestoreResultModel } from "../graphql/models.js";
import { SaveCheckpointsService } from "./save-checkpoints.service.js";

@ObjectType("SaveCheckpoint", { description: "Punto de guardado: copia completa de la biblioteca (respaldo JSON v7)." })
export class SaveCheckpointModel {
  @Field(() => ID) id!: string;
  @Field(() => String) name!: string;
  @Field(() => String) description!: string;
  @Field(() => String, { description: "Fecha ISO 8601 en que se capturó la biblioteca." }) createdAt!: string;
  @Field(() => String) updatedAt!: string;
  @Field(() => Int) tournamentCount!: number;
  @Field(() => Int) activityCount!: number;
  @Field(() => Int, { description: "Tamaño del respaldo en bytes." }) sizeBytes!: number;
  @Field(() => Int, { description: "Versión para compare-and-set: envíala como expectedVersion." }) version!: number;
}

@ObjectType("SaveCheckpointPreview")
export class SaveCheckpointPreviewModel {
  @Field(() => SaveCheckpointModel) checkpoint!: SaveCheckpointModel;
  @Field(() => JsonScalar, { description: "Diferencias con la biblioteca actual (CheckpointComparison de @cancha/core)." })
  comparison!: unknown;
  @Field(() => Int, { description: "Versión de la biblioteca comparada: envíala como expectedLibraryVersion al restaurar." })
  libraryVersion!: number;
}

function toModel(summary: SaveCheckpointSummary): SaveCheckpointModel {
  return {
    id: summary.id,
    name: summary.name,
    description: summary.description,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    tournamentCount: summary.tournamentCount,
    activityCount: summary.activityCount,
    sizeBytes: summary.sizeBytes,
    version: summary.version,
  };
}

/** Puntos de guardado del usuario de la sesión. */
@Resolver()
export class SaveCheckpointsResolver {
  constructor(@Inject(SaveCheckpointsService) private readonly checkpoints: SaveCheckpointsService) {}

  @Query(() => [SaveCheckpointModel], { description: "Puntos de guardado, lo más reciente primero." })
  async saveCheckpoints(@CurrentUser() user: SessionUser): Promise<SaveCheckpointModel[]> {
    return (await this.checkpoints.list(user.id)).map(toModel);
  }

  @Query(() => SaveCheckpointPreviewModel, {
    description: "Verifica el punto y lo compara con la biblioteca actual antes de restaurarlo.",
  })
  async saveCheckpointPreview(
    @CurrentUser() user: SessionUser,
    @Args("id", { type: () => ID }) id: string,
  ): Promise<SaveCheckpointPreviewModel> {
    const preview = await this.checkpoints.preview(user.id, id);
    return { ...preview, checkpoint: toModel(preview.checkpoint) };
  }

  @Query(() => JsonScalar, { description: "Respaldo `cancha-backup` v7 del punto, verificado (para descargarlo)." })
  async saveCheckpointContent(
    @CurrentUser() user: SessionUser,
    @Args("id", { type: () => ID }) id: string,
  ): Promise<unknown> {
    return this.checkpoints.content(user.id, id);
  }

  @Mutation(() => SaveCheckpointModel, { description: "Guarda una copia completa de la biblioteca actual." })
  async createSaveCheckpoint(
    @CurrentUser() user: SessionUser,
    @Args("name", { type: () => String }) name: string,
    @Args("description", { type: () => String, nullable: true }) description?: string,
  ): Promise<SaveCheckpointModel> {
    return toModel(await this.checkpoints.create(user.id, name, description ?? ""));
  }

  @Mutation(() => RestoreResultModel, {
    description: "Reemplaza la biblioteca y el historial por los del punto. Exige la versión del punto y la de la "
      + "biblioteca que mostró saveCheckpointPreview; si cualquiera cambió, CONFLICT sin escribir nada.",
  })
  async restoreSaveCheckpoint(
    @CurrentUser() user: SessionUser,
    @Args("id", { type: () => ID }) id: string,
    @Args("expectedVersion", { type: () => Int }) expectedVersion: number,
    @Args("expectedLibraryVersion", { type: () => Int }) expectedLibraryVersion: number,
  ): Promise<RestoreResultModel> {
    return this.checkpoints.restore(user.id, id, expectedVersion, expectedLibraryVersion);
  }

  @Mutation(() => Boolean)
  async deleteSaveCheckpoint(
    @CurrentUser() user: SessionUser,
    @Args("id", { type: () => ID }) id: string,
    @Args("expectedVersion", { type: () => Int }) expectedVersion: number,
  ): Promise<boolean> {
    await this.checkpoints.delete(user.id, id, expectedVersion);
    return true;
  }
}
