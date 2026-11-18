import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import type { SportsUniverseLibrary } from "@cancha/core/domain/entities/sports-universe";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import type { LibraryWriteLease } from "@cancha/core/application/ports/library-write-lease";
import type { TournamentLibraryRepository } from "@cancha/core/application/ports/tournament-repository";

/**
 * Todo lo que la aplicación (app.tsx) usa de la biblioteca: el puerto de core más
 * la coordinación de escrituras, los universos y la recuperación local.
 *
 * Implementaciones:
 * - `LocalStorageTournamentRepository`: modo sin sesión (por defecto).
 * - La réplica de la biblioteca del servidor para usuarios con sesión (fase 5G).
 *
 * Contrato de escritura: toda mutación ocurre dentro de `coordinate(expected, acción)`.
 * `expected` es el `snapshot()` que la vista reconoció; si la biblioteca cambió desde
 * entonces, la escritura se rechaza sin ejecutar la acción. La acción es síncrona.
 */
export interface LibraryBackend extends TournamentLibraryRepository {
  saveWithActivity(tournament: Tournament, event: ActivityEvent): void;
  saveManyWithActivity(tournaments: readonly Tournament[], event: ActivityEvent): void;
  recordActivity(event: ActivityEvent): void;
  findActivity(): ActivityEvent[];

  /** Huella opaca del estado de la biblioteca: cambia con cualquier escritura. */
  snapshot(): string;
  /** Ejecuta `action` (síncrona) como una escritura coordinada si la biblioteca sigue en `expected`. */
  coordinate<T>(expected: string, action: () => T): Promise<T>;
  /** Sólo para acciones que ya corren bajo el bloqueo compartido (restaurar un punto de guardado). */
  commitUnderLibraryLock<T>(expected: string, action: () => T, lease?: LibraryWriteLease): T;

  findAllWithRecoveryReport(): { tournaments: Tournament[]; warnings: string[] };
  getSportsUniverseLibrary(): SportsUniverseLibrary;
  setSportsUniverseLibrary(library: SportsUniverseLibrary): void;
  importTournaments(
    tournaments: readonly Tournament[],
    mode: "merge" | "replace",
    activity?: readonly ActivityEvent[],
    skipRecoveryCopy?: boolean,
    universes?: SportsUniverseLibrary,
  ): { added: number; skipped: number };

  getRecoverySnapshotStatus(): { available: boolean; warning?: string };
  restoreRecoverySnapshot(): { added: number; skipped: number };
  readRawTournamentDataForRecovery(): string;
}
