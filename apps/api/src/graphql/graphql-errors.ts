import { unwrapResolverError } from "@apollo/server/errors";
import { Logger } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { AuthenticationError, ForbiddenOriginError } from "../auth/auth.errors.js";
import { GraphQLError, type GraphQLFormattedError } from "graphql";
import { NotFoundError } from "../library/library-unit-of-work.js";
import {
  LibraryVersionConflictError,
  TournamentVersionConflictError,
} from "../infrastructure/persistence/mongo-tournament-repository.js";

/** Códigos de `extensions.code` que define esta API (además de los de Apollo). */
export const apiErrorCodes = {
  validation: "VALIDATION",
  notFound: "NOT_FOUND",
  conflict: "CONFLICT",
  unauthenticated: "UNAUTHENTICATED",
  forbidden: "FORBIDDEN",
  tooManyRequests: "TOO_MANY_REQUESTS",
  internal: "INTERNAL_SERVER_ERROR",
} as const;

const internalMessage = "Error interno del servidor.";
const logger = new Logger("GraphQL");

function withoutStacktrace(extensions: GraphQLFormattedError["extensions"]): Record<string, unknown> {
  const { stacktrace, ...rest } = extensions ?? {};
  void stacktrace;
  return rest;
}

/**
 * Traduce los errores de los resolvers a errores GraphQL tipados:
 * - conflictos de versión ⇒ CONFLICT con la versión vigente;
 * - NotFoundError ⇒ NOT_FOUND;
 * - sin sesión válida ⇒ UNAUTHENTICATED; origen no permitido ⇒ FORBIDDEN;
 * - rate limit superado ⇒ TOO_MANY_REQUESTS;
 * - `Error` simple (errores de dominio y casos de uso de core, en español) ⇒ VALIDATION;
 * - errores de GraphQL/Apollo (consulta o argumentos inválidos) ⇒ se conservan;
 * - cualquier otro (TypeError, fallo de Mongo…) ⇒ INTERNAL_SERVER_ERROR genérico y se registra.
 * Fuera de desarrollo nunca se devuelve `stacktrace`.
 */
export function createFormatError(development: boolean) {
  return (formatted: GraphQLFormattedError, error: unknown): GraphQLFormattedError => {
    const original = unwrapResolverError(error);
    const base = development ? { ...formatted.extensions } : withoutStacktrace(formatted.extensions);
    const as = (code: string, message: string, extra: Record<string, unknown> = {}): GraphQLFormattedError => ({
      ...formatted,
      message,
      extensions: { ...base, ...extra, code },
    });

    if (original instanceof TournamentVersionConflictError) {
      return as(apiErrorCodes.conflict, original.message, {
        tournamentId: original.tournamentId,
        expectedVersion: original.expectedVersion,
        currentVersion: original.actualVersion,
      });
    }
    if (original instanceof LibraryVersionConflictError) {
      return as(apiErrorCodes.conflict, original.message, {
        expectedLibraryVersion: original.expectedVersion,
        currentLibraryVersion: original.actualVersion,
      });
    }
    if (original instanceof NotFoundError) return as(apiErrorCodes.notFound, original.message);
    if (original instanceof AuthenticationError) return as(apiErrorCodes.unauthenticated, original.message);
    if (original instanceof ForbiddenOriginError) return as(apiErrorCodes.forbidden, original.message);
    if (original instanceof ThrottlerException) return as(apiErrorCodes.tooManyRequests, original.message);
    if (original instanceof GraphQLError) return { ...formatted, extensions: base };
    if (original instanceof Error && original.constructor === Error) {
      return as(apiErrorCodes.validation, original.message);
    }
    logger.error(
      original instanceof Error ? original.message : String(original),
      original instanceof Error ? original.stack : undefined,
    );
    return as(apiErrorCodes.internal, internalMessage);
  };
}
