import { isActivityEvent, type ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import type { AsyncTournamentLibraryRepository } from "@cancha/core/application/ports/async-tournament-repository";
import { createActivityEvent } from "@cancha/core/application/services/activity-log";
import { getTournamentStorageIssue } from "@cancha/core/application/validation/tournament-storage";
import type { LibraryChanges } from "@cancha/core/application/services/in-memory-library";
import {
  MongoServerError,
  type ClientSession,
  type Collection,
  type Db,
  type MongoClient,
  type TransactionOptions,
} from "mongodb";

export const tournamentCollectionNames = {
  tournaments: "tournaments",
  activity: "activity",
  counters: "counters",
  libraryState: "library_state",
} as const;

/**
 * Clave de todo documento de la biblioteca: el dueño y el id dentro de su
 * biblioteca. Usar el `_id` (siempre indexado y único) garantiza la unicidad por
 * usuario desde la primera escritura, sin depender de índices secundarios, y
 * permite que dos usuarios tengan el mismo id de torneo o de evento. El orden de
 * los campos importa (Mongo compara subdocumentos en orden): créala sólo con
 * `scopedId`.
 */
export interface ScopedId { userId: string; id: string }

export function scopedId(userId: string, id: string): ScopedId {
  return { userId, id };
}

/** Filtro de todos los documentos de un usuario en una colección de la biblioteca. */
export function userScope(userId: string): { "_id.userId": string } {
  return { "_id.userId": userId };
}

/** Documento de `tournaments`: el torneo sin `id` (va en `_id.id`) más metadatos `_`. */
export interface TournamentDocument {
  _id: ScopedId;
  /** Versión para concurrencia optimista: 1 al crear, +1 en cada escritura. */
  _version: number;
  /** Orden de guardado (contador del usuario): findAll devuelve primero lo último guardado. */
  _saveSeq: number;
  _savedAt: Date;
  [field: string]: unknown;
}

/** Documento de `activity`: el evento con `_id.id = event.id` y su orden de registro. */
export interface ActivityDocument {
  _id: ScopedId;
  _seq: number;
  [field: string]: unknown;
}

/** `counters`: secuencias por usuario (`_id.id` = "tournaments" o "activity"). */
interface CounterDocument { _id: ScopedId; seq: number }
/**
 * `library_state`: por usuario, `active-tournament` guarda el torneo activo y
 * `library` la versión de su biblioteca (+1 en cada escritura).
 */
interface LibraryStateDocument { _id: ScopedId; tournamentId?: string | null; _version?: number }

const activeTournamentStateId = "active-tournament";
const libraryVersionStateId = "library";
const transactionOptions: TransactionOptions = {
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
  readPreference: "primary",
};
const duplicateKeyCode = 11000;
/** Lo último guardado primero; cubierto por el índice `user_saveSeq`. */
export const tournamentOrder = { _saveSeq: -1, "_id.id": 1 } as const;

/**
 * Dos clientes guardaron sobre la misma versión de un torneo (o uno lo borró):
 * la transacción se aborta completa y no queda nada escrito.
 */
export class TournamentVersionConflictError extends Error {
  constructor(
    readonly tournamentId: string,
    readonly expectedVersion: number | null,
    readonly actualVersion: number | null,
    tournamentName = tournamentId,
  ) {
    super(conflictMessage(tournamentName, expectedVersion, actualVersion));
    this.name = "TournamentVersionConflictError";
  }
}

/**
 * Otro cliente escribió en la biblioteca después de que una unidad de trabajo la
 * leyera. Evita el write skew (decidir leyendo el torneo B y escribir sólo A):
 * la transacción se aborta completa.
 */
export class LibraryVersionConflictError extends Error {
  constructor(readonly expectedVersion: number, readonly actualVersion: number | null) {
    super(
      `No se guardaron los cambios: otro cliente modificó la biblioteca (versión esperada ${expectedVersion}, `
      + `versión actual ${actualVersion ?? "desconocida"}). Recarga la biblioteca y vuelve a intentarlo.`,
    );
    this.name = "LibraryVersionConflictError";
  }
}

/** Biblioteca leída en una sola transacción snapshot, con las versiones de lo leído. */
export interface LibrarySnapshot {
  readonly tournaments: Tournament[];
  readonly versions: ReadonlyMap<string, number>;
  readonly activity: ActivityEvent[];
  readonly activeTournamentId: string | null;
  /** 0 si la biblioteca nunca se escribió. */
  readonly libraryVersion: number;
}

/** Versiones contra las que se verifica un commit (las de la lectura). */
export interface LibraryReadVersions {
  readonly versions: ReadonlyMap<string, number>;
  readonly libraryVersion: number;
}

export interface LibraryCommitOptions {
  /**
   * Verificación adicional dentro de la MISMA transacción, antes de escribir:
   * si lanza, no se escribe nada (p. ej. que un punto de guardado siga en la
   * versión que se restaura).
   */
  readonly beforeWrite?: (session: ClientSession) => Promise<void>;
}

export interface LibraryCommitResult {
  /** Versión nueva de cada torneo guardado. */
  readonly versions: ReadonlyMap<string, number>;
  readonly libraryVersion: number;
}

function conflictMessage(name: string, expected: number | null, actual: number | null): string {
  const retry = "Recarga el torneo y vuelve a aplicar tus cambios.";
  if (expected === null) {
    return `No se guardó "${name}": ya existe con la versión ${actual} y esta sesión no lo leyó antes de guardarlo. ${retry}`;
  }
  if (actual === null) {
    return `No se guardó "${name}": otro cliente lo eliminó después de que lo leyeras (versión ${expected}). ${retry}`;
  }
  return `No se guardó "${name}": otro cliente lo modificó (versión esperada ${expected}, versión actual ${actual}). ${retry}`;
}

/** Igual que localStorage: lo que se guarda es exactamente su forma JSON. */
function toPlainJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toTournament(document: TournamentDocument): Tournament {
  const { _id, _version, _saveSeq, _savedAt, ...fields } = document;
  void _version; void _saveSeq; void _savedAt;
  return { id: _id.id, ...fields } as unknown as Tournament;
}

function toActivityEvent(document: ActivityDocument): unknown {
  const { _id, _seq, ...fields } = document;
  void _seq;
  return { id: _id.id, ...fields };
}

function storageIssue(tournament: Tournament): string | undefined {
  try {
    return getTournamentStorageIssue(tournament);
  } catch {
    return "El formato de los datos no es válido.";
  }
}

/**
 * Implementación MongoDB de la biblioteca de torneos con las mismas garantías que
 * LocalStorageTournamentRepository, pero con transacciones reales (replica set).
 *
 * Acotada a un usuario: cada instancia lee y escribe sólo los documentos cuyo
 * `_id.userId` es el suyo (torneos, actividad, contadores, versión de biblioteca
 * y torneo activo). Lo de otro usuario no existe para ella.
 *
 * Unidad de trabajo: cada instancia recuerda la versión de los torneos que leyó
 * (findAll) o escribió, y al guardar exige que la versión en la base siga siendo
 * esa. Guardar un torneo existente sin haberlo leído en esta instancia también
 * es un conflicto. Usa una instancia por petición/operación.
 */
export class MongoTournamentRepository implements AsyncTournamentLibraryRepository {
  private readonly versions = new Map<string, number>();
  private readonly tournaments: Collection<TournamentDocument>;
  private readonly activity: Collection<ActivityDocument>;
  private readonly counters: Collection<CounterDocument>;
  private readonly libraryState: Collection<LibraryStateDocument>;

  constructor(private readonly client: MongoClient, database: Db, private readonly userId: string) {
    if (typeof userId !== "string" || userId === "") {
      throw new TypeError("MongoTournamentRepository exige el id del usuario dueño de la biblioteca.");
    }
    this.tournaments = database.collection(tournamentCollectionNames.tournaments);
    this.activity = database.collection(tournamentCollectionNames.activity);
    this.counters = database.collection(tournamentCollectionNames.counters);
    this.libraryState = database.collection(tournamentCollectionNames.libraryState);
  }

  /**
   * Índices de las consultas por usuario (`"_id.userId"` no usa el índice de
   * `_id`). Idempotente: se puede ejecutar en cada arranque. Ninguna garantía de
   * unicidad depende de ellos: la da el `_id` compuesto.
   */
  static async ensureIndexes(database: Db): Promise<void> {
    await database.collection(tournamentCollectionNames.tournaments).createIndexes([
      { key: { "_id.userId": 1, _saveSeq: -1, "_id.id": 1 }, name: "user_saveSeq" },
    ]);
    await database.collection(tournamentCollectionNames.activity).createIndexes([
      { key: { "_id.userId": 1, _seq: 1 }, name: "user_seq_unique", unique: true },
      { key: { "_id.userId": 1, tournamentId: 1, _seq: 1 }, name: "user_tournament_seq" },
    ]);
  }

  /** Documentos de la biblioteca global anterior a la fase 4B (`_id` string): ningún usuario los ve. */
  static async countLegacyDocuments(database: Db): Promise<number> {
    let total = 0;
    for (const name of Object.values(tournamentCollectionNames)) {
      total += await database.collection(name).countDocuments({ _id: { $type: "string" } } as never);
    }
    return total;
  }

  /** Versión conocida por esta instancia (leída o escrita), o undefined. */
  versionOf(id: string): number | undefined {
    return this.versions.get(id);
  }

  async findAll(): Promise<Tournament[]> {
    const documents = await this.tournaments.find(this.scope()).sort(tournamentOrder).toArray();
    return this.readValidTournaments(documents, this.versions);
  }

  /**
   * Toda la biblioteca del usuario (torneos, actividad, torneo activo y versión)
   * en una transacción snapshot: una vista coherente para la unidad de trabajo.
   */
  async loadLibrary(): Promise<LibrarySnapshot> {
    const snapshot = await this.transaction(async session => {
      const documents = await this.tournaments.find(this.scope(), { session }).sort(tournamentOrder).toArray();
      const versions = new Map<string, number>();
      const tournaments = this.readValidTournaments(documents, versions);
      const activity = await this.readActivity(session);
      const active = await this.libraryState.findOne({ _id: this.key(activeTournamentStateId) }, { session });
      const library = await this.libraryState.findOne({ _id: this.key(libraryVersionStateId) }, { session });
      return {
        tournaments,
        versions,
        activity,
        activeTournamentId: active?.tournamentId ?? null,
        libraryVersion: library?._version ?? 0,
      };
    });
    this.remember(snapshot.versions);
    return snapshot;
  }

  /**
   * Escribe en UNA transacción todo lo que cambió una unidad de trabajo: torneos
   * guardados y eliminados, eventos y torneo activo. Exige que la versión de la
   * biblioteca y la de cada torneo escrito sigan siendo las leídas; cualquier
   * conflicto aborta todo.
   */
  async commit(
    changes: LibraryChanges,
    read: LibraryReadVersions,
    options: LibraryCommitOptions = {},
  ): Promise<LibraryCommitResult> {
    changes.saved.forEach(tournament => this.assertStorable(tournament));
    changes.events.forEach(event => this.assertActivityEvent(event));
    const savedIds = new Set(changes.saved.map(({ id }) => id));
    if (savedIds.size !== changes.saved.length) {
      throw new Error("No se guardaron los cambios: la selección contiene torneos duplicados.");
    }
    const result = await this.transaction(async session => {
      await options.beforeWrite?.(session);
      const libraryVersion = await this.advanceLibraryVersion(read.libraryVersion, session);
      if (changes.replaceLibrary) {
        const kept = [...savedIds].filter(id => read.versions.has(id));
        await this.tournaments.deleteMany({ ...this.scope(), "_id.id": { $nin: kept } }, { session });
      } else {
        for (const id of changes.deleted) {
          const expected = read.versions.get(id);
          const deleted = expected === undefined
            ? { deletedCount: 0 }
            : await this.tournaments.deleteOne({ _id: this.key(id), _version: expected }, { session });
          if (deleted.deletedCount === 0) {
            throw new TournamentVersionConflictError(id, expected ?? null, await this.currentVersion(id, session));
          }
        }
      }
      const versions = changes.saved.length > 0
        ? await this.writeTournaments(changes.saved, session, read.versions)
        : new Map<string, number>();
      if (changes.replaceActivity) await this.activity.deleteMany(this.scope(), { session });
      for (const event of changes.events) await this.appendActivity(event, session);
      if (changes.activeTournament) {
        await this.libraryState.updateOne(
          { _id: this.key(activeTournamentStateId) },
          { $set: { tournamentId: changes.activeTournament.id } },
          { upsert: true, session },
        );
      }
      return { versions, libraryVersion };
    });
    for (const id of changes.deleted) this.versions.delete(id);
    this.remember(result.versions);
    return result;
  }

  /** Versión vigente de la biblioteca del usuario (0 si nunca se escribió). */
  async libraryVersion(): Promise<number> {
    return (await this.libraryState.findOne({ _id: this.key(libraryVersionStateId) }))?._version ?? 0;
  }

  async save(tournament: Tournament): Promise<void> {
    this.assertStorable(tournament);
    const written = await this.transaction(async session => {
      await this.bumpLibraryVersion(session);
      return this.writeTournaments([tournament], session);
    });
    this.remember(written);
  }

  async saveWithActivity(tournament: Tournament, event: ActivityEvent): Promise<void> {
    await this.saveManyWithActivity([tournament], event);
  }

  async saveManyWithActivity(tournaments: readonly Tournament[], event: ActivityEvent): Promise<void> {
    if (tournaments.length === 0) {
      throw new Error("No se guardaron los cambios: no hay torneos para actualizar.");
    }
    if (new Set(tournaments.map(({ id }) => id)).size !== tournaments.length) {
      throw new Error("No se guardaron los cambios: la selección contiene torneos duplicados.");
    }
    tournaments.forEach(tournament => this.assertStorable(tournament));
    this.assertActivityEvent(event);
    const written = await this.transaction(async session => {
      await this.bumpLibraryVersion(session);
      const versions = await this.writeTournaments(tournaments, session);
      await this.appendActivity(event, session);
      return versions;
    });
    this.remember(written);
  }

  async recordActivity(event: ActivityEvent): Promise<void> {
    this.assertActivityEvent(event);
    await this.transaction(async session => {
      await this.bumpLibraryVersion(session);
      await this.appendActivity(event, session);
    });
  }

  async findActivity(): Promise<ActivityEvent[]> {
    return this.readActivity();
  }

  async deleteById(id: string): Promise<void> {
    await this.transaction(async session => {
      const document = await this.tournaments.findOne({ _id: this.key(id) }, { session });
      if (!document) throw new Error("No se encontró el campeonato que quieres eliminar.");
      const tournament = toTournament(document);
      if (storageIssue(tournament)) {
        throw new Error("No se eliminó el campeonato porque sus datos guardados están dañados.");
      }
      const expected = this.versions.get(id) ?? document._version;
      const deleted = await this.tournaments.deleteOne({ _id: this.key(id), _version: expected }, { session });
      if (deleted.deletedCount === 0) {
        throw new TournamentVersionConflictError(id, expected, document._version, tournament.name);
      }
      await this.bumpLibraryVersion(session);
      await this.appendActivity(createActivityEvent(tournament, {
        action: "tournament-deleted",
        entityType: "tournament",
        summary: `Se eliminó la competición "${tournament.name}".`,
        before: { archived: tournament.archived ?? false },
      }), session);
    });
    this.versions.delete(id);
  }

  async getActiveTournamentId(): Promise<string | null> {
    const state = await this.libraryState.findOne({ _id: this.key(activeTournamentStateId) });
    return state?.tournamentId ?? null;
  }

  async setActiveTournamentId(id: string | null): Promise<void> {
    await this.transaction(async session => {
      await this.bumpLibraryVersion(session);
      await this.libraryState.updateOne(
        { _id: this.key(activeTournamentStateId) },
        { $set: { tournamentId: id } },
        { upsert: true, session },
      );
    });
  }

  /** `_id` de un documento de este usuario. */
  private key(id: string): ScopedId {
    return scopedId(this.userId, id);
  }

  /** Filtro de todos los documentos de este usuario en una colección. */
  private scope(): { "_id.userId": string } {
    return userScope(this.userId);
  }

  private assertStorable(tournament: Tournament): void {
    const issue = storageIssue(tournament);
    if (issue) throw new Error(`No se guardó "${tournament.name || tournament.id}": ${issue}`);
  }

  private assertActivityEvent(event: ActivityEvent): void {
    if (!isActivityEvent(event)) throw new Error("No se pudo guardar un evento de actividad inválido.");
  }

  private readValidTournaments(documents: readonly TournamentDocument[], versions: Map<string, number>): Tournament[] {
    const valid: Tournament[] = [];
    for (const document of documents) {
      const tournament = toTournament(document);
      const issue = storageIssue(tournament);
      if (issue) {
        const name = typeof tournament.name === "string" ? tournament.name : tournament.id;
        console.warn(`Se omitió un campeonato guardado por contener datos inválidos. "${name}". ${issue}`);
        continue;
      }
      versions.set(tournament.id, document._version);
      valid.push(tournament);
    }
    return valid;
  }

  private async readActivity(session?: ClientSession): Promise<ActivityEvent[]> {
    const events = (await this.activity.find(this.scope(), { session }).sort({ _seq: 1 }).toArray()).map(toActivityEvent);
    if (!events.every(isActivityEvent)) {
      throw new Error("El historial de actividad contiene registros inválidos.");
    }
    return events;
  }

  /** Escrituras sueltas (fuera de una unidad de trabajo): +1 sin verificar, para invalidar lecturas ajenas. */
  private async bumpLibraryVersion(session: ClientSession): Promise<void> {
    await this.libraryState.updateOne(
      { _id: this.key(libraryVersionStateId) },
      { $inc: { _version: 1 } },
      { upsert: true, session },
    );
  }

  /** Unidad de trabajo: +1 sólo si la biblioteca sigue en la versión leída. */
  private async advanceLibraryVersion(expected: number, session: ClientSession): Promise<number> {
    if (expected === 0) {
      try {
        await this.libraryState.insertOne({ _id: this.key(libraryVersionStateId), _version: 1 }, { session });
        return 1;
      } catch (error) {
        if (!(error instanceof MongoServerError) || error.code !== duplicateKeyCode) throw error;
        throw new LibraryVersionConflictError(expected, await this.currentLibraryVersion());
      }
    }
    const updated = await this.libraryState.updateOne(
      { _id: this.key(libraryVersionStateId), _version: expected },
      { $inc: { _version: 1 } },
      { session },
    );
    if (updated.matchedCount === 0) {
      throw new LibraryVersionConflictError(expected, await this.currentLibraryVersion(session));
    }
    return expected + 1;
  }

  private async currentLibraryVersion(session?: ClientSession): Promise<number | null> {
    try {
      return (await this.libraryState.findOne({ _id: this.key(libraryVersionStateId) }, { session }))?._version ?? 0;
    } catch {
      return null;
    }
  }

  private async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    return this.client.withSession(session => session.withTransaction(() => work(session), transactionOptions));
  }

  private remember(versions: ReadonlyMap<string, number>): void {
    for (const [id, version] of versions) this.versions.set(id, version);
  }

  /** Inserta o reemplaza con verificación de versión. Devuelve las versiones nuevas. */
  private async writeTournaments(
    tournaments: readonly Tournament[],
    session: ClientSession,
    readVersions: ReadonlyMap<string, number> = this.versions,
  ): Promise<Map<string, number>> {
    const lastSeq = await this.nextSequence("tournaments", tournaments.length, session);
    const savedAt = new Date();
    const written = new Map<string, number>();
    for (const [index, tournament] of tournaments.entries()) {
      const { id, ...fields } = toPlainJson(tournament);
      const saveSeq = lastSeq - tournaments.length + 1 + index;
      const expected = readVersions.get(id);
      const version = (expected ?? 0) + 1;
      const document: TournamentDocument = { _id: this.key(id), ...fields, _version: version, _saveSeq: saveSeq, _savedAt: savedAt };
      if (expected === undefined) {
        try {
          await this.tournaments.insertOne(document, { session });
        } catch (error) {
          if (!(error instanceof MongoServerError) || error.code !== duplicateKeyCode) throw error;
          throw new TournamentVersionConflictError(id, null, await this.currentVersion(id), tournament.name);
        }
      } else {
        const result = await this.tournaments.replaceOne({ _id: this.key(id), _version: expected }, document, { session });
        if (result.matchedCount === 0) {
          throw new TournamentVersionConflictError(id, expected, await this.currentVersion(id, session), tournament.name);
        }
      }
      written.set(id, version);
    }
    return written;
  }

  /** Lee la versión vigente para el mensaje de conflicto (fuera de la transacción abortada si hace falta). */
  private async currentVersion(id: string, session?: ClientSession): Promise<number | null> {
    try {
      const current = await this.tournaments.findOne({ _id: this.key(id) }, { session, projection: { _version: 1 } });
      return current?._version ?? null;
    } catch {
      return null;
    }
  }

  /** Igual que localStorage: un evento con un id ya registrado (en la biblioteca del usuario) no se duplica. */
  private async appendActivity(event: ActivityEvent, session: ClientSession): Promise<void> {
    if (await this.activity.findOne({ _id: this.key(event.id) }, { session, projection: { _id: 1 } })) return;
    const { id, ...fields } = toPlainJson(event);
    const seq = await this.nextSequence("activity", 1, session);
    await this.activity.insertOne({ _id: this.key(id), _seq: seq, ...fields }, { session });
  }

  private async nextSequence(name: string, increment: number, session: ClientSession): Promise<number> {
    const counter = await this.counters.findOneAndUpdate(
      { _id: this.key(name) },
      { $inc: { seq: increment } },
      { upsert: true, returnDocument: "after", session },
    );
    return counter!.seq;
  }
}
