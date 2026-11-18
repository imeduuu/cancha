import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { createActivityEvent } from "@cancha/core/application/services/activity-log";
import { closureLeague } from "@cancha/core/test-utils/season-closure-fixtures";
import type { Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { replicaSetStartupTimeoutMs, startTestReplicaSet, type TestReplicaSet } from "../../test-utils/mongo-replica-set.js";
import {
  LibraryVersionConflictError,
  MongoTournamentRepository,
  scopedId,
  TournamentVersionConflictError,
  tournamentCollectionNames,
  tournamentOrder,
  userScope,
  type TournamentDocument,
} from "./mongo-tournament-repository.js";

let replicaSet: TestReplicaSet;
let database: Db;

beforeAll(async () => { replicaSet = await startTestReplicaSet(); }, replicaSetStartupTimeoutMs);
afterAll(async () => { await replicaSet?.stop(); });
beforeEach(async () => {
  database = replicaSet.freshDatabase();
  await MongoTournamentRepository.ensureIndexes(database);
});

const userA = "user-a";
const userB = "user-b";
const open = (userId = userA) => new MongoTournamentRepository(replicaSet.client, database, userId);
const league = (id: string, name = `Liga ${id}`): Tournament => ({ ...closureLeague(id), name });
const event = (tournament: Tournament, summary = "Se actualizó el reglamento."): ActivityEvent =>
  createActivityEvent(tournament, { action: "regulations-updated", entityType: "tournament", summary });
const storedTournament = (id: string, userId = userA) =>
  database.collection<TournamentDocument>(tournamentCollectionNames.tournaments).findOne({ _id: scopedId(userId, id) });

/** Nombres de todas las etapas del plan ganador de un explain (anidadas en inputStage/inputStages/queryPlan). */
function planStages(plan: unknown): string[] {
  if (!plan || typeof plan !== "object") return [];
  const node = plan as Record<string, unknown>;
  const own = typeof node.stage === "string" ? [node.stage] : [];
  return [...own, ...Object.values(node).flatMap(value => Array.isArray(value) ? value.flatMap(planStages) : planStages(value))];
}

describe("MongoTournamentRepository (específico de MongoDB)", () => {
  it("guarda un documento por torneo con _id = { userId, id }, versión y sin id duplicado", async () => {
    const repository = open();
    const tournament = league("a");
    await repository.save(tournament);
    await repository.save({ ...tournament, name: "Liga A renombrada" });

    const document = await storedTournament("a");
    expect(document).toMatchObject({ _id: { userId: userA, id: "a" }, _version: 2, name: "Liga A renombrada" });
    expect(Object.keys(document!._id)).toEqual(["userId", "id"]);
    expect(document).not.toHaveProperty("id");
    expect(document?._savedAt).toBeInstanceOf(Date);
    expect(repository.versionOf("a")).toBe(2);
  });

  it("no convierte campos undefined en null (misma forma JSON que localStorage)", async () => {
    const tournament = { ...league("a"), archived: undefined };
    await open().save(tournament);
    expect(await storedTournament("a")).not.toHaveProperty("archived");
  });

  it("si dos clientes guardan sobre la misma versión, el segundo falla con un error claro", async () => {
    await open().save(league("a"));
    const first = open();
    const second = open();
    const [fromFirst] = await first.findAll();
    const [fromSecond] = await second.findAll();

    await first.saveWithActivity({ ...fromFirst, name: "Versión del primero" }, event(fromFirst, "Primer cambio."));
    const failure = second.saveWithActivity({ ...fromSecond, name: "Versión del segundo" }, event(fromSecond, "Segundo cambio."));

    await expect(failure).rejects.toBeInstanceOf(TournamentVersionConflictError);
    await expect(failure).rejects.toThrow(
      'No se guardó "Versión del segundo": otro cliente lo modificó (versión esperada 1, versión actual 2). Recarga el torneo y vuelve a aplicar tus cambios.',
    );
    const [stored] = await open().findAll();
    expect(stored.name).toBe("Versión del primero");
    expect((await open().findActivity()).map(({ summary }) => summary)).toEqual(["Primer cambio."]);
    expect(second.versionOf("a")).toBe(1);
  });

  it("después de recargar, el segundo cliente puede guardar", async () => {
    await open().save(league("a"));
    const first = open();
    const second = open();
    await first.findAll();
    await second.findAll();
    const [current] = await first.findAll();
    await first.save({ ...current, name: "Uno" });
    await expect(second.save({ ...current, name: "Dos" })).rejects.toBeInstanceOf(TournamentVersionConflictError);

    const [reloaded] = await second.findAll();
    await second.save({ ...reloaded, name: "Dos" });
    expect((await storedTournament("a"))?._version).toBe(3);
  });

  it("rechaza sobrescribir a ciegas un torneo existente que esta instancia no leyó", async () => {
    await open().save(league("a"));
    const failure = open().save({ ...league("a"), name: "A ciegas" });
    await expect(failure).rejects.toThrow(/ya existe con la versión 1 y esta sesión no lo leyó/);
    expect((await storedTournament("a"))?.name).toBe("Liga a");
  });

  it("un conflicto en medio de saveManyWithActivity no deja escrituras parciales", async () => {
    const setup = open();
    await setup.save(league("a"));
    await setup.save(league("b"));
    const stale = open();
    const [b, a] = await stale.findAll();
    const other = open();
    await other.findAll();
    await other.save({ ...b, name: "B cambiada por otro" });

    const failure = stale.saveManyWithActivity([{ ...a, name: "A nueva" }, { ...b, name: "B nueva" }], event(a));
    await expect(failure).rejects.toBeInstanceOf(TournamentVersionConflictError);

    expect((await storedTournament("a"))).toMatchObject({ name: "Liga a", _version: 1 });
    expect((await storedTournament("b"))).toMatchObject({ name: "B cambiada por otro", _version: 2 });
    expect(await open().findActivity()).toEqual([]);
    expect(stale.versionOf("a")).toBe(1);
  });

  it("detecta que otro cliente eliminó el torneo", async () => {
    await open().save(league("a"));
    const stale = open();
    const [tournament] = await stale.findAll();
    const other = open();
    await other.findAll();
    await other.deleteById("a");

    await expect(stale.save({ ...tournament, name: "Tarde" }))
      .rejects.toThrow(/otro cliente lo eliminó después de que lo leyeras \(versión 1\)/);
    expect(await storedTournament("a")).toBeNull();
  });

  it("findAll devuelve primero lo último guardado, como localStorage", async () => {
    const repository = open();
    await repository.save(league("a"));
    await repository.saveManyWithActivity([league("b"), league("c")], event(league("b")));
    await repository.save({ ...(await repository.findAll()).find(({ id }) => id === "a")!, name: "A otra vez" });
    expect((await open().findAll()).map(({ id }) => id)).toEqual(["a", "c", "b"]);
  });

  it("omite con advertencia los documentos dañados sin afectar a los válidos", async () => {
    await open().save(league("a"));
    await database.collection(tournamentCollectionNames.tournaments)
      .insertOne({ _id: scopedId(userA, "roto"), name: "Roto", _version: 1, _saveSeq: 0, _savedAt: new Date() } as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect((await open().findAll()).map(({ id }) => id)).toEqual(["a"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"Roto"'));
    warn.mockRestore();
  });

  it("crea los índices por usuario", async () => {
    const activityIndexes = await database.collection(tournamentCollectionNames.activity).indexes();
    expect(activityIndexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "user_seq_unique", key: { "_id.userId": 1, _seq: 1 }, unique: true }),
      expect.objectContaining({ name: "user_tournament_seq", key: { "_id.userId": 1, tournamentId: 1, _seq: 1 } }),
    ]));
    const tournamentIndexes = await database.collection(tournamentCollectionNames.tournaments).indexes();
    expect(tournamentIndexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "user_saveSeq", key: { "_id.userId": 1, _saveSeq: -1, "_id.id": 1 } }),
    ]));
  });

  it("findAll y el historial de un usuario usan un índice (IXSCAN, sin COLLSCAN ni SORT en memoria)", async () => {
    for (const userId of [userA, userB, "user-c"]) {
      const repository = open(userId);
      for (const id of ["a", "b", "c"]) await repository.saveWithActivity(league(id), event(league(id)));
    }
    const tournaments = await database.collection(tournamentCollectionNames.tournaments)
      .find(userScope(userA)).sort(tournamentOrder).explain("executionStats");
    const tournamentStages = planStages(tournaments.queryPlanner);
    expect(tournamentStages).toContain("IXSCAN");
    expect(tournamentStages).not.toContain("COLLSCAN");
    expect(tournamentStages).not.toContain("SORT");
    expect(tournaments.executionStats).toMatchObject({ nReturned: 3, totalDocsExamined: 3 });

    const activity = await database.collection(tournamentCollectionNames.activity)
      .find(userScope(userA)).sort({ _seq: 1 }).explain("executionStats");
    const activityStages = planStages(activity.queryPlanner);
    expect(activityStages).toContain("IXSCAN");
    expect(activityStages).not.toContain("COLLSCAN");
    expect(activity.executionStats).toMatchObject({ nReturned: 3, totalDocsExamined: 3 });
  });

  it("cada escritura suelta incrementa la versión de la biblioteca", async () => {
    const repository = open();
    expect(await repository.libraryVersion()).toBe(0);
    await repository.save(league("a"));
    await repository.recordActivity(event(league("a")));
    await repository.setActiveTournamentId("a");
    await repository.deleteById("a");
    expect(await repository.libraryVersion()).toBe(4);
  });

  describe("loadLibrary + commit (unidad de trabajo)", () => {
    it("loadLibrary lee torneos, versiones, actividad, torneo activo y versión de biblioteca", async () => {
      const setup = open();
      await setup.saveWithActivity(league("a"), event(league("a"), "Primero."));
      await setup.setActiveTournamentId("a");

      const snapshot = await open().loadLibrary();
      expect(snapshot.tournaments.map(({ id }) => id)).toEqual(["a"]);
      expect(snapshot.versions.get("a")).toBe(1);
      expect(snapshot.activity.map(({ summary }) => summary)).toEqual(["Primero."]);
      expect(snapshot.activeTournamentId).toBe("a");
      expect(snapshot.libraryVersion).toBe(2);
    });

    it("escribe varios torneos, eventos, eliminaciones y torneo activo en una sola transacción", async () => {
      const setup = open();
      await setup.save(league("a"));
      await setup.save(league("b"));
      const repository = open();
      const snapshot = await repository.loadLibrary();
      const a = snapshot.tournaments.find(({ id }) => id === "a")!;

      const result = await repository.commit({
        saved: [{ ...a, name: "A cambiada" }, league("c")],
        deleted: ["b"],
        events: [event(a, "Uno."), event(league("c"), "Dos.")],
        activeTournament: { id: "c" },
      }, snapshot);

      expect(result.libraryVersion).toBe(snapshot.libraryVersion + 1);
      expect([...result.versions]).toEqual([["a", 2], ["c", 1]]);
      expect((await open().findAll()).map(({ id, name }) => [id, name])).toEqual([["c", "Liga c"], ["a", "A cambiada"]]);
      expect((await open().findActivity()).map(({ summary }) => summary)).toEqual(["Uno.", "Dos."]);
      expect(await open().getActiveTournamentId()).toBe("c");
    });

    it("un conflicto de biblioteca aborta todo el commit", async () => {
      await open().save(league("a"));
      const stale = open();
      const snapshot = await stale.loadLibrary();
      await open().recordActivity(event(league("x"), "Otro cliente."));

      const failure = stale.commit({ saved: [league("nuevo")], deleted: [], events: [event(league("nuevo"))] }, snapshot);
      await expect(failure).rejects.toBeInstanceOf(LibraryVersionConflictError);
      await expect(failure).rejects.toThrow(/otro cliente modificó la biblioteca \(versión esperada 1, versión actual 2\)/);
      expect((await open().findAll()).map(({ id }) => id)).toEqual(["a"]);
      expect((await open().findActivity()).map(({ summary }) => summary)).toEqual(["Otro cliente."]);
    });

    it("un conflicto de un torneo aborta todo el commit aunque la biblioteca coincida", async () => {
      await open().save(league("a"));
      await open().save(league("b"));
      const repository = open();
      const snapshot = await repository.loadLibrary();
      const stale = { ...snapshot, versions: new Map([...snapshot.versions, ["b", 99]]) };

      const failure = repository.commit({
        saved: [{ ...league("a"), name: "A nueva" }, { ...league("b"), name: "B nueva" }],
        deleted: [],
        events: [event(league("a"))],
      }, stale);
      await expect(failure).rejects.toBeInstanceOf(TournamentVersionConflictError);
      expect((await open().findAll()).map(({ name }) => name).sort()).toEqual(["Liga a", "Liga b"]);
      expect(await open().findActivity()).toEqual([]);
      expect(await open().libraryVersion()).toBe(snapshot.libraryVersion);
    });

    it("valida todo lo que llega a commit, aunque no venga de un caso de uso: un torneo o evento inválido no escribe nada", async () => {
      await open().saveWithActivity(league("a"), event(league("a"), "Original."));
      const repository = open();
      const snapshot = await repository.loadLibrary();
      const handmade = { id: "roto", name: "Torneo a mano", teams: "no es una lista", matchdays: [] } as unknown as Tournament;
      const invalidEvent = { ...event(league("a"), "Inválido."), occurredAt: "no es una fecha" };

      await expect(repository.commit({ saved: [{ ...league("a"), name: "A nueva" }, handmade], deleted: [], events: [] }, snapshot))
        .rejects.toThrow(/No se guardó "Torneo a mano"/);
      await expect(repository.commit({ saved: [league("b")], deleted: ["a"], events: [invalidEvent] }, snapshot))
        .rejects.toThrow(/evento de actividad inválido/);

      expect((await open().findAll()).map(({ id, name }) => [id, name])).toEqual([["a", "Liga a"]]);
      expect((await open().findActivity()).map(({ summary }) => summary)).toEqual(["Original."]);
      expect(await open().libraryVersion()).toBe(snapshot.libraryVersion);
    });

    it("replaceLibrary reemplaza todos los torneos y replaceActivity el historial", async () => {
      const setup = open();
      await setup.saveWithActivity(league("a"), event(league("a"), "Viejo."));
      await setup.save(league("b"));
      const repository = open();
      const snapshot = await repository.loadLibrary();

      await repository.commit({
        saved: [{ ...league("b"), name: "B restaurada" }, league("c")],
        deleted: [],
        events: [event(league("c"), "Nuevo.")],
        replaceLibrary: true,
        replaceActivity: true,
      }, snapshot);

      expect((await open().findAll()).map(({ id, name }) => [id, name])).toEqual([["c", "Liga c"], ["b", "B restaurada"]]);
      expect((await open().findActivity()).map(({ summary }) => summary)).toEqual(["Nuevo."]);
    });
  });

  describe("aislamiento por usuario", () => {
    it("dos usuarios pueden tener el mismo id de torneo y de evento sin verse ni chocar", async () => {
      const shared = league("compartido", "Liga Compartida");
      const sharedEvent = event(shared, "Mismo evento.");
      await open(userA).saveWithActivity(shared, sharedEvent);
      await open(userB).saveWithActivity({ ...shared, name: "Liga Compartida" }, sharedEvent);
      await open(userB).save(league("solo-b"));

      expect((await open(userA).findAll()).map(({ id }) => id)).toEqual(["compartido"]);
      expect((await open(userB).findAll()).map(({ id }) => id)).toEqual(["solo-b", "compartido"]);
      // El evento con el mismo id no se descarta como duplicado en la biblioteca de B.
      expect((await open(userA).findActivity()).map(({ id }) => id)).toEqual([sharedEvent.id]);
      expect((await open(userB).findActivity()).map(({ id }) => id)).toEqual([sharedEvent.id]);
      expect(await storedTournament("compartido", userA)).toMatchObject({ _version: 1 });
      expect(await storedTournament("compartido", userB)).toMatchObject({ _version: 1 });
    });

    it("no puede eliminar, guardar a ciegas ni activar lo de otro usuario como si existiera", async () => {
      await open(userA).save(league("a"));
      await expect(open(userB).deleteById("a")).rejects.toThrow("No se encontró el campeonato que quieres eliminar.");
      // Para B, "a" es un torneo nuevo de su propia biblioteca: no toca el de A.
      await open(userB).save({ ...league("a"), name: "De B" });
      expect(await storedTournament("a", userA)).toMatchObject({ name: "Liga a", _version: 1 });
      await open(userB).setActiveTournamentId("a");
      expect(await open(userA).getActiveTournamentId()).toBeNull();
    });

    it("versión de biblioteca, contadores y torneo activo son por usuario", async () => {
      await open(userA).save(league("a"));
      await open(userA).setActiveTournamentId("a");
      expect(await open(userA).libraryVersion()).toBe(2);
      expect(await open(userB).libraryVersion()).toBe(0);

      const stale = open(userB);
      const snapshot = await stale.loadLibrary();
      await open(userA).save(league("a2"));
      await open(userA).recordActivity(event(league("a"), "Escritura de A."));
      // Las escrituras de A no invalidan la lectura de B.
      const result = await stale.commit({ saved: [league("b")], deleted: [], events: [event(league("b"))] }, snapshot);
      expect(result.libraryVersion).toBe(1);
      expect(await open(userB).getActiveTournamentId()).toBeNull();
    });

    it("replaceLibrary y replaceActivity sólo borran la biblioteca propia", async () => {
      await open(userA).saveWithActivity(league("a"), event(league("a"), "De A."));
      await open(userB).saveWithActivity(league("b"), event(league("b"), "De B."));
      const repository = open(userB);
      const snapshot = await repository.loadLibrary();

      await repository.commit({
        saved: [league("nuevo")], deleted: [], events: [event(league("nuevo"), "Restaurado.")],
        replaceLibrary: true, replaceActivity: true,
      }, snapshot);

      expect((await open(userB).findAll()).map(({ id }) => id)).toEqual(["nuevo"]);
      expect((await open(userA).findAll()).map(({ id }) => id)).toEqual(["a"]);
      expect((await open(userA).findActivity()).map(({ summary }) => summary)).toEqual(["De A."]);
    });

    it("los documentos de la biblioteca global anterior (_id string) no los ve ningún usuario y se cuentan", async () => {
      await database.collection(tournamentCollectionNames.tournaments)
        .insertOne({ _id: "legado", ...league("legado"), _version: 1, _saveSeq: 1, _savedAt: new Date() } as never);
      await database.collection(tournamentCollectionNames.libraryState).insertOne({ _id: "library", _version: 9 } as never);
      await open(userA).save(league("a"));

      expect((await open(userA).findAll()).map(({ id }) => id)).toEqual(["a"]);
      expect(await open(userA).libraryVersion()).toBe(1);
      expect(await MongoTournamentRepository.countLegacyDocuments(database)).toBe(2);
    });

    it("exige un userId", () => {
      expect(() => open("")).toThrow(/exige el id del usuario/);
    });
  });

  it("serializa escrituras concurrentes sobre la misma versión: sólo una gana", async () => {
    await open().save(league("a"));
    const clients = await Promise.all(Array.from({ length: 5 }, async () => {
      const repository = open();
      await repository.findAll();
      return repository;
    }));
    const results = await Promise.allSettled(clients.map((repository, index) =>
      repository.saveWithActivity({ ...league("a"), name: `Cliente ${index}` }, event(league("a"), `Cambio ${index}.`))));

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")
      .every(result => (result as PromiseRejectedResult).reason instanceof TournamentVersionConflictError)).toBe(true);
    expect((await storedTournament("a"))?._version).toBe(2);
    expect(await open().findActivity()).toHaveLength(1);
  });
});
