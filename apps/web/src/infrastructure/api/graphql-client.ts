/**
 * Cliente GraphQL mínimo para la API (apps/api), servida en el mismo origen
 * (`/graphql`: proxy de Vite en desarrollo, rewrite de Vercel en producción).
 * Sin Apollo Client: la web sólo necesita peticiones POST con JSON.
 *
 * `Content-Type: application/json` satisface la protección CSRF de Apollo
 * (`csrfPrevention`), y `credentials: "same-origin"` envía la cookie
 * `cancha_refresh` (Path=/graphql) sólo a nuestro origen.
 */

export type GraphqlVariables = Readonly<Record<string, unknown>>;

/** Error que devolvió la API, con su `extensions.code` (ver graphql-errors.ts de la API). */
export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly extensions: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = "ApiError";
  }
}
/** CONFLICT: la biblioteca, un torneo o un punto de guardado cambió desde que se leyó. */
export class ApiConflictError extends ApiError { override name = "ApiConflictError"; }
/** VALIDATION: los datos no son válidos (mensaje en español desde core). */
export class ApiValidationError extends ApiError { override name = "ApiValidationError"; }
/** UNAUTHENTICATED: no hay sesión o venció. */
export class ApiUnauthenticatedError extends ApiError { override name = "ApiUnauthenticatedError"; }
export class ApiNotFoundError extends ApiError { override name = "ApiNotFoundError"; }
export class ApiTooManyRequestsError extends ApiError { override name = "ApiTooManyRequestsError"; }

/** La API no respondió o respondió algo que no es GraphQL: no se sabe si la operación se aplicó. */
export class ApiNetworkError extends Error {
  constructor(message = "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.", readonly status?: number) {
    super(message);
    this.name = "ApiNetworkError";
  }
}

const errorByCode: Readonly<Record<string, typeof ApiError>> = {
  CONFLICT: ApiConflictError,
  VALIDATION: ApiValidationError,
  UNAUTHENTICATED: ApiUnauthenticatedError,
  NOT_FOUND: ApiNotFoundError,
  TOO_MANY_REQUESTS: ApiTooManyRequestsError,
};

export function apiErrorFrom(error: { message?: unknown; extensions?: unknown }): ApiError {
  const extensions = typeof error.extensions === "object" && error.extensions !== null
    ? error.extensions as Record<string, unknown>
    : {};
  const code = typeof extensions.code === "string" ? extensions.code : "INTERNAL_SERVER_ERROR";
  const message = typeof error.message === "string" && error.message ? error.message : "Error del servidor.";
  const ErrorType = errorByCode[code] ?? ApiError;
  return new ErrorType(message, code, extensions);
}

export interface GraphqlRequestOptions {
  /** Access token de la sesión; sin él no se envía Authorization. */
  readonly token?: string | null;
  readonly signal?: AbortSignal;
}

export interface GraphqlClient {
  request<T>(query: string, variables?: GraphqlVariables, options?: GraphqlRequestOptions): Promise<T>;
}

export interface GraphqlClientOptions {
  readonly endpoint?: string;
  readonly fetch?: typeof fetch;
}

export function createGraphqlClient(options: GraphqlClientOptions = {}): GraphqlClient {
  const endpoint = options.endpoint ?? "/graphql";
  return {
    async request<T>(query: string, variables?: GraphqlVariables, request: GraphqlRequestOptions = {}): Promise<T> {
      const send = options.fetch ?? globalThis.fetch.bind(globalThis);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (request.token) headers.Authorization = `Bearer ${request.token}`;
      let response: Response;
      try {
        response = await send(endpoint, {
          method: "POST",
          headers,
          credentials: "same-origin",
          body: JSON.stringify(variables ? { query, variables } : { query }),
          signal: request.signal,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new ApiNetworkError();
      }
      if (response.status === 413) {
        throw new ApiNetworkError("Los datos son demasiado grandes para enviarlos al servidor.", 413);
      }
      let body: { data?: T | null; errors?: { message?: unknown; extensions?: unknown }[] };
      try {
        body = await response.json() as typeof body;
      } catch {
        throw new ApiNetworkError(`El servidor respondió de forma inesperada (HTTP ${response.status}).`, response.status);
      }
      if (Array.isArray(body.errors) && body.errors.length > 0) throw apiErrorFrom(body.errors[0]);
      if (!response.ok || body.data === undefined || body.data === null) {
        throw new ApiNetworkError(`El servidor respondió de forma inesperada (HTTP ${response.status}).`, response.status);
      }
      return body.data;
    },
  };
}
