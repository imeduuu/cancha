import { defaultOfficialSourceLimits } from "@cancha/official-source-proxy";

export const nodeEnvironments = ["development", "test", "production"] as const;
export type NodeEnvironment = (typeof nodeEnvironments)[number];

export const sameSiteValues = ["lax", "strict", "none"] as const;
export type CookieSameSite = (typeof sameSiteValues)[number];

/** Configuración validada de la API (ver apps/api/.env.example). */
export interface ApiEnvironment {
  readonly NODE_ENV: NodeEnvironment;
  readonly PORT: number;
  readonly MONGODB_URI: string;
  readonly MONGODB_DB: string;
  /** Secreto HS256 de los access tokens (≥ 32 caracteres; obligatorio en producción). */
  readonly JWT_ACCESS_SECRET: string;
  /** Orígenes que pueden llamar a la API con credenciales (CORS y cookie del refresh token). */
  readonly CORS_ORIGINS: readonly string[];
  readonly AUTH_COOKIE_SAMESITE: CookieSameSite;
  readonly AUTH_COOKIE_SECURE: boolean;
  readonly REFRESH_TOKEN_TTL_DAYS: number;
  /** Intentos por IP y por operación (register, login, refreshToken) en cada ventana. */
  readonly AUTH_RATE_LIMIT: number;
  readonly AUTH_RATE_TTL_SECONDS: number;
  /**
   * Valor de `trust proxy` de Express: número de saltos de proxy propios entre el
   * cliente y la API (0 = ninguno). Siempre un entero: nunca `true` (confiaría en
   * cualquier X-Forwarded-For) ni listas de IPs.
   */
  readonly TRUST_PROXY: number;
  /**
   * Diagnóstico temporal de TRUST_PROXY: registra X-Forwarded-For, la IP del
   * socket y req.ip de cada petición. Desactivado por defecto; las IPs son datos
   * personales, así que sólo se activa mientras se verifica el despliegue.
   */
  readonly LOG_CLIENT_IP: boolean;
  /** Proxy de fuentes oficiales (fase 6, docs/official-source-proxy.md). */
  readonly OFFICIAL_SOURCE_TIMEOUT_MS: number;
  readonly OFFICIAL_SOURCE_MAX_BYTES: number;
  /** 0 desactiva la caché. */
  readonly OFFICIAL_SOURCE_CACHE_TTL_SECONDS: number;
  readonly OFFICIAL_SOURCE_CACHE_MAX_ENTRIES: number;
  readonly OFFICIAL_SOURCE_CACHE_MAX_BYTES: number;
  /** Consultas por IP en cada ventana (cuenta también los aciertos de caché). */
  readonly OFFICIAL_SOURCE_RATE_LIMIT: number;
  readonly OFFICIAL_SOURCE_RATE_TTL_SECONDS: number;
}

const defaultPort = 3000;
const mebibyte = 1024 * 1024;
const defaultDatabase = "cancha";
// Restricciones de nombres de base de datos de MongoDB (Windows incluido).
const invalidDatabaseName = /[/\\. "$*<>:|?]/;

/** Sólo para desarrollo y pruebas: en producción la API no arranca con este valor. */
export const developmentJwtSecret = "cancha-dev-secret-inseguro-no-usar-en-produccion";
export const minimumJwtSecretLength = 32;
/** Vite (`npm run dev`) en sus dos nombres de host. */
export const developmentCorsOrigins = ["http://127.0.0.1:5173", "http://localhost:5173"] as const;

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Marcadores que quedan al copiar plantillas sin completar: `<REEMPLAZAR…>` de
 * render.yaml/vercel.json/docs y `<db_password>` de la cadena de Atlas.
 */
const placeholder = /REEMPLAZAR|<[^>]*>/i;

/** Hosts que sólo existen en la máquina local: nunca son el origen de la web en producción. */
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

/** Un origen es `esquema://host[:puerto]`, sin ruta, query ni barra final. */
function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
  } catch {
    return false;
  }
}

function integer(
  raw: unknown,
  name: string,
  fallback: number,
  min: number,
  max: number,
  problems: string[],
): number {
  const value = text(raw);
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    problems.push(`${name} debe ser un entero entre ${min} y ${max} (se recibió "${value}").`);
  }
  return parsed;
}

function boolean(raw: unknown, name: string, fallback: boolean, problems: string[]): boolean {
  const value = text(raw)?.toLowerCase();
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  problems.push(`${name} debe ser true o false (se recibió "${value}").`);
  return fallback;
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
  const production = nodeEnv === "production";

  const port = integer(raw.PORT, "PORT", defaultPort, 1, 65535, problems);

  const uri = text(raw.MONGODB_URI);
  if (!uri) {
    problems.push("MONGODB_URI es obligatoria (por ejemplo mongodb://localhost:27017/?replicaSet=rs0&directConnection=true).");
  } else if (!/^mongodb(\+srv)?:\/\/\S+$/.test(uri)) {
    problems.push("MONGODB_URI debe comenzar con mongodb:// o mongodb+srv://.");
  } else if (placeholder.test(uri)) {
    // Sin repetir la URI: puede contener la contraseña.
    problems.push("MONGODB_URI todavía tiene un marcador (<db_password>, <REEMPLAZAR…>): pega la cadena de conexión con la contraseña real.");
  }

  const database = text(raw.MONGODB_DB) ?? defaultDatabase;
  if (database.length > 63 || invalidDatabaseName.test(database)) {
    problems.push(`MONGODB_DB no es un nombre de base de datos válido para MongoDB ("${database}").`);
  }

  const secret = text(raw.JWT_ACCESS_SECRET) ?? (production ? undefined : developmentJwtSecret);
  if (!secret) {
    problems.push(`JWT_ACCESS_SECRET es obligatoria en producción (al menos ${minimumJwtSecretLength} caracteres aleatorios).`);
  } else if (secret.length < minimumJwtSecretLength) {
    problems.push(`JWT_ACCESS_SECRET debe tener al menos ${minimumJwtSecretLength} caracteres.`);
  } else if (production && secret === developmentJwtSecret) {
    problems.push("JWT_ACCESS_SECRET no puede ser el valor de desarrollo en producción.");
  } else if (placeholder.test(secret)) {
    problems.push("JWT_ACCESS_SECRET todavía es un marcador (<REEMPLAZAR…>): genera un valor aleatorio.");
  }

  const originsText = text(raw.CORS_ORIGINS);
  const origins = originsText === undefined
    ? (production ? [] : [...developmentCorsOrigins])
    : originsText.split(",").map(origin => origin.trim()).filter(Boolean);
  if (originsText === undefined && production) {
    problems.push("CORS_ORIGINS es obligatoria en producción (orígenes separados por comas, p. ej. https://cancha.example.cl).");
  }
  const invalidOrigins = origins.filter(origin => !isOrigin(origin));
  if (invalidOrigins.length > 0) {
    problems.push(`CORS_ORIGINS sólo admite orígenes http(s)://host[:puerto] sin ruta ni barra final (inválidos: ${invalidOrigins.join(", ")}).`);
  }
  const placeholderOrigins = origins.filter(origin => placeholder.test(origin));
  if (placeholderOrigins.length > 0) {
    problems.push(`CORS_ORIGINS todavía tiene un marcador: pon la URL real de la web (${placeholderOrigins.join(", ")}).`);
  }
  if (production) {
    // Valores de desarrollo que no sirven detrás de Vercel: la web publicada es https y no local.
    const developmentOrigins = origins.filter(origin =>
      isOrigin(origin) && !placeholder.test(origin)
      && (new URL(origin).protocol !== "https:" || localHosts.has(new URL(origin).hostname)));
    if (developmentOrigins.length > 0) {
      problems.push(`CORS_ORIGINS en producción sólo admite orígenes https públicos, no http ni localhost (inválidos: ${developmentOrigins.join(", ")}).`);
    }
  }

  const sameSite = (text(raw.AUTH_COOKIE_SAMESITE)?.toLowerCase() ?? "lax") as CookieSameSite;
  if (!sameSiteValues.includes(sameSite)) {
    problems.push(`AUTH_COOKIE_SAMESITE debe ser ${sameSiteValues.join(", ")} (se recibió "${sameSite}").`);
  }
  const secure = boolean(raw.AUTH_COOKIE_SECURE, "AUTH_COOKIE_SECURE", true, problems);
  if (!secure && production) problems.push("AUTH_COOKIE_SECURE no puede ser false en producción.");
  if (!secure && sameSite === "none") problems.push("AUTH_COOKIE_SAMESITE=none exige AUTH_COOKIE_SECURE=true.");

  const refreshDays = integer(raw.REFRESH_TOKEN_TTL_DAYS, "REFRESH_TOKEN_TTL_DAYS", 30, 1, 365, problems);
  const rateLimit = integer(raw.AUTH_RATE_LIMIT, "AUTH_RATE_LIMIT", 10, 1, 10_000, problems);
  const rateTtl = integer(raw.AUTH_RATE_TTL_SECONDS, "AUTH_RATE_TTL_SECONDS", 60, 1, 86_400, problems);
  const trustProxy = integer(raw.TRUST_PROXY, "TRUST_PROXY", 0, 0, 10, problems);
  const logClientIp = boolean(raw.LOG_CLIENT_IP, "LOG_CLIENT_IP", false, problems);

  const sourceDefaults = defaultOfficialSourceLimits;
  const sourceTimeout = integer(raw.OFFICIAL_SOURCE_TIMEOUT_MS, "OFFICIAL_SOURCE_TIMEOUT_MS", sourceDefaults.timeoutMs, 1000, 120_000, problems);
  const sourceMaxBytes = integer(raw.OFFICIAL_SOURCE_MAX_BYTES, "OFFICIAL_SOURCE_MAX_BYTES", sourceDefaults.maxResponseBytes, 1024, 64 * mebibyte, problems);
  const sourceCacheTtl = integer(raw.OFFICIAL_SOURCE_CACHE_TTL_SECONDS, "OFFICIAL_SOURCE_CACHE_TTL_SECONDS", sourceDefaults.cacheTtlMs / 1000, 0, 86_400, problems);
  const sourceCacheEntries = integer(raw.OFFICIAL_SOURCE_CACHE_MAX_ENTRIES, "OFFICIAL_SOURCE_CACHE_MAX_ENTRIES", sourceDefaults.cacheMaxEntries, 1, 10_000, problems);
  const sourceCacheBytes = integer(raw.OFFICIAL_SOURCE_CACHE_MAX_BYTES, "OFFICIAL_SOURCE_CACHE_MAX_BYTES", sourceDefaults.cacheMaxBytes, mebibyte, 1024 * mebibyte, problems);
  const sourceRateLimit = integer(raw.OFFICIAL_SOURCE_RATE_LIMIT, "OFFICIAL_SOURCE_RATE_LIMIT", sourceDefaults.rateLimit, 1, 100_000, problems);
  const sourceRateTtl = integer(raw.OFFICIAL_SOURCE_RATE_TTL_SECONDS, "OFFICIAL_SOURCE_RATE_TTL_SECONDS", sourceDefaults.rateWindowMs / 1000, 1, 86_400, problems);

  if (problems.length > 0) {
    throw new Error(`Configuración inválida de la API:\n- ${problems.join("\n- ")}`);
  }

  return {
    NODE_ENV: nodeEnv as NodeEnvironment,
    PORT: port,
    MONGODB_URI: uri!,
    MONGODB_DB: database,
    JWT_ACCESS_SECRET: secret!,
    CORS_ORIGINS: origins,
    AUTH_COOKIE_SAMESITE: sameSite,
    AUTH_COOKIE_SECURE: secure,
    REFRESH_TOKEN_TTL_DAYS: refreshDays,
    AUTH_RATE_LIMIT: rateLimit,
    AUTH_RATE_TTL_SECONDS: rateTtl,
    TRUST_PROXY: trustProxy,
    LOG_CLIENT_IP: logClientIp,
    OFFICIAL_SOURCE_TIMEOUT_MS: sourceTimeout,
    OFFICIAL_SOURCE_MAX_BYTES: sourceMaxBytes,
    OFFICIAL_SOURCE_CACHE_TTL_SECONDS: sourceCacheTtl,
    OFFICIAL_SOURCE_CACHE_MAX_ENTRIES: sourceCacheEntries,
    OFFICIAL_SOURCE_CACHE_MAX_BYTES: sourceCacheBytes,
    OFFICIAL_SOURCE_RATE_LIMIT: sourceRateLimit,
    OFFICIAL_SOURCE_RATE_TTL_SECONDS: sourceRateTtl,
  };
}
