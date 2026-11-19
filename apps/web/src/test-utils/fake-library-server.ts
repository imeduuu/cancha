import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import type { SportsUniverseLibrary } from "@cancha/core/domain/entities/sports-universe";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { InMemoryTournamentRepository } from "@cancha/core/application/services/in-memory-library";
import { emptySportsUniverseLibrary } from "@cancha/core/application/services/sports-universes";
import { restoreTournamentBackup } from "@cancha/core/application/use-cases/restore-tournament-backup";
import { validateLibraryChanges } from "@cancha/core/application/validation/library-changes";
import {
  ApiConflictError,
  ApiError,
  ApiNetworkError,
  ApiUnauthenticatedError,
  ApiValidationError,
  type GraphqlVariables,
} from "../infrastructure/api/graphql-client";
import type { LibraryApi } from "../infrastructure/api/session-library-backend";

/**
 * Servidor de biblioteca en memoria para pruebas de la web con sesión (fase 5G).
 * Responde las mismas operaciones que la API con su misma semántica: valida con
 * `validateLibraryChanges` de core, exige la versión de biblioteca y la avanza en
 * uno por commit, y restaura con `restoreTournamentBackup`. No reemplaza a los e2e
 * de la API: sólo permite probar la web sin red.
 */
export interface FakeLibraryState {
  tournaments: Tournament[];
  activity: ActivityEvent[];
  activeTournamentId: string | null;
  universes: SportsUniverseLibrary;
  libraryVersion: number;
}

export interface FakeLibraryServer {
  readonly state: FakeLibraryState;
  /** Operaciones recibidas, en orden (librarySnapshot, commitLibraryChanges, …). */
  readonly operations: string[];
  /** Cuerpos recibidos por commitLibraryChanges. */
  readonly commits: unknown[];
  /** La próxima petición falla con este error (p. ej. `new ApiNetworkError()`). */
  failNext(error: Error): void;
  /** Otro dispositivo escribió: cambia la biblioteca y avanza la versión. */
  externalWrite(change: (state: FakeLibraryState) => void): void;
  /** Cliente directo (sin HTTP) para el backend. */
  readonly api: LibraryApi;
  /** `fetch` que habla GraphQL, con login/refresh/logout, para recorridos de App. */
  readonly fetch: typeof fetch;
}

const user = { id: "usuario-sesion", email: "sesion@cancha.test", createdAt: "2026-01-01T00:00:00.000Z" };

function apply(state: FakeLibraryState, changes: ReturnType<typeof validateLibraryChanges>): void {
  const savedIds = new Set(changes.saved.map(({ id }) => id));
  const deleted = new Set(changes.deleted);
  state.tournaments = [
    ...[...changes.saved].reverse(),
    ...state.tournaments.filter(({ id }) => !savedIds.has(id) && !deleted.has(id)),
  ];
  const reattributed = changes.activityUniverseIds ?? {};
  state.activity = [
    ...state.activity.map(event => {
      if (!(event.id in reattributed)) return event;
      const { universeId: _old, ...rest } = event;
      void _old;
      const universeId = reattributed[event.id];
      return universeId === null ? rest : { ...rest, universeId };
    }),
    ...changes.events,
  ];
  if (changes.activeTournament) state.activeTournamentId = changes.activeTournament.id;
  if (changes.universes) state.universes = changes.universes;
  state.libraryVersion += 1;
}

export function createFakeLibraryServer(initial: Partial<FakeLibraryState> = {}): FakeLibraryServer {
  const state: FakeLibraryState = {
    tournaments: [],
    activity: [],
    activeTournamentId: null,
    universes: emptySportsUniverseLibrary(),
    libraryVersion: 0,
    ...initial,
  };
  const operations: string[] = [];
  const commits: unknown[] = [];
  let pendingFailure: Error | null = null;
  let cookieValid = true;

  function library(query: string, variables: GraphqlVariables = {}): unknown {
    if (query.includes("librarySnapshot")) {
      operations.push("librarySnapshot");
      return { librarySnapshot: structuredClone({ ...state, versions: {} }) };
    }
    if (query.includes("commitLibraryChanges")) {
      operations.push("commitLibraryChanges");
      commits.push(structuredClone(variables.changes));
      const expected = variables.expectedLibraryVersion as number;
      if (expected !== state.libraryVersion) {
        throw new ApiConflictError("La biblioteca cambió.", "CONFLICT", {
          code: "CONFLICT", expectedLibraryVersion: expected, currentLibraryVersion: state.libraryVersion,
        });
      }
      let normalized;
      try {
        normalized = validateLibraryChanges(variables.changes, state);
      } catch (error) {
        throw new ApiValidationError((error as Error).message, "VALIDATION", { code: "VALIDATION" });
      }
      apply(state, normalized);
      return { commitLibraryChanges: { committed: true, libraryVersion: state.libraryVersion } };
    }
    if (query.includes("restoreBackup")) {
      operations.push(`restoreBackup:${String(variables.mode)}`);
      const expected = variables.expectedLibraryVersion as number | undefined;
      if (expected !== undefined && expected !== state.libraryVersion) {
        throw new ApiConflictError("La biblioteca cambió.", "CONFLICT", { code: "CONFLICT" });
      }
      const repository = new InMemoryTournamentRepository({
        tournaments: [...state.tournaments], activity: [...state.activity],
        activeTournamentId: state.activeTournamentId, universes: state.universes,
      });
      const result = restoreTournamentBackup(String(variables.backup), variables.mode === "REPLACE" ? "replace" : "merge", repository);
      state.tournaments = repository.findAll();
      state.activity = repository.findActivity();
      state.activeTournamentId = repository.getActiveTournamentId();
      state.universes = repository.getSportsUniverseLibrary();
      state.libraryVersion += 1;
      return { restoreBackup: { ...result, libraryVersion: state.libraryVersion } };
    }
    if (query.includes("library")) {
      operations.push("library");
      return { library: { libraryVersion: state.libraryVersion, activeTournamentId: state.activeTournamentId } };
    }
    throw new ApiValidationError(`Operación no soportada por el servidor falso: ${query}`, "VALIDATION");
  }

  function respond(query: string, variables?: GraphqlVariables): unknown {
    if (pendingFailure) {
      const failure = pendingFailure;
      pendingFailure = null;
      throw failure;
    }
    return library(query, variables);
  }

  const payload = () => ({ accessToken: "jwt-sesion", accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(), user });

  const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables?: GraphqlVariables };
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    const fail = (error: ApiError) => json({ data: null, errors: [{ message: error.message, extensions: { ...error.extensions, code: error.code } }] });
    try {
      if (query.includes("refreshToken")) {
        operations.push("refreshToken");
        return cookieValid ? json({ data: { refreshToken: payload() } }) : fail(new ApiUnauthenticatedError("Sesión inválida.", "UNAUTHENTICATED"));
      }
      if (query.includes("login(") || query.includes("register(")) {
        cookieValid = true;
        const operation = query.includes("login(") ? "login" : "register";
        operations.push(operation);
        return json({ data: { [operation]: payload() } });
      }
      if (query.includes("logout")) { operations.push("logout"); cookieValid = false; return json({ data: { logout: true } }); }
      return json({ data: respond(query, variables) });
    } catch (error) {
      if (error instanceof ApiNetworkError) throw new TypeError("Failed to fetch");
      if (error instanceof ApiError) return fail(error);
      throw error;
    }
  };

  return {
    state,
    operations,
    commits,
    failNext(error) { pendingFailure = error; },
    externalWrite(change) { change(state); state.libraryVersion += 1; },
    api: {
      async request<T>(query: string, variables?: GraphqlVariables): Promise<T> {
        return structuredClone(respond(query, variables)) as T;
      },
    },
    fetch: fetchImpl as typeof fetch,
  };
}

export const fakeSessionUser = user;
