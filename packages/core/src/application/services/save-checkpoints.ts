import type { LibraryWriteLease } from "../ports/library-write-lease";
import type { SaveCheckpoint, CheckpointStatus } from "../../domain/entities/save-checkpoint";
import type { SaveCheckpointStore } from "../ports/save-checkpoint-store";
import type { Tournament } from "../../domain/entities/tournament";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { SportsUniverseLibrary } from "../../domain/entities/sports-universe";
import { createTournamentBackup, parseTournamentBackupWithActivity, type ParsedTournamentBackup } from "./tournament-archive";

export interface CompleteLibrary {
  tournaments: readonly Tournament[];
  activity: readonly ActivityEvent[];
  universes: SportsUniverseLibrary;
}
/** Lo que guarda un punto: la web incluye universos deportivos; el servidor, no. */
export type CheckpointLibrary = Omit<CompleteLibrary, "universes"> & { readonly universes?: SportsUniverseLibrary };
export interface CheckpointCreationReview { readonly checkpoint: SaveCheckpoint; readonly libraryToken: string }
export interface CheckpointComparison {
  readonly sharedTournamentIds: readonly string[];
  readonly checkpointOnlyIds: readonly string[];
  readonly currentOnlyIds: readonly string[];
  readonly differentSeasonIds: readonly string[];
  readonly changedTournamentIds: readonly string[];
  readonly sharedUniverseIds: readonly string[];
  readonly checkpointOnlyUniverses: readonly string[];
  readonly currentOnlyUniverses: readonly string[];
  readonly changedUniverseIds: readonly string[];
  readonly currentResults: number;
  readonly checkpointResults: number;
  readonly replacedResults: number;
  readonly currentActivity: number;
  readonly checkpointActivity: number;
  readonly currentActiveUniverse: string | null;
  readonly checkpointActiveUniverse: string | null;
}
export interface CheckpointRestoreReview {
  readonly checkpoint: SaveCheckpoint;
  readonly libraryToken: string;
  readonly comparison: CheckpointComparison;
}
export class CheckpointValidationError extends Error {
  constructor(message: string, readonly status: CheckpointStatus = "Inválido", readonly record?: unknown) { super(message); }
}

export async function checkpointDigest(content: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto no está disponible: no se puede verificar la huella del punto. Usa el respaldo JSON.");
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}
function text(value: string, label: string, max: number, required = false) {
  if (typeof value !== "string" || value.length > max || required && !value.trim())
    throw new CheckpointValidationError(`${label}: ${required ? "es obligatorio y " : ""}no puede superar ${max} caracteres.`);
  return value.trim();
}
export function checkpointMetadata(raw: unknown): SaveCheckpoint {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CheckpointValidationError("El registro del punto está incompleto.");
  const r = raw as SaveCheckpoint;
  if (r.storageVersion !== 1 || r.backupFormat !== "cancha-backup" || r.backupVersion !== 7)
    throw new CheckpointValidationError("El formato o la versión del punto no son compatibles.", "Incompatible");
  text(r.id, "Identificador", 150, true);text(r.name, "Nombre", 120, true);text(r.description, "Descripción", 1000);
  if (![r.createdAt, r.updatedAt].every(v => typeof v === "string" && Number.isFinite(Date.parse(v)))
    || ![r.tournamentCount, r.universeCount, r.activityCount, r.sizeBytes].every(v => Number.isSafeInteger(v) && v >= 0)
    || !Number.isSafeInteger(r.revision) || r.revision < 1 || typeof r.content !== "string"
    || r.integrity?.algorithm !== "SHA-256" || typeof r.integrity.digest !== "string" || !/^[a-f0-9]{64}$/.test(r.integrity.digest))
    throw new CheckpointValidationError("Los metadatos o la información de integridad del punto están dañados.");
  return r;
}
/**
 * Respaldo `cancha-backup` v7 con sangría (como lo descarga la web) de la
 * biblioteca en el instante `at`. Lanza si el respaldo no pasa su propia validación.
 */
export function checkpointContent(library: CheckpointLibrary, at: string): string {
  const backup = createTournamentBackup(library.tournaments, () => new Date(at), library.activity, library.universes);
  const content = JSON.stringify(backup, null, 2);
  parseTournamentBackupWithActivity(content);
  return content;
}

export interface CheckpointRecordInput {
  readonly library: CheckpointLibrary;
  readonly content: string;
  readonly digest: string;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
}

/** Registro (metadatos + contenido) de un punto nuevo; valida nombre, descripción y metadatos. */
export function checkpointRecord(input: CheckpointRecordInput): SaveCheckpoint {
  const checkpoint: SaveCheckpoint = {storageVersion: 1, id: input.id, name: text(input.name, "Nombre", 120, true),
    description: text(input.description ?? "", "Descripción", 1000),
    createdAt: input.createdAt, updatedAt: input.createdAt, revision: 1, backupFormat: "cancha-backup", backupVersion: 7,
    tournamentCount: input.library.tournaments.length, universeCount: input.library.universes?.universes.length ?? 0,
    activityCount: input.library.activity.length, sizeBytes: new TextEncoder().encode(input.content).byteLength,
    integrity: {algorithm: "SHA-256", digest: input.digest}, content: input.content};
  checkpointMetadata(checkpoint);
  return checkpoint;
}

export interface CreateSaveCheckpointOptions {
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly digest?: (content: string) => Promise<string>;
}

/**
 * Punto de guardado de una biblioteca ya leída de forma coherente (p. ej. en
 * una transacción del servidor): no hace falta la revisión en dos pasos de la web.
 */
export async function createSaveCheckpoint(
  library: CheckpointLibrary,
  name: string,
  description = "",
  options: CreateSaveCheckpointOptions = {},
): Promise<SaveCheckpoint> {
  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  text(name, "Nombre", 120, true); text(description, "Descripción", 1000);
  const content = checkpointContent(library, createdAt);
  const digest = await (options.digest ?? checkpointDigest)(content);
  return checkpointRecord({library, content, digest, id: (options.createId ?? (() => crypto.randomUUID()))(), name, description, createdAt});
}

/**
 * Verifica un registro guardado: metadatos, huella SHA-256 del contenido,
 * respaldo válido y coherente con los metadatos. Lanza CheckpointValidationError.
 */
export async function verifySaveCheckpoint(
  raw: unknown,
  digest: (content: string) => Promise<string> = checkpointDigest,
): Promise<SaveCheckpoint> {
  const record = checkpointMetadata(raw);
  if (await digest(record.content) !== record.integrity.digest) throw new CheckpointValidationError("La huella SHA-256 no coincide: el contenido del punto cambió.");
  let backup: ParsedTournamentBackup;
  try { backup = parseTournamentBackupWithActivity(record.content); }
  catch (error) { throw new CheckpointValidationError(`El respaldo del punto no pasa la validación: ${error instanceof Error ? error.message : "contenido inválido"}`); }
  if (backup.version !== 7 || backup.exportedAt !== record.createdAt || backup.tournaments.length !== record.tournamentCount
    || (backup.universes?.universes.length ?? 0) !== record.universeCount || backup.activity.length !== record.activityCount
    || new TextEncoder().encode(record.content).byteLength !== record.sizeBytes)
    throw new CheckpointValidationError("El respaldo no coincide con los metadatos del punto.");
  return record;
}

function libraryToken(state: CompleteLibrary) { return JSON.stringify([state.tournaments, state.activity, state.universes]); }
function results(tournaments: readonly Tournament[]) {
  return tournaments.flatMap(t => t.matchdays.flatMap(d => d.fixtures.filter(f => f.result))).length;
}
export function compareCheckpointLibrary(point: ParsedTournamentBackup, current: CompleteLibrary): CheckpointComparison {
  const local = new Map(current.tournaments.map(t => [t.id, t]));
  const incoming = new Map(point.tournaments.map(t => [t.id, t]));
  const shared = [...incoming.keys()].filter(id => local.has(id));
  const universes = new Map(current.universes.universes.map(u => [u.id, u]));
  const savedUniverses = new Map((point.universes?.universes ?? []).map(u => [u.id, u]));
  let replacedResults = 0;
  for (const t of current.tournaments) {
    const saved = new Map(incoming.get(t.id)?.matchdays.flatMap(d => d.fixtures).map(f => [f.id, f.result]) ?? []);
    replacedResults += t.matchdays.flatMap(d => d.fixtures).filter(f => f.result && JSON.stringify(f.result) !== JSON.stringify(saved.get(f.id))).length;
  }
  return {
    sharedTournamentIds: shared, checkpointOnlyIds: [...incoming.keys()].filter(id => !local.has(id)),
    currentOnlyIds: [...local.keys()].filter(id => !incoming.has(id)),
    differentSeasonIds: shared.filter(id => local.get(id)!.season !== incoming.get(id)!.season || local.get(id)!.competitionId !== incoming.get(id)!.competitionId),
    changedTournamentIds: shared.filter(id => JSON.stringify(local.get(id)) !== JSON.stringify(incoming.get(id))),
    sharedUniverseIds: [...savedUniverses.keys()].filter(id => universes.has(id)),
    checkpointOnlyUniverses: [...savedUniverses.keys()].filter(id => !universes.has(id)),
    currentOnlyUniverses: [...universes.keys()].filter(id => !savedUniverses.has(id)),
    changedUniverseIds: [...savedUniverses.keys()].filter(id => universes.has(id) && JSON.stringify(universes.get(id)) !== JSON.stringify(savedUniverses.get(id))),
    currentResults: results(current.tournaments), checkpointResults: results(point.tournaments), replacedResults,
    currentActivity: current.activity.length, checkpointActivity: point.activity.length,
    currentActiveUniverse: current.universes.activeUniverseId, checkpointActiveUniverse: point.universes?.activeUniverseId ?? null,
  };
}

export class SaveCheckpoints {
  private readonly creations = new WeakMap<CheckpointCreationReview, string>();
  private readonly restores = new WeakMap<CheckpointRestoreReview, string>();
  private readonly pending = new WeakSet<object>();
  constructor(
    private readonly store: SaveCheckpointStore,
    private readonly readLibrary: () => CompleteLibrary,
    private readonly restoreLibrary: (backup: ParsedTournamentBackup, lease?: LibraryWriteLease) => {added: number; skipped: number},
    private readonly digest: (content: string) => Promise<string> = checkpointDigest,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  private capture(at: string) {
    const state = this.readLibrary();
    return {state, content: checkpointContent(state, at), token: libraryToken(state)};
  }
  async list(): Promise<unknown[]> { return this.store.list(); }
  async verify(id: string): Promise<SaveCheckpoint> {
    const raw = await this.store.get(id);
    if (raw === undefined) throw new CheckpointValidationError("El punto fue eliminado o el navegador borró su almacenamiento.", "Error de lectura");
    try {
      const record = await this.verifyRecord(raw);
      if (record.id !== id) throw new CheckpointValidationError("La identidad del punto no coincide con su clave de almacenamiento.");
      return record;
    } catch (error) {
      throw new CheckpointValidationError(error instanceof Error ? error.message : "No se pudo verificar el punto.",
        error instanceof CheckpointValidationError ? error.status : "Error de lectura", raw);
    }
  }
  private async verifyRecord(raw: unknown): Promise<SaveCheckpoint> {
    return verifySaveCheckpoint(raw, this.digest);
  }
  async reviewCreation(name: string, description = ""): Promise<CheckpointCreationReview> {
    const createdAt = this.now().toISOString();
    const normalizedName = text(name, "Nombre", 120, true), normalizedDescription = text(description, "Descripción", 1000);
    const captured = this.capture(createdAt);
    const digest = await this.digest(captured.content);
    if (this.capture(createdAt).token !== captured.token) throw new Error("La biblioteca cambió durante la revisión. Revisa nuevamente el punto.");
    const checkpoint = checkpointRecord({library: captured.state, content: captured.content, digest, id: this.createId(),
      name: normalizedName, description: normalizedDescription, createdAt});
    const review = {checkpoint, libraryToken: captured.token};
    this.creations.set(review, JSON.stringify(review));return review;
  }
  async confirmCreation(review: CheckpointCreationReview, confirmed: boolean): Promise<SaveCheckpoint> {
    if (!confirmed) throw new Error("Se requiere confirmar la creación del punto.");
    if (this.pending.has(review)) throw new Error("La creación de este punto ya está en curso.");
    this.pending.add(review);
    try {
      return await this.store.exclusive(async () => {
        if (this.creations.get(review) !== JSON.stringify(review) || this.capture(review.checkpoint.createdAt).token !== review.libraryToken)
          throw new Error("La revisión del punto está obsoleta. La biblioteca o sus universos cambiaron; revisa nuevamente.");
        await this.verifyRecord(review.checkpoint);
        if (this.capture(review.checkpoint.createdAt).token !== review.libraryToken) throw new Error("La biblioteca cambió. Revisa nuevamente antes de guardar.");
        await this.store.add(review.checkpoint);
        this.creations.delete(review);
        const retrieved = await this.verify(review.checkpoint.id);
        if (JSON.stringify(retrieved) !== JSON.stringify(review.checkpoint)) throw new Error("El registro recuperado no coincide con el punto creado. No se confirmó su protección.");
        return retrieved;
      });
    } finally { this.pending.delete(review); }
  }
  async download(id: string): Promise<{name: string; content: string}> {
    const record = await this.verify(id);
    return {name: `cancha-punto-${record.id}.json`, content: record.content};
  }
  async edit(id: string, expected: unknown, name: string, description: string): Promise<SaveCheckpoint> {
    return this.store.exclusive(async () => {
      const current = await this.verify(id);
      if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error("El punto cambió. Actualiza la lista antes de editar.");
      const next: SaveCheckpoint = {...current, name: text(name, "Nombre", 120, true), description: text(description, "Descripción", 1000),
        updatedAt: this.now().toISOString(), revision: current.revision + 1};
      await this.store.replace(id, current, next);
      const retrieved = await this.verify(id);
      if (JSON.stringify(retrieved) !== JSON.stringify(next)) throw new Error("No se pudo verificar la edición del punto.");
      return retrieved;
    });
  }
  async delete(id: string, expected: unknown, confirmed: boolean): Promise<void> {
    if (!confirmed) throw new Error("Se requiere confirmar la eliminación del punto.");
    await this.store.exclusive(async () => {
      await this.store.delete(id, expected);
      if (await this.store.get(id) !== undefined) throw new Error("No se pudo confirmar la eliminación del punto.");
    });
  }
  async reviewRestoration(id: string): Promise<CheckpointRestoreReview> {
    const checkpoint = await this.verify(id);
    const current = this.capture(this.now().toISOString());
    const point = parseTournamentBackupWithActivity(checkpoint.content);
    const review = {checkpoint, libraryToken: current.token, comparison: compareCheckpointLibrary(point, current.state)};
    this.restores.set(review, JSON.stringify(review));return review;
  }
  async confirmRestoration(review: CheckpointRestoreReview, confirmed: boolean): Promise<{added: number; skipped: number}> {
    if (!confirmed) throw new Error("Se requiere confirmación explícita para reemplazar la biblioteca.");
    if (this.pending.has(review)) throw new Error("La restauración ya está en curso.");
    this.pending.add(review);
    try {
      return await this.store.exclusive(async lease => {
        if (this.restores.get(review) !== JSON.stringify(review)) throw new Error("La revisión de restauración está obsoleta o ya fue utilizada.");
        const current = await this.verify(review.checkpoint.id);
        if (JSON.stringify(current) !== JSON.stringify(review.checkpoint)) throw new Error("El punto cambió o fue eliminado. Revisa nuevamente la restauración.");
        const parsed = parseTournamentBackupWithActivity(current.content);
        if (this.capture(this.now().toISOString()).token !== review.libraryToken)
          throw new Error("La biblioteca o el universo activo cambiaron. Revisa nuevamente la restauración.");
        const result = this.restoreLibrary(parsed, lease);
        if (!result || result.added !== parsed.tournaments.length || result.skipped !== 0)
          throw new Error("El repositorio no confirmó la restauración completa.");
        this.restores.delete(review);return result;
      }, true);
    } finally { this.pending.delete(review); }
  }
  downloadCurrent(): {name: string; content: string} {
    return {name: "cancha-respaldo-actual.json", content: this.capture(this.now().toISOString()).content};
  }
}
