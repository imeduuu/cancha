import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerModule } from "@nestjs/throttler";
import type { ApiEnvironment } from "../config/env.validation.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthResolver } from "./auth.resolver.js";
import { accessTokenTtlSeconds, AuthService } from "./auth.service.js";
import { authThrottlerName, GqlThrottlerGuard } from "./gql-throttler.guard.js";

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnvironment, true>) => ({
        secret: config.get("JWT_ACCESS_SECRET", { infer: true }),
        signOptions: { algorithm: "HS256", expiresIn: accessTokenTtlSeconds },
        verifyOptions: { algorithms: ["HS256"] },
      }),
    }),
    // Almacenamiento en memoria: vale para una instancia. Con varias, usar un
    // ThrottlerStorage compartido (p. ej. Redis).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnvironment, true>) => ({
        throttlers: [{
          name: authThrottlerName,
          limit: config.get("AUTH_RATE_LIMIT", { infer: true }),
          ttl: config.get("AUTH_RATE_TTL_SECONDS", { infer: true }) * 1000,
        }],
        errorMessage: "Demasiados intentos. Espera un momento y vuelve a intentarlo.",
      }),
    }),
  ],
  providers: [AuthService, AuthResolver, GqlThrottlerGuard, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
