import { Injectable, type ExecutionContext } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { httpOf } from "./auth.guard.js";

/** Nombre del throttler de las operaciones públicas de autenticación. */
export const authThrottlerName = "auth";

/**
 * ThrottlerGuard para resolvers GraphQL: toma req/res del contexto de Apollo.
 * Cuenta por IP (`req.ip`, que respeta TRUST_PROXY) y por operación.
 */
@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  protected override getRequestResponse(context: ExecutionContext): { req: Record<string, any>; res: Record<string, any> } {
    return httpOf(context);
  }
}
