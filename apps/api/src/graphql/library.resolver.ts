import type { Tournament } from "@cancha/core/domain/entities/tournament";
import type { TieBreaker } from "@cancha/core/domain/value-objects/tie-breaker";
import type { KnockoutResolution } from "@cancha/core/domain/entities/tournament";
import type { TournamentLibraryRepository } from "@cancha/core/application/ports/tournament-repository";
import { createTournamentArchive, createTournamentBackup, parseTournamentArchive } from "@cancha/core/application/services/tournament-archive";
import { createTournament } from "@cancha/core/application/use-cases/create-tournament";
import { importTournamentArchive } from "@cancha/core/application/use-cases/import-tournament-archive";
import { duplicateTournament, renameTournament } from "@cancha/core/application/use-cases/manage-tournaments";
import { restoreTournamentBackup } from "@cancha/core/application/use-cases/restore-tournament-backup";
import { setTournamentArchived } from "@cancha/core/application/use-cases/set-tournament-archived";
import { simulateChampionship } from "@cancha/core/application/use-cases/simulate-championship";
import {
  simulateTournamentLeg,
  simulateTournamentMatchday,
} from "@cancha/core/application/use-cases/simulate-tournament-selection";
import { updateMatchResult } from "@cancha/core/application/use-cases/update-match-result";
import { Inject } from "@nestjs/common";
import { Args, ID, Int, Mutation, Query, Resolver } from "@nestjs/graphql";
import { CurrentUser } from "../auth/auth.guard.js";
import type { SessionUser } from "../auth/auth.service.js";
import { LibraryUnitOfWork, NotFoundError, type UnitOfWorkResult } from "../library/library-unit-of-work.js";
import {
  ActivityEventModel,
  CreateTournamentInput,
  DuplicateModeInput,
  ImportDecisionInput,
  LibraryInfoModel,
  MatchResultInput,
  RestoreModeInput,
  RestoreResultModel,
  SimulationModeInput,
  SimulationResultModel,
  TournamentModel,
  TournamentSummaryModel,
} from "./models.js";
import { JsonScalar } from "./json.scalar.js";
import { toActivityEventModel, toTournamentModel, toTournamentSummary } from "./tournament-mapper.js";

function findTournament(repository: TournamentLibraryRepository, id: string): Tournament {
  const tournament = repository.findAll().find(item => item.id === id);
  if (!tournament) throw new NotFoundError(`No se encontró el campeonato "${id}".`);
  return tournament;
}

/** Lo que devuelve un trabajo de la unidad de trabajo: su resultado y la actividad para proyectar. */
interface Outcome<T> {
  readonly value: T;
  readonly repository: TournamentLibraryRepository;
}

function versionOf(run: UnitOfWorkResult<unknown>, id: string): number {
  const version = run.versionOf(id);
  if (version === undefined) throw new NotFoundError(`No se encontró el campeonato "${id}".`);
  return version;
}

/**
 * Resolvers delgados: cada operación es un caso de uso de core ejecutado por la
 * unidad de trabajo, más la traducción a tipos GraphQL. Nada de lógica deportiva.
 * Todas operan sobre la biblioteca del usuario de la sesión (`@CurrentUser()`):
 * el esquema no tiene ningún argumento userId.
 */
@Resolver()
export class LibraryResolver {
  constructor(@Inject(LibraryUnitOfWork) private readonly unitOfWork: LibraryUnitOfWork) {}

  // ---------- Consultas ----------

  @Query(() => LibraryInfoModel, { description: "Versión de la biblioteca y torneo activo." })
  async library(@CurrentUser() user: SessionUser): Promise<LibraryInfoModel> {
    const run = await this.unitOfWork.read(user.id, repository => repository.getActiveTournamentId());
    return { libraryVersion: run.libraryVersion, activeTournamentId: run.result };
  }

  @Query(() => [TournamentSummaryModel], { description: "Listado resumido, lo último guardado primero." })
  async tournaments(
    @CurrentUser() user: SessionUser,
    @Args("includeArchived", { type: () => Boolean, defaultValue: true }) includeArchived: boolean,
  ): Promise<TournamentSummaryModel[]> {
    const run = await this.unitOfWork.read(user.id, repository => ({
      tournaments: repository.findAll().filter(tournament => includeArchived || !tournament.archived),
      activity: repository.findActivity?.() ?? [],
    }));
    return run.result.tournaments.map(tournament =>
      toTournamentSummary(tournament, versionOf(run, tournament.id), run.result.activity));
  }

  @Query(() => TournamentModel)
  async tournament(@CurrentUser() user: SessionUser, @Args("id", { type: () => ID }) id: string): Promise<TournamentModel> {
    const run = await this.unitOfWork.read(user.id, repository => ({ value: findTournament(repository, id), repository }));
    return this.toModel(run, run.result.value);
  }

  @Query(() => TournamentModel, { nullable: true, description: "El torneo activo, o null si no hay uno vigente." })
  async activeTournament(@CurrentUser() user: SessionUser): Promise<TournamentModel | null> {
    const run = await this.unitOfWork.read(user.id, repository => {
      const id = repository.getActiveTournamentId();
      return { value: repository.findAll().find(tournament => tournament.id === id) ?? null, repository };
    });
    return run.result.value ? this.toModel(run, run.result.value) : null;
  }

  @Query(() => [ActivityEventModel], { description: "Historial de actividad, lo más reciente primero." })
  async activity(
    @CurrentUser() user: SessionUser,
    @Args("tournamentId", { type: () => ID, nullable: true }) tournamentId?: string,
    @Args("limit", { type: () => Int, nullable: true }) limit?: number,
  ): Promise<ActivityEventModel[]> {
    const run = await this.unitOfWork.read(user.id, repository => repository.findActivity?.() ?? []);
    const events = run.result.filter(event => !tournamentId || event.tournamentId === tournamentId).reverse();
    return (limit === undefined || limit === null ? events : events.slice(0, Math.max(0, limit))).map(toActivityEventModel);
  }

  // ---------- Mutaciones ----------

  @Mutation(() => TournamentModel)
  async createTournament(
    @CurrentUser() user: SessionUser,
    @Args("input", { type: () => CreateTournamentInput }) input: CreateTournamentInput,
  ): Promise<TournamentModel> {
    return this.mutate(user.id, repository => createTournament({
      name: input.name,
      teamNames: input.teamNames,
      legs: input.legs,
      tieBreakers: input.tieBreakers as TieBreaker[],
      ...(input.pointsSystem ? { pointsSystem: { ...input.pointsSystem } } : {}),
    }, repository));
  }

  @Mutation(() => TournamentModel)
  async updateMatchResult(
    @CurrentUser() user: SessionUser,
    @Args("tournamentId", { type: () => ID }) tournamentId: string,
    @Args("expectedVersion", { type: () => Int }) expectedVersion: number,
    @Args("fixtureId", { type: () => ID }) fixtureId: string,
    @Args("result", { type: () => MatchResultInput }) result: MatchResultInput,
    @Args("knockoutResolution", { type: () => String, nullable: true }) knockoutResolution?: string,
  ): Promise<TournamentModel> {
    return this.mutate(user.id, repository => updateMatchResult(
      findTournament(repository, tournamentId),
      fixtureId,
      {
        homeGoals: result.homeGoals,
        awayGoals: result.awayGoals,
        ...(result.extraTime ? { extraTime: { ...result.extraTime } } : {}),
        ...(result.penalties ? { penalties: { ...result.penalties } } : {}),
      },
      repository,
      (knockoutResolution ?? undefined) as KnockoutResolution | undefined,
    ), { [tournamentId]: expectedVersion });
  }

  @Mutation(() => SimulationResultModel, { description: "Simula una jornada (por su `index` en matchdays)." })
  async simulateMatchday(
    @CurrentUser() user: SessionUser,
    @Args("tournamentId", { type: () => ID }) tournamentId: string,
    @Args("expectedVersion", { type: () => Int }) expectedVersion: number,
    @Args("matchdayIndex", { type: () => Int }) matchdayIndex: number,
    @Args("mode", { type: () => SimulationModeInput, defaultValue: SimulationModeInput.PENDING_ONLY }) mode: SimulationModeInput,
  ): Promise<SimulationResultModel> {
    return this.simulate(user.id, tournamentId, expectedVersion, (tournament, repository) =>
      simulateTournamentMatchday(tournament, matchdayIndex, mode, repository));
  }

  @Mutation(() => SimulationResultModel, { description: "Simula todos los partidos de una rueda." })
  async simulateLeg(
    @CurrentUser() user: SessionUser,
    @Args("tournamentId", { type: () => ID }) tournamentId: string,
    @Args("expectedVersion", { type: () => Int }) expectedVersion: number,
    @Args("leg", { type: () => Int }) leg: number,
    @Args("mode", { type: () => SimulationModeInput, defaultValue: SimulationModeInput.PENDING_ONLY }) mode: SimulationModeInput,
  ): Promise<SimulationResultModel> {
    return this.simulate(user.id, tournamentId, expectedVersion, (tournament, repository) =>
      simulateTournamentLeg(tournament, leg, mode, repository));
  }

  @Mutation(() => SimulationResultModel, { description: "Simula el campeonato completo, con sus etapas generadas." })
  async simulateChampionship(
    @CurrentUser() user: SessionUser,
    @Args("tournamentId", { type: () => ID }) tournamentId: string,
    @Args("expectedVersion", { type: () => Int }) expectedVersion: number,
    @Args("mode", { type: () => SimulationModeInput, defaultValue: SimulationModeInput.PENDING_ONLY }) mode: SimulationModeInput,
  ): Promise<SimulationResultModel> {
    return this.simulate(user.id, tournamentId, expectedVersion, (tournament, repository) =>
      simulateChampionship(tournament, mode, repository));
  }

  @Mutation(() => TournamentModel)
  async renameTournament(
    @CurrentUser() user: SessionUser,
    @Args("tournamentId", { type: () => ID }) tournamentId: string,
    @Args("expectedVersion", { type: () => Int }) expectedVersion: number,
    @Args("name", { type: () => String }) name: string,
  ): Promise<TournamentModel> {
    return this.mutate(user.id, repository => renameTournament(findTournament(repository, tournamentId), name, repository),
      { [tournamentId]: expectedVersion });
  }

  @Mutation(() => TournamentModel, { description: "Crea una copia independiente; devuelve el torneo nuevo." })
  async duplicateTournament(
    @CurrentUser() user: SessionUser,
    @Args("tournamentId", { type: () => ID }) tournamentId: string,
    @Args("expectedVersion", { type: () => Int }) expectedVersion: number,
    @Args("mode", { type: () => DuplicateModeInput }) mode: DuplicateModeInput,
  ): Promise<TournamentModel> {
    return this.mutate(user.id, repository => duplicateTournament(findTournament(repository, tournamentId), mode, repository),
      { [tournamentId]: expectedVersion });
  }

  @Mutation(() => TournamentModel)
  async setTournamentArchived(
    @CurrentUser() user: SessionUser,
    @Args("tournamentId", { type: () => ID }) tournamentId: string,
    @Args("expectedVersion", { type: () => Int }) expectedVersion: number,
    @Args("archived", { type: () => Boolean }) archived: boolean,
  ): Promise<TournamentModel> {
    return this.mutate(user.id, repository => setTournamentArchived(findTournament(repository, tournamentId), archived, repository),
      { [tournamentId]: expectedVersion });
  }

  @Mutation(() => Boolean, { description: "Elimina el torneo y registra tournament-deleted." })
  async deleteTournament(
    @CurrentUser() user: SessionUser,
    @Args("tournamentId", { type: () => ID }) tournamentId: string,
    @Args("expectedVersion", { type: () => Int }) expectedVersion: number,
  ): Promise<boolean> {
    await this.unitOfWork.run(user.id, repository => repository.deleteById(tournamentId), {
      expectedVersions: { [tournamentId]: expectedVersion },
    });
    return true;
  }

  @Mutation(() => LibraryInfoModel, { description: "Cambia el torneo activo (null lo deja sin torneo activo)." })
  async setActiveTournament(
    @CurrentUser() user: SessionUser,
    @Args("tournamentId", { type: () => ID, nullable: true }) tournamentId: string | null,
  ): Promise<LibraryInfoModel> {
    const id = tournamentId ?? null;
    const run = await this.unitOfWork.run(user.id, repository => {
      if (id !== null) findTournament(repository, id);
      repository.setActiveTournamentId(id);
    });
    return { libraryVersion: run.libraryVersion, activeTournamentId: id };
  }

  // ---------- JSON v7: importar, restaurar y exportar ----------

  @Query(() => JsonScalar, { description: "Archivo `cancha-tournament` v7 de un torneo." })
  async exportTournament(@CurrentUser() user: SessionUser, @Args("id", { type: () => ID }) id: string): Promise<unknown> {
    const run = await this.unitOfWork.read(user.id, repository => createTournamentArchive(findTournament(repository, id)));
    return run.result;
  }

  @Query(() => JsonScalar, { description: "Respaldo `cancha-backup` v7 de la biblioteca completa, con su historial." })
  async exportLibrary(@CurrentUser() user: SessionUser): Promise<unknown> {
    const run = await this.unitOfWork.read(user.id, repository =>
      createTournamentBackup(repository.findAll(), undefined, repository.findActivity?.() ?? []));
    return run.result;
  }

  @Mutation(() => TournamentModel, { description: "Importa un archivo `cancha-tournament` (texto JSON, v0 a v7)." })
  async importTournament(
    @CurrentUser() user: SessionUser,
    @Args("archive", { type: () => String }) archive: string,
    @Args("decision", { type: () => ImportDecisionInput }) decision: ImportDecisionInput,
  ): Promise<TournamentModel> {
    return this.mutate(user.id, repository => {
      const imported = importTournamentArchive(parseTournamentArchive(archive), decision, repository);
      if (!imported) throw new Error("No se importó el torneo.");
      return imported;
    });
  }

  @Mutation(() => RestoreResultModel, {
    description: "Restaura un respaldo `cancha-backup` (texto JSON, v0 a v7) sin importación parcial.",
  })
  async restoreBackup(
    @CurrentUser() user: SessionUser,
    @Args("backup", { type: () => String }) backup: string,
    @Args("mode", { type: () => RestoreModeInput }) mode: RestoreModeInput,
  ): Promise<RestoreResultModel> {
    const run = await this.unitOfWork.run(user.id, repository => restoreTournamentBackup(backup, mode, repository));
    return { ...run.result, libraryVersion: run.libraryVersion };
  }

  // ---------- Apoyo ----------

  private async mutate(
    userId: string,
    work: (repository: TournamentLibraryRepository) => Tournament,
    expectedVersions?: Record<string, number>,
  ): Promise<TournamentModel> {
    const run = await this.unitOfWork.run(userId, repository => ({ value: work(repository), repository }), { expectedVersions });
    return this.toModel(run, run.result.value);
  }

  private async simulate(
    userId: string,
    tournamentId: string,
    expectedVersion: number,
    work: (tournament: Tournament, repository: TournamentLibraryRepository) => { tournament: Tournament; simulatedCount: number },
  ): Promise<SimulationResultModel> {
    const run = await this.unitOfWork.run(
      userId,
      repository => ({ value: work(findTournament(repository, tournamentId), repository), repository }),
      { expectedVersions: { [tournamentId]: expectedVersion } },
    );
    return { simulatedCount: run.result.value.simulatedCount, tournament: this.toModel(run, run.result.value.tournament) };
  }

  private toModel(run: UnitOfWorkResult<Outcome<unknown>>, tournament: Tournament): TournamentModel {
    return toTournamentModel(tournament, versionOf(run, tournament.id), run.result.repository.findActivity?.() ?? []);
  }
}
