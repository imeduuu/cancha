import type { SaveCheckpoint } from "@cancha/core/domain/entities/save-checkpoint";
import type {
  AsyncSaveCheckpointStore,
  SaveCheckpointSummary,
  StoredSaveCheckpoint,
} from "@cancha/core/application/ports/async-save-checkpoint-store";
import { MongoServerError, type ClientSession, type Collection, type Db, type MongoClient } from "mongodb";
import { NotFoundError } from "../library/library-unit-of-work.js";
import { scopedId, userScope, type ScopedId } from "../infrastructure/persistence/mongo-tournament-repository.js";

export const saveCheckpointCollectionName = "save_checkpoints";
/** Tope de puntos por usuario: cada uno guarda la biblioteca completa. */
export const maximumCheckpointsPerUser = 20;
/** El documento BSON admite 16 MB; se reserva margen para los metadatos. */
export const maximumCheckpointContentBytes = 15 * 1024 * 1024;
const duplicateKeyCode = 11000;

/** Documento de `save_checkpoints`: el registro sin `id` (va en `_id.id`) y su versión. */
export interface SaveCheckpointDocument extends Omit<SaveCheckpoint, "id"> {
  _id: ScopedId;
  /** Compare-and-set: 1 al crear (no hay ediciones todavía; un cambio futuro debe incrementarla). */
  _version: number;
  /** Última restauración. Escribirlo en la transacción de restauración es lo que la hace chocar con un borrado concurrente. */
  _lastRestoredAt?: Date;
}

/** El punto cambió o fue eliminado después de que el cliente lo viera: CONFLICT. */
export class SaveCheckpointVersionConflictError extends Error {
  constructor(readonly checkpointId: string, readonly expectedVersion: number, readonly actualVersion: number | null) {
    super(actualVersion === null
      ? `El punto de guardado fue eliminado (versión esperada ${expectedVersion}). Actualiza la lista de puntos.`
      : `El punto de guardado cambió (versión esperada ${expectedVersion}, versión actual ${actualVersion}). Actualiza la lista de puntos.`);
    this.name = "SaveCheckpointVersionConflictError";
  }
}

function notFound(id: string): NotFoundError {
  return new NotFoundError(`No se encontró el punto de guardado "${id}".`);
}

function toRecord(document: SaveCheckpointDocument): unknown {
  const { _id, _version, _lastRestoredAt, ...fields } = document;
  void _version; void _lastRestoredAt;
  return { ...fields, id: _id.id };
}

/**
 * Puntos de guardado de un usuario en MongoDB. `_id: { userId, id }` como la
 * biblioteca: lo de otro usuario no existe (NOT_FOUND). La restauración no
 * vive aquí: la hace la unidad de trabajo, que llama a `assertVersion` dentro
 * de su transacción para que el punto y la biblioteca cambien juntos o nada.
 */
export class MongoSaveCheckpointStore implements AsyncSaveCheckpointStore {
  private readonly checkpoints: Collection<SaveCheckpointDocument>;

  constructor(private readonly client: MongoClient, database: Db, private readonly userId: string) {
    if (typeof userId !== "string" || userId === "") {
      throw new TypeError("MongoSaveCheckpointStore exige el id del usuario dueño de los puntos.");
    }
    this.checkpoints = database.collection(saveCheckpointCollectionName);
  }

  /** Índice del listado por usuario (lo más reciente primero). Idempotente. */
  static async ensureIndexes(database: Db): Promise<void> {
    await database.collection(saveCheckpointCollectionName).createIndexes([
      { key: { "_id.userId": 1, createdAt: -1 }, name: "user_createdAt" },
    ]);
  }

  async list(): Promise<SaveCheckpointSummary[]> {
    const documents = await this.checkpoints
      .find(userScope(this.userId), { projection: { content: 0, _lastRestoredAt: 0 } })
      .sort({ createdAt: -1, "_id.id": 1 })
      .toArray();
    return documents.map(({ _id, _version, ...fields }) => ({ ...fields, id: _id.id, version: _version }) as SaveCheckpointSummary);
  }

  async get(id: string): Promise<StoredSaveCheckpoint | undefined> {
    const document = await this.checkpoints.findOne({ _id: this.key(id) });
    return document ? { record: toRecord(document), version: document._version } : undefined;
  }

  /** Como `get`, pero NOT_FOUND si no existe y CONFLICT si su versión ya no es la esperada. */
  async getExpected(id: string, expectedVersion: number): Promise<StoredSaveCheckpoint> {
    const stored = await this.get(id);
    if (!stored) throw notFound(id);
    if (stored.version !== expectedVersion) throw new SaveCheckpointVersionConflictError(id, expectedVersion, stored.version);
    return stored;
  }

  async add(checkpoint: SaveCheckpoint): Promise<number> {
    if (new TextEncoder().encode(checkpoint.content).byteLength > maximumCheckpointContentBytes) {
      throw new Error("No se creó el punto: la biblioteca supera el tamaño máximo de un punto de guardado (15 MB). Descarga un respaldo JSON.");
    }
    const { id, ...fields } = checkpoint;
    await this.client.withSession(session => session.withTransaction(async () => {
      // Tope blando: dos creaciones simultáneas podrían superarlo por uno.
      const count = await this.checkpoints.countDocuments(userScope(this.userId), { session });
      if (count >= maximumCheckpointsPerUser) {
        throw new Error(`No se creó el punto: ya tienes ${maximumCheckpointsPerUser} puntos de guardado. Elimina alguno antes de crear otro.`);
      }
      try {
        await this.checkpoints.insertOne({ ...fields, _id: this.key(id), _version: 1 }, { session });
      } catch (error) {
        if (error instanceof MongoServerError && error.code === duplicateKeyCode) {
          throw new Error("No se creó el punto: ya existe uno con ese identificador.");
        }
        throw error;
      }
    }));
    return 1;
  }

  async delete(id: string, expectedVersion: number): Promise<void> {
    const deleted = await this.checkpoints.deleteOne({ _id: this.key(id), _version: expectedVersion });
    if (deleted.deletedCount === 1) return;
    const current = await this.checkpoints.findOne({ _id: this.key(id) }, { projection: { _version: 1 } });
    if (!current) throw notFound(id);
    throw new SaveCheckpointVersionConflictError(id, expectedVersion, current._version);
  }

  /**
   * Dentro de la transacción de restauración: compare-and-set sobre el punto.
   * Es una escritura (no sólo una lectura) para que un borrado concurrente
   * produzca un conflicto de escritura en vez de pasar inadvertido.
   */
  async assertVersion(id: string, expectedVersion: number, session: ClientSession): Promise<void> {
    const touched = await this.checkpoints.updateOne(
      { _id: this.key(id), _version: expectedVersion },
      { $set: { _lastRestoredAt: new Date() } },
      { session },
    );
    if (touched.matchedCount === 0) {
      const current = await this.checkpoints.findOne({ _id: this.key(id) }, { session, projection: { _version: 1 } });
      throw new SaveCheckpointVersionConflictError(id, expectedVersion, current?._version ?? null);
    }
  }

  private key(id: string): ScopedId {
    return scopedId(this.userId, id);
  }
}
