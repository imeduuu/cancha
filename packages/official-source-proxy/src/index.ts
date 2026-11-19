import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

/**
 * Proxy cerrado de las fuentes oficiales que no admiten CORS. Cada prefijo
 * tiene un destino fijo: el cliente sólo elige la ruta dentro de ese sitio,
 * nunca el host. Lo usan la API (controlador de Nest), Vite en desarrollo y
 * `verify:live`, así que la política es la misma en todos lados.
 * Ver docs/official-source-proxy.md.
 */
export const officialSourceTargets = {
  "/official-source": "https://www.campeonatochileno.cl",
  "/third-division-source": "https://anfaterceradivision.cl",
  "/argentina-cup-source": "https://www.copaargentina.org",
  "/brazil-cup-source": "https://www.cbf.com.br",
} as const;

export type OfficialSourcePrefix = keyof typeof officialSourceTargets;
export type OfficialSourceTargets = Readonly<Record<OfficialSourcePrefix, string>>;

export const officialSourcePrefixes = Object.keys(officialSourceTargets) as OfficialSourcePrefix[];

export interface OfficialSourceLimits {
  /** Plazo total por consulta al origen (conexión, redirecciones y lectura del cuerpo). */
  readonly timeoutMs: number;
  /** Tamaño máximo del cuerpo ya descomprimido. */
  readonly maxResponseBytes: number;
  /** Vida de una respuesta en caché; 0 desactiva la caché. */
  readonly cacheTtlMs: number;
  readonly cacheMaxEntries: number;
  readonly cacheMaxBytes: number;
  /** Consultas por cliente en cada ventana; 0 = sin límite. */
  readonly rateLimit: number;
  readonly rateWindowMs: number;
}

/**
 * Medido (docs/live-importers-results.json, 17/10/2026): la respuesta mayor es
 * ANFP Ascenso con 1,33 MB; 5 MiB deja ~3,8× de margen. Una importación de ANFA
 * hace hasta ~55 consultas (una por jornada): 300 por minuto son 5 importaciones.
 */
export const defaultOfficialSourceLimits: OfficialSourceLimits = {
  timeoutMs: 20_000,
  maxResponseBytes: 5 * 1024 * 1024,
  cacheTtlMs: 10 * 60_000,
  cacheMaxEntries: 200,
  cacheMaxBytes: 64 * 1024 * 1024,
  rateLimit: 300,
  rateWindowMs: 60_000,
};

export interface OfficialSourceProxyOptions extends Partial<OfficialSourceLimits> {
  /** Sólo para pruebas (un servidor local como origen). En producción, siempre los fijos. */
  readonly targets?: OfficialSourceTargets;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export interface OfficialSourceRequest {
  readonly method: string;
  /** Ruta y query tal como llegaron, p. ej. `/third-division-source/assets/php/calendario.php?j38=2`. */
  readonly url: string;
  readonly headers?: IncomingHttpHeaders;
  /** Clave del rate limit (la IP del cliente ya resuelta). Sin clave no hay límite. */
  readonly clientKey?: string;
}

export interface OfficialSourceResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface OfficialSourceProxy {
  /** Si la ruta pertenece a alguno de los cuatro prefijos. */
  matches(url: string): boolean;
  respond(request: OfficialSourceRequest): Promise<OfficialSourceResponse>;
  /** Responde por `res` (Node http, Express o connect). */
  handle(req: IncomingMessage, res: ServerResponse, options?: { readonly clientKey?: string; readonly url?: string }): Promise<void>;
  clearCache(): void;
}

export const officialSourceMessages = {
  invalidPath: "Ruta de fuente oficial no válida.",
  unknownSource: "Fuente oficial desconocida.",
  methodNotAllowed: "Las fuentes oficiales sólo admiten consultas GET.",
  rateLimited: "Demasiadas consultas a fuentes oficiales. Espera un momento y vuelve a intentarlo.",
  timeout: "La fuente oficial no respondió a tiempo.",
  tooLarge: "La respuesta de la fuente oficial supera el tamaño permitido.",
  unreachable: "No se pudo conectar con la fuente oficial.",
  foreignRedirect: "La fuente oficial redirigió a un sitio no permitido.",
  tooManyRedirects: "La fuente oficial redirigió demasiadas veces.",
  upstreamStatus: (status: number) => `La fuente oficial respondió con HTTP ${status}.`,
} as const;

const maximumUrlLength = 2048;
const maximumRedirects = 3;
const userAgent = "Cancha (importador de fuentes oficiales)";
/** Sólo Copa do Brasil la necesita: con `RSC: 1` la CBF responde el payload de React Server Components. */
const rscPrefix: OfficialSourcePrefix = "/brazil-cup-source";
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

class ProxyFailure extends Error {
  constructor(readonly status: number, message: string, readonly extraHeaders: Record<string, string> = {}) {
    super(message);
  }
}

function prefixOf(path: string): OfficialSourcePrefix | undefined {
  return officialSourcePrefixes.find(prefix => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Valida la ruta (sin prefijo) y la query antes de construir la URL. Rechaza en
 * crudo lo que podría cambiar de host o escapar del sitio tras decodificar:
 * segmentos `.`/`..`, sus formas codificadas, `/` y `\` codificados, `//`, `@`,
 * barras invertidas, `#`, caracteres de control y codificaciones mal formadas.
 */
function assertSafePath(pathname: string, search: string): void {
  const whole = pathname + search;
  if (!pathname.startsWith("/")
    || /[\u0000-\u001f\u007f\s\\#]/.test(whole)
    || /%(?:2e|2f|5c|25|00)/i.test(pathname)
    || pathname.includes("//")
    || pathname.includes("@")) {
    throw new ProxyFailure(400, officialSourceMessages.invalidPath);
  }
  for (const segment of pathname.split("/")) {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch { throw new ProxyFailure(400, officialSourceMessages.invalidPath); }
    if (decoded === "." || decoded === "..") throw new ProxyFailure(400, officialSourceMessages.invalidPath);
  }
  try { decodeURIComponent(search); } catch { throw new ProxyFailure(400, officialSourceMessages.invalidPath); }
}

/** URL del origen dentro del sitio fijo; nunca sale de su origen. */
function upstreamUrl(origin: string, pathname: string, search: string): URL {
  assertSafePath(pathname, search);
  const url = new URL(pathname + search, origin);
  if (url.origin !== origin || url.pathname !== pathname) throw new ProxyFailure(400, officialSourceMessages.invalidPath);
  return url;
}

function text(status: number, message: string, extraHeaders: Record<string, string> = {}): OfficialSourceResponse {
  return {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
    body: new TextEncoder().encode(message),
  };
}

interface CachedBody {
  readonly contentType: string;
  readonly body: Uint8Array;
}

interface CacheEntry extends CachedBody {
  readonly expiresAt: number;
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new ProxyFailure(502, officialSourceMessages.tooLarge);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ProxyFailure(502, officialSourceMessages.tooLarge);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export function createOfficialSourceProxy(options: OfficialSourceProxyOptions = {}): OfficialSourceProxy {
  const limits: OfficialSourceLimits = {
    timeoutMs: options.timeoutMs ?? defaultOfficialSourceLimits.timeoutMs,
    maxResponseBytes: options.maxResponseBytes ?? defaultOfficialSourceLimits.maxResponseBytes,
    cacheTtlMs: options.cacheTtlMs ?? defaultOfficialSourceLimits.cacheTtlMs,
    cacheMaxEntries: options.cacheMaxEntries ?? defaultOfficialSourceLimits.cacheMaxEntries,
    cacheMaxBytes: options.cacheMaxBytes ?? defaultOfficialSourceLimits.cacheMaxBytes,
    rateLimit: options.rateLimit ?? defaultOfficialSourceLimits.rateLimit,
    rateWindowMs: options.rateWindowMs ?? defaultOfficialSourceLimits.rateWindowMs,
  };
  const targets = options.targets ?? officialSourceTargets;
  const origins = Object.fromEntries(officialSourcePrefixes.map(prefix => [prefix, new URL(targets[prefix]).origin])) as Record<OfficialSourcePrefix, string>;
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;

  // LRU: Map conserva el orden de inserción; un acierto vuelve a insertar la entrada.
  const cache = new Map<string, CacheEntry>();
  let cacheBytes = 0;
  const inFlight = new Map<string, Promise<CachedBody>>();
  const windows = new Map<string, { count: number; resetAt: number }>();
  let nextPrune = 0;

  function dropEntry(key: string): void {
    const entry = cache.get(key);
    if (!entry) return;
    cache.delete(key);
    cacheBytes -= entry.body.byteLength;
  }

  function cached(key: string): CachedBody | undefined {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) { dropEntry(key); return undefined; }
    cache.delete(key);
    cache.set(key, entry);
    return entry;
  }

  function store(key: string, value: CachedBody): void {
    const size = value.body.byteLength;
    if (limits.cacheTtlMs <= 0 || limits.cacheMaxEntries <= 0 || size > limits.cacheMaxBytes) return;
    dropEntry(key);
    for (const oldest of cache.keys()) {
      if (cache.size < limits.cacheMaxEntries && cacheBytes + size <= limits.cacheMaxBytes) break;
      dropEntry(oldest);
    }
    cache.set(key, { ...value, expiresAt: now() + limits.cacheTtlMs });
    cacheBytes += size;
  }

  /** Ventana fija por cliente. Devuelve los segundos de espera si se excedió. */
  function rateLimited(clientKey: string | undefined): number | undefined {
    if (!clientKey || limits.rateLimit <= 0) return undefined;
    const current = now();
    if (current >= nextPrune) {
      for (const [key, window] of windows) if (window.resetAt <= current) windows.delete(key);
      nextPrune = current + limits.rateWindowMs;
    }
    let window = windows.get(clientKey);
    if (!window || window.resetAt <= current) {
      window = { count: 0, resetAt: current + limits.rateWindowMs };
      windows.set(clientKey, window);
    }
    window.count += 1;
    return window.count > limits.rateLimit ? Math.max(1, Math.ceil((window.resetAt - current) / 1000)) : undefined;
  }

  async function download(url: URL, origin: string, headers: Record<string, string>): Promise<CachedBody> {
    const signal = AbortSignal.timeout(limits.timeoutMs);
    try {
      let current = url;
      for (let redirects = 0; ; redirects += 1) {
        let response: Response;
        try {
          response = await doFetch(current, { method: "GET", headers, redirect: "manual", signal });
        } catch {
          if (signal.aborted) throw new ProxyFailure(504, officialSourceMessages.timeout);
          throw new ProxyFailure(502, officialSourceMessages.unreachable);
        }
        if (redirectStatuses.has(response.status)) {
          await response.body?.cancel().catch(() => {});
          const location = response.headers.get("location");
          if (!location) throw new ProxyFailure(502, officialSourceMessages.upstreamStatus(response.status));
          let next: URL;
          try { next = new URL(location, current); } catch { throw new ProxyFailure(502, officialSourceMessages.foreignRedirect); }
          if (next.origin !== origin) throw new ProxyFailure(502, officialSourceMessages.foreignRedirect);
          if (redirects + 1 > maximumRedirects) throw new ProxyFailure(502, officialSourceMessages.tooManyRedirects);
          try { current = upstreamUrl(origin, next.pathname, next.search); }
          catch { throw new ProxyFailure(502, officialSourceMessages.foreignRedirect); }
          continue;
        }
        if (response.status < 200 || response.status > 299) {
          await response.body?.cancel().catch(() => {});
          throw new ProxyFailure(502, officialSourceMessages.upstreamStatus(response.status));
        }
        const body = await readLimited(response, limits.maxResponseBytes);
        return { contentType: response.headers.get("content-type") ?? "application/octet-stream", body };
      }
    } catch (error) {
      if (error instanceof ProxyFailure) throw error;
      if (signal.aborted) throw new ProxyFailure(504, officialSourceMessages.timeout);
      throw new ProxyFailure(502, officialSourceMessages.unreachable);
    }
  }

  async function respond(request: OfficialSourceRequest): Promise<OfficialSourceResponse> {
    try {
      if (request.method.toUpperCase() !== "GET") {
        throw new ProxyFailure(405, officialSourceMessages.methodNotAllowed, { allow: "GET" });
      }
      const wait = rateLimited(request.clientKey);
      if (wait !== undefined) throw new ProxyFailure(429, officialSourceMessages.rateLimited, { "retry-after": String(wait) });
      if (request.url.length > maximumUrlLength) throw new ProxyFailure(400, officialSourceMessages.invalidPath);
      const queryAt = request.url.indexOf("?");
      const path = queryAt === -1 ? request.url : request.url.slice(0, queryAt);
      const search = queryAt === -1 ? "" : request.url.slice(queryAt);
      const prefix = prefixOf(path);
      if (!prefix) throw new ProxyFailure(404, officialSourceMessages.unknownSource);
      const origin = origins[prefix];
      const url = upstreamUrl(origin, path.slice(prefix.length) || "/", search === "?" ? "" : search);

      // Ninguna cabecera del cliente llega al origen, salvo `RSC: 1` hacia la CBF.
      const headers: Record<string, string> = { "user-agent": userAgent, accept: "*/*" };
      const rsc = prefix === rscPrefix && request.headers?.rsc === "1";
      if (rsc) headers.rsc = "1";

      const key = `GET ${url.href}${rsc ? " rsc" : ""}`;
      let source: "hit" | "miss" = "hit";
      let value = cached(key);
      if (!value) {
        source = "miss";
        let pending = inFlight.get(key);
        if (!pending) {
          pending = download(url, origin, headers).then(result => { store(key, result); return result; });
          inFlight.set(key, pending);
          // Un error no queda en caché ni bloquea la siguiente consulta.
          void pending.finally(() => inFlight.delete(key)).catch(() => {});
        }
        value = await pending;
      }
      return {
        status: 200,
        headers: {
          "content-type": value.contentType,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "x-cancha-source-cache": source,
        },
        body: value.body,
      };
    } catch (error) {
      if (error instanceof ProxyFailure) return text(error.status, error.message, error.extraHeaders);
      return text(502, officialSourceMessages.unreachable);
    }
  }

  return {
    matches: url => prefixOf(url.split("?")[0]) !== undefined,
    respond,
    async handle(req, res, handleOptions = {}) {
      const result = await respond({
        method: req.method ?? "GET",
        url: handleOptions.url ?? req.url ?? "/",
        headers: req.headers,
        clientKey: handleOptions.clientKey,
      });
      res.statusCode = result.status;
      for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
      res.setHeader("content-length", String(result.body.byteLength));
      res.end(result.body);
    },
    clearCache() {
      cache.clear();
      cacheBytes = 0;
    },
  };
}
