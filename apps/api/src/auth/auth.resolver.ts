import { Inject, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Args, Context, Mutation, Query, Resolver } from "@nestjs/graphql";
import type { Request, Response } from "express";
import type { ApiEnvironment } from "../config/env.validation.js";
import { CurrentUser, Public } from "./auth.guard.js";
import { AuthPayloadModel, CredentialsInput, UserModel } from "./auth.models.js";
import { AuthService, type AuthUser, type IssuedSession, type SessionUser } from "./auth.service.js";
import { GqlThrottlerGuard } from "./gql-throttler.guard.js";
import { assertAllowedOrigin, clearRefreshCookie, readRefreshCookie, setRefreshCookie } from "./refresh-cookie.js";

interface HttpContext { req: Request; res: Response }

function toUserModel(user: AuthUser): UserModel {
  return { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() };
}

/** Registro, login, rotación del refresh token, logout y `me`. */
@Resolver()
export class AuthResolver {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService<ApiEnvironment, true>,
  ) {}

  @Public()
  @UseGuards(GqlThrottlerGuard)
  @Mutation(() => AuthPayloadModel, { description: "Crea una cuenta e inicia sesión." })
  async register(
    @Args("input", { type: () => CredentialsInput }) input: CredentialsInput,
    @Context() context: HttpContext,
  ): Promise<AuthPayloadModel> {
    return this.respond(context, await this.auth.register(input.email, input.password));
  }

  @Public()
  @UseGuards(GqlThrottlerGuard)
  @Mutation(() => AuthPayloadModel, { description: "Inicia una sesión nueva." })
  async login(
    @Args("input", { type: () => CredentialsInput }) input: CredentialsInput,
    @Context() context: HttpContext,
  ): Promise<AuthPayloadModel> {
    return this.respond(context, await this.auth.login(input.email, input.password));
  }

  @Public()
  @UseGuards(GqlThrottlerGuard)
  @Mutation(() => AuthPayloadModel, {
    description: "Canjea la cookie del refresh token (de un solo uso) por un access token nuevo y la rota.",
  })
  async refreshToken(@Context() context: HttpContext): Promise<AuthPayloadModel> {
    assertAllowedOrigin(context.req, this.config.get("CORS_ORIGINS", { infer: true }));
    try {
      return this.respond(context, await this.auth.refresh(readRefreshCookie(context.req)));
    } catch (error) {
      clearRefreshCookie(context.res, this.cookieEnvironment());
      throw error;
    }
  }

  @Mutation(() => Boolean, { description: "Cierra la sesión actual: revoca sus refresh tokens y su access token." })
  async logout(@CurrentUser() user: SessionUser, @Context() context: HttpContext): Promise<boolean> {
    assertAllowedOrigin(context.req, this.config.get("CORS_ORIGINS", { infer: true }));
    await this.auth.logout(user.sessionId);
    clearRefreshCookie(context.res, this.cookieEnvironment());
    return true;
  }

  @Query(() => UserModel, { description: "Usuario de la sesión actual." })
  async me(@CurrentUser() user: SessionUser): Promise<UserModel> {
    return toUserModel(await this.auth.findUser(user.id));
  }

  private respond(context: HttpContext, issued: IssuedSession): AuthPayloadModel {
    setRefreshCookie(context.res, this.cookieEnvironment(), issued.refreshToken, issued.refreshTokenExpiresAt);
    return {
      accessToken: issued.accessToken,
      accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
      user: toUserModel(issued.user),
    };
  }

  private cookieEnvironment() {
    return {
      AUTH_COOKIE_SAMESITE: this.config.get("AUTH_COOKIE_SAMESITE", { infer: true }),
      AUTH_COOKIE_SECURE: this.config.get("AUTH_COOKIE_SECURE", { infer: true }),
    };
  }
}
