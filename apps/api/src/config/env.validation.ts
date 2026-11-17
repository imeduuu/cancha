export const nodeEnvironments = ["development", "test", "production"] as const;
export type NodeEnvironment = (typeof nodeEnvironments)[number];

/** Configuración validada de la API (ver apps/api/.env.example). */
export interface ApiEnvironment {
  readonly NODE_ENV: NodeEnvironment;
  readonly PORT: number;
  readonly MONGODB_URI: string;
  readonly MONGODB_DB: string;
}

const defaultPort = 3000;
const defaultDatabase = "cancha";
// Restricciones de nombres de base de datos de MongoDB (Windows incluido).
const invalidDatabaseName = /[/\\. "$*<>:|?]/;

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Valida y normaliza las variables de entorno. La usa ConfigModule al arrancar:
 * si algo es inválido, la API no inicia y el error enumera todos los problemas.
 */
export function validateEnvironment(raw: Record<string, unknown>): ApiEnvironment {
  const problems: string[] = [];

  const nodeEnv = text(raw.NODE_ENV) ?? "development";
  if (!nodeEnvironments.includes(nodeEnv as NodeEnvironment)) {
    problems.push(`NODE_ENV debe ser ${nodeEnvironments.join(", ")} (se recibió "${nodeEnv}").`);
  }

  const portText = text(raw.PORT);
  const port = portText === undefined ? defaultPort : Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push(`PORT debe ser un entero entre 1 y 65535 (se recibió "${portText}").`);
  }

  const uri = text(raw.MONGODB_URI);
  if (!uri) {
    problems.push("MONGODB_URI es obligatoria (por ejemplo mongodb://localhost:27017/?replicaSet=rs0&directConnection=true).");
  } else if (!/^mongodb(\+srv)?:\/\/\S+$/.test(uri)) {
    problems.push("MONGODB_URI debe comenzar con mongodb:// o mongodb+srv://.");
  }

  const database = text(raw.MONGODB_DB) ?? defaultDatabase;
  if (database.length > 63 || invalidDatabaseName.test(database)) {
    problems.push(`MONGODB_DB no es un nombre de base de datos válido para MongoDB ("${database}").`);
  }

  if (problems.length > 0) {
    throw new Error(`Configuración inválida de la API:\n- ${problems.join("\n- ")}`);
  }

  return {
    NODE_ENV: nodeEnv as NodeEnvironment,
    PORT: port,
    MONGODB_URI: uri!,
    MONGODB_DB: database,
  };
}
