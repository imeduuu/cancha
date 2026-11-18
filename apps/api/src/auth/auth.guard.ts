import {
  createParamDecorator,
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { GqlExecutionContext, type GqlContextType } from "@nestjs/graphql";
import type { Request, Response } from "express";
import { AuthenticationError } from "./auth.errors.js";
import { AuthService, type SessionUser } from "./auth.service.js";

const isPublicKey = "cancha:isPublic";

/** Marca una operación o controlador que no exige sesión (health, register, login, refreshToken). */
export const Public = () => SetMetadata(isPublicKey, true);

export type AuthenticatedRequest = Request & { user?: SessionUser };

/** Petición y respuesta de Express, sea la operación GraphQL o HTTP. */
export function httpOf(context: ExecutionContext): { req: AuthenticatedRequest; res: Response } {
  if (context.getType<GqlContextType>() === "graphql") {
    const { req, res } = GqlExecutionContext.create(context).getContext<{ req: AuthenticatedRequest; res: Response }>();
    return { req, res };
  }
  const http = context.switchToHttp();
  return { req: http.getRequest<AuthenticatedRequest>(), res: http.getResponse<Response>() };
}

/** Usuario de la sesión (lo deja AuthGuard). Nunca viene de un argumento del cliente. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): SessionUser => {
  const user = httpOf(context).req.user;
  if (!user) throw new AuthenticationError();
  return user;
});

function bearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== "string") return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

/**
 * Guard global (APP_GUARD): toda operación exige un access token válido de una
 * sesión activa, salvo las marcadas con @Public().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(isPublicKey, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const { req } = httpOf(context);
    req.user = await this.auth.authenticate(bearerToken(req));
    return true;
  }
}
