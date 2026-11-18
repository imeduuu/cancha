import type { CookieOptions, Request, Response } from "express";
import type { ApiEnvironment } from "../config/env.validation.js";
import { ForbiddenOriginError } from "./auth.errors.js";

/** Cookie del refresh token: HttpOnly, sólo para /graphql. */
export const refreshCookieName = "cancha_refresh";
export const refreshCookiePath = "/graphql";

type CookieEnvironment = Pick<ApiEnvironment, "AUTH_COOKIE_SAMESITE" | "AUTH_COOKIE_SECURE">;

function baseOptions(env: CookieEnvironment): CookieOptions {
  return {
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: env.AUTH_COOKIE_SAMESITE,
    path: refreshCookiePath,
  };
}

export function setRefreshCookie(response: Response, env: CookieEnvironment, token: string, expiresAt: Date): void {
  response.cookie(refreshCookieName, token, { ...baseOptions(env), expires: expiresAt });
}

export function clearRefreshCookie(response: Response, env: CookieEnvironment): void {
  response.clearCookie(refreshCookieName, baseOptions(env));
}

export function readRefreshCookie(request: Request): string | undefined {
  const value: unknown = (request.cookies as Record<string, unknown> | undefined)?.[refreshCookieName];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Defensa adicional contra CSRF en las operaciones que usan la cookie: si el
 * navegador declara un Origin, debe estar en CORS_ORIGINS. (Sin Origin, la
 * petición no viene de un navegador entre sitios: curl, pruebas, mismo origen.)
 */
export function assertAllowedOrigin(request: Request, allowed: readonly string[]): void {
  const origin = request.headers.origin;
  if (origin !== undefined && !allowed.includes(origin)) throw new ForbiddenOriginError();
}
