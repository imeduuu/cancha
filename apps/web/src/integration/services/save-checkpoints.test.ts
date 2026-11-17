import { afterEach, describe, expect, it, vi } from "vitest";
import { SaveCheckpoints, checkpointDigest, checkpointMetadata, compareCheckpointLibrary } from "@cancha/core/application/services/save-checkpoints";
import { checkpointLibrary, MemoryCheckpointStore, testClone } from "@cancha/core/test-utils/save-checkpoint-fixtures";
import { createTournamentBackup, parseTournamentBackupWithActivity } from "@cancha/core/application/services/tournament-archive";
import { LocalStorageTournamentRepository } from "../../infrastructure/persistence/local-storage-tournament-repository";

function setup() {
  let library = checkpointLibrary();let id = 0;
  const store = new MemoryCheckpointStore();
  const restore = vi.fn((point: ReturnType<typeof parseTournamentBackupWithActivity>) => {
    library = {tournaments: point.tournaments, activity: point.activity, universes: point.universes ?? {version: 1, activeUniverseId: null, universes: [], assignments: {}}};
    return {added: point.tournaments.length, skipped: 0};
  });
  const service = new SaveCheckpoints(store, () => library, restore, checkpointDigest, () => new Date("2026-11-07T12:00:00Z"), () => `point-${++id}`);
  async function create(name = "Antes de avanzar") { return service.confirmCreation(await service.reviewCreation(name, "Biblioteca completa"), true); }
  return {service, store, restore, get: () => library, set: (next: typeof library) => {library = next;}, create};
}
afterEach(() => vi.unstubAllGlobals());

describe("Puntos de control completos", () => {
  it("revisa sin acceder al almacenamiento y confirma todo el contenido con SHA-256", async () => {
    const s = setup();const original = testClone(s.get());const add = vi.spyOn(s.store, "add"), get = vi.spyOn(s.store, "get");
    const review = await s.service.reviewCreation("  Nacionales terminadas  ", "  Descripción  ");
    expect(add).not.toHaveBeenCalled();expect(get).not.toHaveBeenCalled();expect(s.restore).not.toHaveBeenCalled();
    expect(review.checkpoint).toMatchObject({name: "Nacionales terminadas", description: "Descripción", tournamentCount: 3, universeCount: 2, activityCount: 1, backupVersion: 7});
    const created = await s.service.confirmCreation(review, true);
    expect(get).toHaveBeenCalledWith(created.id);expect(created.integrity.digest).toBe(await checkpointDigest(created.content));
    const raw = JSON.parse(created.content);
    expect(raw).toMatchObject({format: "cancha-backup", version: 7, activity: original.activity, extensions: {sportsUniverses: original.universes}});
    expect(raw.tournaments).toEqual(original.tournaments);
    expect(raw.extensions.sportsUniverses.assignments.unassigned).toBeUndefined();expect(s.get()).toEqual(original);
  });
  it("admite una biblioteca vacía sin inventar universos", async () => {
    const s = setup();s.set({tournaments: [], activity: [], universes: {version: 1, activeUniverseId: null, universes: [], assignments: {}}});
    const point = await s.create();expect(point.tournamentCount).toBe(0);expect(point.universeCount).toBe(0);
    expect(parseTournamentBackupWithActivity(point.content).tournaments).toEqual([]);
  });
  it("permite nombres repetidos con IDs distintos y creaciones simultáneas", async () => {
    const s = setup();const [a,b] = await Promise.all([s.create("Mismo nombre"), s.create("Mismo nombre")]);
    expect(a.id).not.toBe(b.id);expect((await s.service.list())).toHaveLength(2);
  });
  it.each(["", "   ", "x".repeat(121)])("rechaza el nombre inválido %j", async name => {
    const s = setup();await expect(s.service.reviewCreation(name)).rejects.toThrow(/Nombre/);expect(s.store.records.size).toBe(0);
  });
  it("rechaza descripción excesiva y datos deportivos o referencias inválidos", async () => {
    const s = setup();await expect(s.service.reviewCreation("Nombre", "x".repeat(1001))).rejects.toThrow(/Descripción/);
    s.set({...s.get(), tournaments: s.get().tournaments.map(t => t.id !== "two" ? t : {...t,
      seasonPreparation: {schemaVersion: 1, sourceTournamentIds: ["one"], plannedParticipants: t.teams.map(team => team.name), calendarReviews: []}})});
    await expect(s.service.reviewCreation("Nombre")).rejects.toThrow(/relación|universo/);
    expect(s.store.records.size).toBe(0);
  });
  it("bloquea revisiones copiadas, manipuladas, no confirmadas o reutilizadas", async () => {
    const s = setup();const review = await s.service.reviewCreation("Nombre");
    await expect(s.service.confirmCreation(review, false)).rejects.toThrow(/confirmar/);
    await expect(s.service.confirmCreation({...review}, true)).rejects.toThrow(/obsoleta/);
    await s.service.confirmCreation(review, true);
    await expect(s.service.confirmCreation(review, true)).rejects.toThrow(/obsoleta/);
    expect(s.store.records.size).toBe(1);
  });
  it("bloquea biblioteca o universo cambiados entre revisión y creación", async () => {
    const s = setup();let review = await s.service.reviewCreation("Nombre");
    s.set({...s.get(), activity: []});await expect(s.service.confirmCreation(review, true)).rejects.toThrow(/obsoleta/);
    review = await s.service.reviewCreation("Nombre");s.set({...s.get(), universes: {...s.get().universes, activeUniverseId: "u-two"}});
    await expect(s.service.confirmCreation(review, true)).rejects.toThrow(/obsoleta/);expect(s.store.records.size).toBe(0);
  });
  it("impide duplicar una misma confirmación concurrente", async () => {
    const s = setup();const review = await s.service.reviewCreation("Nombre");let unblock!: () => void;
    const originalAdd = s.store.add.bind(s.store);
    vi.spyOn(s.store, "add").mockImplementation(async value => {await new Promise<void>(resolve => {unblock = resolve;});await originalAdd(value);});
    const first = s.service.confirmCreation(review, true);
    await vi.waitFor(() => expect(unblock).toBeTypeOf("function"));
    await expect(s.service.confirmCreation(review, true)).rejects.toThrow(/curso/);
    unblock();await first;expect(s.store.records.size).toBe(1);
  });
  it("no sobrescribe IDs duplicados y no anuncia éxito ante cuota o lectura fallida", async () => {
    const s = setup();const point = await s.create();
    const duplicate = new SaveCheckpoints(s.store, s.get, s.restore, checkpointDigest, () => new Date(point.createdAt), () => point.id);
    await expect(duplicate.confirmCreation(await duplicate.reviewCreation("Otra versión"), true)).rejects.toThrow(/duplicado/);
    const original = s.store.records.get(point.id);
    vi.spyOn(s.store, "add").mockRejectedValueOnce(new DOMException("Sin espacio", "QuotaExceededError"));
    await expect(s.create()).rejects.toThrow(/Sin espacio/);expect(s.store.records.get(point.id)).toEqual(original);
    vi.spyOn(s.store, "get").mockRejectedValueOnce(new Error("Error de lectura"));
    await expect(s.create()).rejects.toThrow(/lectura/);expect(s.store.records.size).toBe(2);
    vi.spyOn(s.store, "add").mockResolvedValueOnce(undefined);
    await expect(s.create()).rejects.toThrow(/eliminado|borró/);expect(s.store.records.size).toBe(2);
  });
  it("detecta contenido corrupto, metadatos incompatibles y cantidades falsas", async () => {
    const s = setup();const point = await s.create();
    s.store.records.set(point.id, {...point, content: point.content + " "});await expect(s.service.verify(point.id)).rejects.toThrow(/SHA-256/);
    s.store.records.set(point.id, {...point, storageVersion: 2});await expect(s.service.verify(point.id)).rejects.toMatchObject({status: "Incompatible"});
    s.store.records.set(point.id, {...point, tournamentCount: 90});await expect(s.service.verify(point.id)).rejects.toThrow(/metadatos/);
    const raw = JSON.parse(point.content);raw.tournaments[0].matchdays[0].fixtures[0].homeTeamId = "unknown-team";
    const content = JSON.stringify(raw, null, 2);
    s.store.records.set(point.id, {...point, content, sizeBytes: new TextEncoder().encode(content).byteLength, integrity: {algorithm: "SHA-256", digest: await checkpointDigest(content)}});
    await expect(s.service.verify(point.id)).rejects.toMatchObject({status: "Inválido"});
    expect(() => checkpointMetadata({storageVersion: 1})).toThrow();
  });
  it("descarga exactamente el JSON original sin alterar la biblioteca y rechaza contenido corrupto", async () => {
    const s = setup();const point = await s.create();const before = testClone(s.get());
    const file = await s.service.download(point.id);expect(file.content).toBe(point.content);expect(JSON.parse(file.content).version).toBe(7);
    const current = s.service.downloadCurrent();expect(parseTournamentBackupWithActivity(current.content).tournaments).toEqual(before.tournaments);
    expect(s.get()).toEqual(before);expect(s.restore).not.toHaveBeenCalled();
    s.store.records.set(point.id, {...point, content: "damaged"});await expect(s.service.download(point.id)).rejects.toThrow();
  });
  it("edita solo metadatos y rechaza ediciones obsoletas", async () => {
    const s = setup();const point = await s.create();const edited = await s.service.edit(point.id, point, "Nuevo", "Nueva descripción");
    expect(edited).toMatchObject({name: "Nuevo", description: "Nueva descripción", content: point.content, integrity: point.integrity, createdAt: point.createdAt, revision: 2});
    await expect(s.service.edit(point.id, point, "Obsoleto", "")).rejects.toThrow(/cambió/);
  });
  it("elimina únicamente tras confirmar y detecta cambios o desaparición del punto", async () => {
    const s = setup();const point = await s.create();const before = testClone(s.get());
    await expect(s.service.delete(point.id, point, false)).rejects.toThrow(/confirmar/);expect(s.store.records.size).toBe(1);
    const edited = await s.service.edit(point.id, point, "Otro nombre", "");await expect(s.service.delete(point.id, point, true)).rejects.toThrow(/cambió/);
    await s.service.delete(edited.id, edited, true);expect(s.store.records.size).toBe(0);expect(s.get()).toEqual(before);
    await expect(s.service.verify(point.id)).rejects.toThrow(/eliminado/);
  });
  it("compara solo IDs explícitos, temporadas, universos, marcadores y actividad", async () => {
    const s = setup();const point = await s.create();
    const current = checkpointLibrary();current.tournaments = [{...current.tournaments[0], season: 2027}, {...current.tournaments[1], id: "other-id", name: "Liga one"}];
    current.universes = {version: 1, activeUniverseId: null, universes: [{id: "other-universe", name: "Partida uno"}], assignments: {}};
    const comparison = compareCheckpointLibrary(parseTournamentBackupWithActivity(point.content), current);
    expect(comparison.sharedTournamentIds).toEqual(["one"]);expect(comparison.differentSeasonIds).toEqual(["one"]);
    expect(comparison.currentOnlyIds).toEqual(["other-id"]);expect(comparison.checkpointOnlyIds).toEqual(["two", "unassigned"]);
    expect(comparison.sharedUniverseIds).toEqual([]);expect(comparison.currentResults).toBe(2);expect(comparison.checkpointResults).toBe(3);
  });
  it("cancelar la restauración no escribe; confirmar restaura el punto íntegro", async () => {
    const s = setup();const saved = testClone(s.get());const point = await s.create();
    s.set({...s.get(), tournaments: [] , universes: {version: 1, activeUniverseId: null, universes: [], assignments: {}}, activity: []});
    const review = await s.service.reviewRestoration(point.id);
    expect(s.restore).not.toHaveBeenCalled();await expect(s.service.confirmRestoration(review, false)).rejects.toThrow(/explícita/);
    expect(s.get().tournaments).toEqual([]);await s.service.confirmRestoration(review, true);
    expect(s.get().tournaments).toEqual(saved.tournaments);expect(s.get().universes).toEqual(saved.universes);
    expect(s.get().activity[0]).toMatchObject({...saved.activity[0], imported: true});
    await expect(s.service.confirmRestoration(review, true)).rejects.toThrow(/obsoleta/);
  });
  it("rechaza restauraciones con biblioteca o universo cambiado, punto editado o eliminado", async () => {
    const s = setup();const point = await s.create();let review = await s.service.reviewRestoration(point.id);
    s.set({...s.get(), universes: {...s.get().universes, activeUniverseId: "u-two"}});
    await expect(s.service.confirmRestoration(review, true)).rejects.toThrow(/universo activo/);
    review = await s.service.reviewRestoration(point.id);const edited = await s.service.edit(point.id, point, "Cambio", "");
    await expect(s.service.confirmRestoration(review, true)).rejects.toThrow(/cambió/);
    review = await s.service.reviewRestoration(point.id);await s.service.delete(point.id, edited, true);
    await expect(s.service.confirmRestoration(review, true)).rejects.toThrow(/eliminado/);expect(s.restore).not.toHaveBeenCalled();
  });
  it("no confirma si el restaurador falla o no confirma un reemplazo íntegro", async () => {
    const s = setup();const point = await s.create();let review = await s.service.reviewRestoration(point.id);
    s.restore.mockImplementationOnce(() => {throw new Error("Error de escritura");});await expect(s.service.confirmRestoration(review, true)).rejects.toThrow(/escritura/);
    review = await s.service.reviewRestoration(point.id);s.restore.mockReturnValueOnce({added: 0, skipped: 3});
    await expect(s.service.confirmRestoration(review, true)).rejects.toThrow(/no confirmó/);
  });
  it("migra un respaldo antiguo mediante el lector existente y no inventa asignaciones", async () => {
    const s = setup();const old = parseTournamentBackupWithActivity(JSON.stringify({tournaments: s.get().tournaments}));
    s.set({tournaments: old.tournaments, activity: old.activity, universes: {version: 1, activeUniverseId: null, universes: [], assignments: {}}});
    const point = await s.create();expect(JSON.parse(point.content)).toMatchObject({version: 7, extensions: {sportsUniverses: {universes: [], assignments: {}}}});
  });
  it("reutiliza reemplazo y recuperación del repositorio real, incluso tras recarga y ante fallo de escritura", async () => {
    const values = new Map<string,string>();let fail = false;
    vi.stubGlobal("localStorage", {getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string,value: string) => {if (fail && key === "cancha.sportsUniverses") {fail = false;throw new DOMException("Cuota", "QuotaExceededError");}values.set(key,value);},
      removeItem: (key: string) => {values.delete(key);}});
    const original = checkpointLibrary(), repo = new LocalStorageTournamentRepository(false);
    repo.importTournaments(original.tournaments, "replace", original.activity, false, original.universes);
    const store = new MemoryCheckpointStore();
    const controller = () => new SaveCheckpoints(store, () => ({tournaments: repo.findAll(), activity: repo.findActivity(), universes: repo.getSportsUniverseLibrary()}),
      parsed => repo.importTournaments(parsed.tournaments, "replace", parsed.activity, false, parsed.universes));
    const externalReview = await controller().reviewCreation("No reutilizable");
    await expect(controller().confirmCreation(externalReview, true)).rejects.toThrow(/obsoleta/);
    const first = controller();const saved = await first.confirmCreation(await first.reviewCreation("Conservar"), true);
    repo.save({...repo.findAll()[0], name: "Progreso posterior"});
    const reloaded = controller();let review = await reloaded.reviewRestoration(saved.id);
    const before = new Map(values);fail = true;
    await expect(reloaded.confirmRestoration(review, true)).rejects.toThrow();expect(values).toEqual(before);
    review = await reloaded.reviewRestoration(saved.id);await reloaded.confirmRestoration(review, true);
    expect(repo.findAll().map(t => t.name)).not.toContain("Progreso posterior");expect(repo.findActivity().at(-1)?.action).toBe("library-restored");
    expect(repo.getSportsUniverseLibrary()).toEqual(original.universes);expect(repo.getRecoverySnapshotStatus().available).toBe(true);
    repo.restoreRecoverySnapshot();expect(repo.findAll().map(t => t.name)).toContain("Progreso posterior");
    const backup = createTournamentBackup(repo.findAll(), () => new Date(), repo.findActivity(), repo.getSportsUniverseLibrary());expect(backup.version).toBe(7);
  });
});
