import { isActivityEvent, type ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import type { AsyncTournamentLibraryRepository } from "@cancha/core/application/ports/async-tournament-repository";
import { createActivityEvent } from "@cancha/core/application/services/activity-log";
import { getTournamentStorageIssue } from "@cancha/core/application/validation/tournament-storage";
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

/** Documento de `tournaments`: el torneo sin `id` (va en `_id`) más metadatos `_`. */
export interface TournamentDocument {
  _id: string;
  /** Versión para concurrencia optimista: 1 al crear, +1 en cada escritura. */
  _version: number;
  /** Orden de guardado (contador global): findAll devuelve primero lo último guardado. */
  _saveSeq: number;
  _savedAt: Date;
  [field: string]: unknown;
}

/** Documento de `activity`: el evento con `_id = event.id` y su orden de registro. */
export interface ActivityDocument {
  _id: string;
  _seq: number;
  [field: string]: unknown;
}

interface CounterDocument { _id: string; seq: number }
interface LibraryStateDocument { _id: string; tournamentId: string | null }

const activeTournamentStateId = "active-tournament";
const transactionOptions: TransactionOptions = {
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
  readPreference: "primary",
};
const duplicateKeyCode = 11000;

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
  return { id: _id, ...fields } as unknown as Tournament;
}

function toActivityEvent(document: ActivityDocument): unknown {
  const { _id, _seq, ...fields } = document;
  void _seq;
  return { id: _id, ...fields };
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

  constructor(private readonly client: MongoClient, database: Db) {
    this.tournaments = database.collection(tournamentCollectionNames.tournaments);
    this.activity = database.collection(tournamentCollectionNames.activity);
    this.counters = database.collection(tournamentCollectionNames.counters);
    this.libraryState = database.collection(tournamentCollectionNames.libraryState);
  }

  /** Índices necesarios. Idempotente: se puede ejecutar en cada arranque. */
  static async ensureIndexes(database: Db): Promise<void> {
    await database.collection(tournamentCollectionNames.tournaments).createIndexes([
      { key: { _saveSeq: -1 }, name: "saveSeq_desc" },
    ]);
    await database.collection(tournamentCollectionNames.activity).createIndexes([
      { key: { _seq: 1 }, name: "seq_unique", unique: true },
      { key: { tournamentId: 1, _seq: 1 }, name: "tournament_seq" },
    ]);
  }

  /** Versión conocida por esta instancia (leída o escrita), o undefined. */
  versionOf(id: string): number | undefined {
    return this.versions.get(id);
  }

  async findAll(): Promise<Tournament[]> {
    const documents = await this.tournaments.find().sort({ _saveSeq: -1, _id: 1 }).toArray();
    const valid: Tournament[] = [];
    for (const document of documents) {
      const tournament = toTournament(document);
      const issue = storageIssue(tournament);
      if (issue) {
        const name = typeof tournament.name === "string" ? tournament.name : tournament.id;
        console.warn(`Se omitió un campeonato guardado por contener datos inválidos. "${name}". ${issue}`);
        continue;
      }
      this.versions.set(tournament.id, document._version);
      valid.push(tournament);
    }
    return valid;
  }

  async save(tournament: Tournament): Promise<void> {
    this.assertStorable(tournament);
    const written = await this.transaction(session => this.writeTournaments([tournament], session));
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
      const versions = await this.writeTournaments(tournaments, session);
      await this.appendActivity(event, session);
      return versions;
    });
    this.remember(written);
  }

  async recordActivity(event: ActivityEvent): Promise<void> {
    this.assertActivityEvent(event);
    await this.transaction(session => this.appendActivity(event, session));
  }

  async findActivity(): Promise<ActivityEvent[]> {
    const events = (await this.activity.find().sort({ _seq: 1 }).toArray()).map(toActivityEvent);
    if (!events.every(isActivityEvent)) {
      throw new Error("El historial de actividad contiene registros inválidos.");
    }
    return events;
  }

  async deleteById(id: string): Promise<void> {
    await this.transaction(async session => {
      const document = await this.tournaments.findOne({ _id: id }, { session });
      if (!document) throw new Error("No se encontró el campeonato que quieres eliminar.");
      const tournament = toTournament(document);
      if (storageIssue(tournament)) {
        throw new Error("No se eliminó el campeonato porque sus datos guardados están dañados.");
      }
      const expected = this.versions.get(id) ?? document._version;
      const deleted = await this.tournaments.deleteOne({ _id: id, _version: expected }, { session });
      if (deleted.deletedCount === 0) {
        throw new TournamentVersionConflictError(id, expected, document._version, tournament.name);
      }
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
    const state = await this.libraryState.findOne({ _id: activeTournamentStateId });
    return state?.tournamentId ?? null;
  }

  async setActiveTournamentId(id: string | null): Promise<void> {
    await this.libraryState.updateOne(
      { _id: activeTournamentStateId },
      { $set: { tournamentId: id } },
      { upsert: true },
    );
  }

  private assertStorable(tournament: Tournament): void {
    const issue = storageIssue(tournament);
    if (issue) throw new Error(`No se guardó "${tournament.name || tournament.id}": ${issue}`);
  }

  private assertActivityEvent(event: ActivityEvent): void {
    if (!isActivityEvent(event)) throw new Error("No se pudo guardar un evento de actividad inválido.");
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
  ): Promise<Map<string, number>> {
    const lastSeq = await this.nextSequence("tournaments", tournaments.length, session);
    const savedAt = new Date();
    const written = new Map<string, number>();
    for (const [index, tournament] of tournaments.entries()) {
      const { id, ...fields } = toPlainJson(tournament);
      const saveSeq = lastSeq - tournaments.length + 1 + index;
      const expected = this.versions.get(id);
      const version = (expected ?? 0) + 1;
      const document: TournamentDocument = { _id: id, ...fields, _version: version, _saveSeq: saveSeq, _savedAt: savedAt };
      if (expected === undefined) {
        try {
          await this.tournaments.insertOne(document, { session });
        } catch (error) {
          if (!(error instanceof MongoServerError) || error.code !== duplicateKeyCode) throw error;
          throw new TournamentVersionConflictError(id, null, await this.currentVersion(id), tournament.name);
        }
      } else {
        const result = await this.tournaments.replaceOne({ _id: id, _version: expected }, document, { session });
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
      const current = await this.tournaments.findOne({ _id: id }, { session, projection: { _version: 1 } });
      return current?._version ?? null;
    } catch {
      return null;
    }
  }

  /** Igual que localStorage: un evento con un id ya registrado no se duplica. */
  private async appendActivity(event: ActivityEvent, session: ClientSession): Promise<void> {
    if (await this.activity.findOne({ _id: event.id }, { session, projection: { _id: 1 } })) return;
    const { id, ...fields } = toPlainJson(event);
    const seq = await this.nextSequence("activity", 1, session);
    await this.activity.insertOne({ _id: id, _seq: seq, ...fields }, { session });
  }

  private async nextSequence(name: string, increment: number, session: ClientSession): Promise<number> {
    const counter = await this.counters.findOneAndUpdate(
      { _id: name },
      { $inc: { seq: increment } },
      { upsert: true, returnDocument: "after", session },
    );
    return counter!.seq;
  }
}
