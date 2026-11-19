import { Logger, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import type { Request } from "express";
import type { ApiEnvironment } from "./config/env.validation.js";

/**
 * Límite del cuerpo JSON. Medido: una biblioteca de 10 temporadas × 6
 * competiciones simuladas (60 torneos) exportada con sangría, como la descarga
 * la web, pesa 7,4 MB y 8,2 MB dentro de una variable GraphQL. 32 MB deja ~4×
 * de margen. (El de Nest por defecto, 100 KB, rechazaba respaldos reales.)
 */
export const graphqlBodyLimit = "32mb";

/**
 * Línea de diagnóstico de LOG_CLIENT_IP: lo necesario para elegir TRUST_PROXY
 * (la cadena X-Forwarded-For tal como llega, la IP del socket y lo que Express
 * deduce con el valor actual). Sólo la ruta, sin query: no registra parámetros.
 */
export function clientIpDiagnostic(req: Request, trustProxy: number): string {
  return JSON.stringify({
    method: req.method,
    path: req.path,
    xForwardedFor: req.headers["x-forwarded-for"] ?? null,
    socket: req.socket.remoteAddress ?? null,
    trustProxy,
    ips: req.ips,
    ip: req.ip ?? null,
  });
}

/**
 * Configuración HTTP común a main.ts y a las pruebas (crear la app con
 * `bodyParser: false` y llamar a esto antes de `init`/`listen`):
 * CORS con credenciales sólo para CORS_ORIGINS, cuerpo JSON de hasta 32 MB,
 * cookies (refresh token) y `trust proxy` para que el rate limit vea la IP real.
 */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  const config = app.get<ConfigService<ApiEnvironment, true>>(ConfigService);
  const origins = config.get("CORS_ORIGINS", { infer: true });
  // Siempre un número de saltos (env.validation lo exige): Express confía sólo en
  // las últimas N entradas de X-Forwarded-For y req.ip es la anterior a ellas.
  // Nunca `true`, que tomaría la primera entrada (la que escribe el cliente).
  const trustProxy = config.get("TRUST_PROXY", { infer: true });
  express.set("trust proxy", trustProxy);
  if (config.get("LOG_CLIENT_IP", { infer: true })) {
    // Sólo para verificar TRUST_PROXY tras un despliegue (docs/deployment.md):
    // las IPs son datos personales, así que se desactiva al terminar.
    const logger = new Logger("ClientIp");
    logger.warn("LOG_CLIENT_IP=true: se registran IPs de clientes. Desactívalo después de verificar TRUST_PROXY.");
    express.use((req: Request, _res: unknown, next: () => void) => {
      logger.log(clientIpDiagnostic(req, trustProxy));
      next();
    });
  }
  express.enableCors({
    origin: [...origins],
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Apollo-Require-Preflight"],
    maxAge: 600,
  });
  express.useBodyParser("json", { limit: graphqlBodyLimit });
  express.use(cookieParser());
}
