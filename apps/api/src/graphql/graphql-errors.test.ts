import { GraphQLError, type GraphQLFormattedError } from "graphql";
import { describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { AuthenticationError, ForbiddenOriginError } from "../auth/auth.errors.js";
import {
  LibraryVersionConflictError,
  TournamentVersionConflictError,
} from "../infrastructure/persistence/mongo-tournament-repository.js";
import { NotFoundError } from "../library/library-unit-of-work.js";
import { createFormatError } from "./graphql-errors.js";
import { createGraphqlOptions } from "./graphql.module.js";

/** Así llega un error lanzado en un resolver: envuelto en un GraphQLError. */
function fromResolver(error: Error): [GraphQLFormattedError, unknown] {
  const wrapped = new GraphQLError(error.message, { originalError: error, path: ["campo"] });
  return [{ message: error.message, path: ["campo"], extensions: { code: "INTERNAL_SERVER_ERROR", stacktrace: ["at x"] } }, wrapped];
}

describe("createFormatError", () => {
  const production = createFormatError(false);

  it("conflicto de torneo ⇒ CONFLICT con la versión vigente", () => {
    const formatted = production(...fromResolver(new TournamentVersionConflictError("t1", 1, 2, "Liga")));
    expect(formatted.extensions).toEqual({ code: "CONFLICT", tournamentId: "t1", expectedVersion: 1, currentVersion: 2 });
    expect(formatted.message).toMatch(/versión esperada 1, versión actual 2/);
  });

  it("conflicto de biblioteca ⇒ CONFLICT con la versión de biblioteca vigente", () => {
    const formatted = production(...fromResolver(new LibraryVersionConflictError(4, 6)));
    expect(formatted.extensions).toEqual({ code: "CONFLICT", expectedLibraryVersion: 4, currentLibraryVersion: 6 });
  });

  it("NotFoundError ⇒ NOT_FOUND y Error de dominio ⇒ VALIDATION, sin stacktrace", () => {
    expect(production(...fromResolver(new NotFoundError("No está."))).extensions).toEqual({ code: "NOT_FOUND" });
    expect(production(...fromResolver(new Error("Escribe el nombre del campeonato.")))).toEqual({
      message: "Escribe el nombre del campeonato.",
      path: ["campo"],
      extensions: { code: "VALIDATION" },
    });
  });

  it("sesión inválida ⇒ UNAUTHENTICATED, origen ⇒ FORBIDDEN, rate limit ⇒ TOO_MANY_REQUESTS", () => {
    expect(production(...fromResolver(new AuthenticationError("Sin sesión.")))).toMatchObject({
      message: "Sin sesión.", extensions: { code: "UNAUTHENTICATED" },
    });
    expect(production(...fromResolver(new ForbiddenOriginError())).extensions).toEqual({ code: "FORBIDDEN" });
    expect(production(...fromResolver(new ThrottlerException("Demasiados intentos.")))).toMatchObject({
      message: "Demasiados intentos.", extensions: { code: "TOO_MANY_REQUESTS" },
    });
  });

  it("un error inesperado ⇒ INTERNAL_SERVER_ERROR genérico, registrado en el log", () => {
    const log = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    const formatted = production(...fromResolver(new TypeError("Cannot read properties of undefined")));
    expect(formatted).toMatchObject({ message: "Error interno del servidor.", extensions: { code: "INTERNAL_SERVER_ERROR" } });
    expect(JSON.stringify(formatted)).not.toMatch(/Cannot read|stacktrace/);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("conserva los errores de GraphQL y, sólo en desarrollo, el stacktrace", () => {
    const validation = new GraphQLError("Unknown argument", { extensions: { code: "GRAPHQL_VALIDATION_FAILED" } });
    const formatted = { message: "Unknown argument", extensions: { code: "GRAPHQL_VALIDATION_FAILED", stacktrace: ["at y"] } };
    expect(production(formatted, validation).extensions).toEqual({ code: "GRAPHQL_VALIDATION_FAILED" });
    expect(createFormatError(true)(...fromResolver(new Error("Dominio."))).extensions)
      .toEqual({ code: "VALIDATION", stacktrace: ["at x"] });
  });
});

describe("createGraphqlOptions", () => {
  it("GraphiQL, introspección y stack traces sólo en desarrollo", () => {
    expect(createGraphqlOptions("development")).toMatchObject({
      graphiql: true, introspection: true, includeStacktraceInErrorResponses: true,
    });
    for (const environment of ["test", "production"] as const) {
      expect(createGraphqlOptions(environment)).toMatchObject({
        graphiql: false, introspection: false, includeStacktraceInErrorResponses: false,
      });
    }
  });
});
