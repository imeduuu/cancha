import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { createActivityEvent, saveWithActivity } from "@cancha/core/application/services/activity-log";
import { createTournament } from "@cancha/core/application/use-cases/create-tournament";
import { importTournamentArchive } from "@cancha/core/application/use-cases/import-tournament-archive";
import { renameTournament } from "@cancha/core/application/use-cases/manage-tournaments";
import { simulateChampionship } from "@cancha/core/application/use-cases/simulate-championship";
import { updateMatchResult } from "@cancha/core/application/use-cases/update-match-result";
import { closureLeague } from "@cancha/core/test-utils/season-closure-fixtures";
import type { Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MongoTournamentRepository,
  TournamentVersionConflictError,
} from "../infrastructure/persistence/mongo-tournament-repository.js";
import { replicaSetStartupTimeoutMs, startTestReplicaSet, type TestReplicaSet } from "../test-utils/mongo-replica-set.js";
import { LibraryUnitOfWork, NotFoundError } from "./library-unit-of-work.js";

let replicaSet: TestReplicaSet;
let database: Db;

beforeAll(async () => { replicaSet = await startTestReplicaSet(); }, replicaSetStartupTimeoutMs);
afterAll(async () => { await replicaSet?.stop(); });
beforeEach(async () => {
  database = replicaSet.freshDatabase();
  await MongoTournamentRepository.ensureIndexes(database);
});

const open = () => new MongoTournamentRepository(replicaSet.client, database);
const unitOfWork = (factory: () => MongoTournamentRepository = open) => new LibraryUnitOfWork(factory);
const league = (id: string): Tournament => ({ ...closureLeague(id), name: `Liga ${id}` });
const event = (tournament: Tournament, summary: string) =>
  createActivityEvent(tournament, { action: "regulations-updated", entityType: "tournament", summary });
const find = (tournaments: readonly Tournament[], id: string) => tournaments.find(tournament => tournament.id === id)!;

/**
 * Fábrica cuyas primeras `parties` cargas esperan a que todas hayan leído: fuerza
 * que dos unidades de trabajo lean la misma versión antes de que alguna escriba.
 */
function barrierFactory(parties: number) {
  let loads = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const factory = () => {
    const repository = open();
    const load = repository.loadLibrary.bind(repository);
    repository.loadLibrary = async () => {
      const snapshot = await load();
      loads += 1;
      if (loads <= parties) {
        if (loads === parties) release();
        await gate;
      }
      return snapshot;
    };
    return repository;
  };
  return { factory, loads: () => loads };
}

describe("LibraryUnitOfWork contra MongoDB (replica set en memoria)", () => {
  it("dos unidades concurrentes sobre el mismo torneo: la segunda falla con conflicto y no escribe", async () => {
    await open().save(league("a"));
    const { factory } = barrierFactory(2);
    const rename = (name: string) => unitOfWork(factory).run(
      repository => saveWithActivity(repository, { ...find(repository.findAll(), "a"), name }, event(league("a"), name)),
      { expectedVersions: { a: 1 } },
    );

    const results = await Promise.allSettled([rename("Primero"), rename("Segundo")]);

    const fulfilled = results.filter(({ status }) => status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(TournamentVersionConflictError);
    expect(rejected[0].reason).toMatchObject({ expectedVersion: 1, actualVersion: 2 });
    const [stored] = await open().findAll();
    const winner = (await open().findActivity()).map(({ summary }) => summary);
    expect(winner).toEqual([stored.name]);
    expect(open().versionOf("a")).toBeUndefined();
    expect((await open().loadLibrary()).versions.get("a")).toBe(2);
  });

  it("un conflicto sólo de biblioteca (torneos distintos) se reintenta sobre datos frescos", async () => {
    await open().save(league("a"));
    await open().save(league("b"));
    const initial = await open().libraryVersion();
    const { factory, loads } = barrierFactory(2);
    const rename = (id: string) => unitOfWork(factory).run(
      repository => saveWithActivity(repository, { ...find(repository.findAll(), id), name: `${id} nuevo` }, event(league(id), id)),
      { expectedVersions: { [id]: 1 } },
    );

    const [first, second] = await Promise.all([rename("a"), rename("b")]);

    expect(loads()).toBe(3);
    expect(Math.max(first.libraryVersion, second.libraryVersion)).toBe(initial + 2);
    expect((await open().findAll()).map(({ name }) => name).sort()).toEqual(["a nuevo", "b nuevo"]);
  });

  it("varias escrituras de un caso de uso se escriben en un único commit atómico", async () => {
    const setup = open();
    await setup.save(league("a"));
    await setup.save(league("b"));
    const initial = await open().libraryVersion();
    const repositories: MongoTournamentRepository[] = [];
    const commit = vi.fn();

    const result = await unitOfWork(() => {
      const repository = open();
      const original = repository.commit.bind(repository);
      repository.commit = (...args) => { commit(); return original(...args); };
      repositories.push(repository);
      return repository;
    }).run(repository => {
      const a = find(repository.findAll(), "a");
      saveWithActivity(repository, { ...a, name: "A una vez" }, event(a, "Uno."));
      repository.save({ ...find(repository.findAll(), "b"), name: "B" });
      saveWithActivity(repository, { ...find(repository.findAll(), "a"), name: "A dos veces" }, event(a, "Dos."));
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(result.libraryVersion).toBe(initial + 1);
    expect(result.versionOf("a")).toBe(2);
    expect(result.versionOf("b")).toBe(2);
    expect((await open().findAll()).map(({ name }) => name)).toEqual(["A dos veces", "B"]);
    expect((await open().findActivity()).map(({ summary }) => summary)).toEqual(["Uno.", "Dos."]);
  });

  it("si el caso de uso lanza, no se escribe nada", async () => {
    await open().saveWithActivity(league("a"), event(league("a"), "Previo."));
    const before = await open().loadLibrary();

    await expect(unitOfWork().run(repository => {
      saveWithActivity(repository, { ...find(repository.findAll(), "a"), name: "No debe quedar" }, event(league("a"), "No."));
      repository.save(league("b"));
      repository.setActiveTournamentId("b");
      throw new Error("Falló a mitad del caso de uso.");
    })).rejects.toThrow("Falló a mitad del caso de uso.");

    expect(await open().loadLibrary()).toEqual(before);
  });

  it("un rechazo de importación conserva sólo el evento de rechazo", async () => {
    await open().save(league("a"));
    const before = await open().findAll();

    await expect(unitOfWork().run(repository =>
      importTournamentArchive({ ...league("a"), name: "Importado" }, "add", repository),
    )).rejects.toThrow("Ya existe un torneo con ese identificador.");

    expect(await open().findAll()).toEqual(before);
    expect((await open().findActivity()).map(({ action, outcome }) => [action, outcome]))
      .toEqual([["tournament-import-rejected", "rejected"]]);
  });

  it("expectedVersions: un torneo inexistente es NotFoundError y una versión vieja es conflicto, sin ejecutar", async () => {
    await open().save(league("a"));
    const work = vi.fn();

    await expect(unitOfWork().run(work, { expectedVersions: { nada: 1 } })).rejects.toBeInstanceOf(NotFoundError);
    await expect(unitOfWork().run(work, { expectedVersions: { a: 7 } }))
      .rejects.toMatchObject({ name: "TournamentVersionConflictError", expectedVersion: 7, actualVersion: 1 });
    expect(work).not.toHaveBeenCalled();
  });

  it("sin cambios no hay commit y read() nunca escribe", async () => {
    await open().save(league("a"));
    const initial = await open().libraryVersion();

    const run = await unitOfWork().run(repository => repository.findAll().length);
    const read = await unitOfWork().read(repository => {
      repository.save({ ...find(repository.findAll(), "a"), name: "Descartado" });
      return repository.findAll()[0].name;
    });

    expect(run).toMatchObject({ result: 1, committed: false, libraryVersion: initial });
    expect(read.result).toBe("Descartado");
    expect((await open().findAll())[0].name).toBe("Liga a");
    expect(await open().libraryVersion()).toBe(initial);
  });

  describe("casos de uso reales de core, sin cambios", () => {
    const create = () => unitOfWork().run(repository => createTournament({
      name: "Liga del servidor",
      teamNames: ["Club Uno", "Club Dos", "Club Tres", "Club Cuatro"],
      legs: 2,
      tieBreakers: ["goalDifference"],
    }, repository));

    it("createTournament + updateMatchResult + renameTournament", async () => {
      const created = await create();
      const id = created.result.id;
      expect(created.versionOf(id)).toBe(1);

      const fixtureId = created.result.matchdays[0].fixtures[0].id;
      const updated = await unitOfWork().run(
        repository => updateMatchResult(find(repository.findAll(), id), fixtureId, { homeGoals: 3, awayGoals: 1 }, repository),
        { expectedVersions: { [id]: 1 } },
      );
      expect(updated.versionOf(id)).toBe(2);

      const renamed = await unitOfWork().run(
        repository => renameTournament(find(repository.findAll(), id), "Liga renombrada", repository),
        { expectedVersions: { [id]: 2 } },
      );
      expect(renamed.versionOf(id)).toBe(3);

      const [stored] = await open().findAll();
      expect(stored.name).toBe("Liga renombrada");
      expect(stored.matchdays[0].fixtures[0].result).toEqual({ homeGoals: 3, awayGoals: 1 });
      expect((await open().findActivity()).map(({ action }) => action))
        .toEqual(["tournament-created", "match-result-updated", "tournament-renamed"]);
    });

    it("simulateChampionship (varios save internos) queda en un solo commit", async () => {
      const created = await create();
      const id = created.result.id;
      const initial = created.libraryVersion;

      const simulated = await unitOfWork().run(
        repository => simulateChampionship(find(repository.findAll(), id), "pendingOnly", repository),
        { expectedVersions: { [id]: 1 } },
      );

      expect(simulated.libraryVersion).toBe(initial + 1);
      expect(simulated.versionOf(id)).toBe(2);
      const [stored] = await open().findAll();
      expect(stored.matchdays.flatMap(({ fixtures }) => fixtures).every(({ result }) => result)).toBe(true);
      expect((await open().findActivity()).map(({ action }) => action)).toEqual(["tournament-created", "matches-simulated"]);
    });
  });
}, 60_000);
