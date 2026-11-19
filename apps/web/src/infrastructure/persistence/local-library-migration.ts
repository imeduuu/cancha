import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import type { SportsUniverseLibrary } from "@cancha/core/domain/entities/sports-universe";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { LocalStorageTournamentRepository } from "./local-storage-tournament-repository";

/**
 * Lectura de la biblioteca de este navegador para migrarla a una cuenta (fase 5I).
 * Sólo lee: `LocalStorageTournamentRepository(true)` no escribe nada fuera de una
 * escritura coordinada, así que la biblioteca local queda exactamente igual.
 */
export interface LocalLibrary {
  readonly tournaments: Tournament[];
  readonly activity: ActivityEvent[];
  readonly universes: SportsUniverseLibrary;
  /** Datos locales dañados: no se migra una biblioteca incompleta. */
  readonly warnings: string[];
}

export function readLocalLibrary(): LocalLibrary {
  try {
    const repository = new LocalStorageTournamentRepository(true);
    const report = repository.findAllWithRecoveryReport();
    return {
      tournaments: report.tournaments,
      activity: repository.findActivity(),
      universes: repository.getSportsUniverseLibrary(),
      warnings: report.warnings,
    };
  } catch (error) {
    return {
      tournaments: [],
      activity: [],
      universes: { version: 1, activeUniverseId: null, universes: [], assignments: {} },
      warnings: [error instanceof Error ? error.message : "No se pudo leer la biblioteca de este navegador."],
    };
  }
}

/** Marca "esta biblioteca local ya se migró a esta cuenta" (no se vuelve a ofrecer). Fuera de las claves deportivas. */
export function migrationMarkerKey(userId: string): string {
  return `cancha.accountMigration.${userId}`;
}

export interface MigrationMarker {
  readonly migratedAt: string;
  readonly mode: "merge" | "replace";
  readonly tournaments: number;
  readonly activity: number;
  readonly universes: number;
  readonly added: number;
  readonly skipped: number;
}

export function hasMigrationMarker(userId: string): boolean {
  try {
    return localStorage.getItem(migrationMarkerKey(userId)) !== null;
  } catch {
    return false;
  }
}

export function writeMigrationMarker(userId: string, marker: MigrationMarker): void {
  try {
    localStorage.setItem(migrationMarkerKey(userId), JSON.stringify(marker));
  } catch {
    // Sin almacenamiento, la migración ya se hizo: sólo se volverá a ofrecer.
  }
}

/** ¿Hay algo en este navegador que ofrecer migrar a la cuenta? */
export function localLibraryNeedsMigration(userId: string): boolean {
  if (hasMigrationMarker(userId)) return false;
  const local = readLocalLibrary();
  return local.tournaments.length > 0 || local.activity.length > 0 || local.warnings.length > 0;
}
