/** Local container for an unchanged, complete cancha-backup JSON v7 document. */
export interface SaveCheckpoint {
  readonly storageVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly backupFormat: "cancha-backup";
  readonly backupVersion: 7;
  readonly tournamentCount: number;
  readonly universeCount: number;
  readonly activityCount: number;
  readonly sizeBytes: number;
  readonly integrity: { readonly algorithm: "SHA-256"; readonly digest: string };
  readonly content: string;
}

export type CheckpointStatus = "Disponible" | "Validación pendiente" | "Inválido" | "Incompatible" | "Error de lectura";
