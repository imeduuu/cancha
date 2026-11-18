import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { createActivityEvent } from "@cancha/core/application/services/activity-log";
import { closureLeague } from "@cancha/core/test-utils/season-closure-fixtures";
import type { Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { replicaSetStartupTimeoutMs, startTestReplicaSet, type TestReplicaSet } from "../../test-utils/mongo-replica-set.js";
import {
  MongoTournamentRepository,
  TournamentVersionConflictError,
  tournamentCollectionNames,
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

const open = () => new MongoTournamentRepository(replicaSet.client, database);
const league = (id: string, name = `Liga ${id}`): Tournament => ({ ...closureLeague(id), name });
const event = (tournament: Tournament, summary = "Se actualizó el reglamento."): ActivityEvent =>
  createActivityEvent(tournament, { action: "regulations-updated", entityType: "tournament", summary });
const storedTournament = (id: string) =>
  database.collection<TournamentDocument>(tournamentCollectionNames.tournaments).findOne({ _id: id });

describe("MongoTournamentRepository (específico de MongoDB)", () => {
  it("guarda un documento por torneo con _id = id, versión y sin id duplicado", async () => {
    const repository = open();
    const tournament = league("a");
    await repository.save(tournament);
    await repository.save({ ...tournament, name: "Liga A renombrada" });

    const document = await storedTournament("a");
    expect(document).toMatchObject({ _id: "a", _version: 2, name: "Liga A renombrada" });
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
      .insertOne({ _id: "roto", name: "Roto", _version: 1, _saveSeq: 0, _savedAt: new Date() } as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect((await open().findAll()).map(({ id }) => id)).toEqual(["a"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"Roto"'));
    warn.mockRestore();
  });

  it("crea los índices necesarios", async () => {
    const activityIndexes = await database.collection(tournamentCollectionNames.activity).indexes();
    expect(activityIndexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "seq_unique", key: { _seq: 1 }, unique: true }),
      expect.objectContaining({ name: "tournament_seq", key: { tournamentId: 1, _seq: 1 } }),
    ]));
    const tournamentIndexes = await database.collection(tournamentCollectionNames.tournaments).indexes();
    expect(tournamentIndexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "saveSeq_desc", key: { _saveSeq: -1 } }),
    ]));
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
