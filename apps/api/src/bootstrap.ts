import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import type { ApiEnvironment } from "./config/env.validation.js";

/**
 * Límite del cuerpo JSON. Medido: una biblioteca de 10 temporadas × 6
 * competiciones simuladas (60 torneos) exportada con sangría, como la descarga
 * la web, pesa 7,4 MB y 8,2 MB dentro de una variable GraphQL. 32 MB deja ~4×
 * de margen. (El de Nest por defecto, 100 KB, rechazaba respaldos reales.)
 */
export const graphqlBodyLimit = "32mb";

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
  express.set("trust proxy", config.get("TRUST_PROXY", { infer: true }));
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
