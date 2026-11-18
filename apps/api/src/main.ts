import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { configureApp } from "./bootstrap.js";
import type { ApiEnvironment } from "./config/env.validation.js";

// bodyParser: false para fijar el límite del cuerpo en configureApp.
const app = await NestFactory.create(AppModule, { bodyParser: false });
configureApp(app);
// Cierra el MongoClient al recibir SIGINT/SIGTERM.
app.enableShutdownHooks();
const config = app.get<ConfigService<ApiEnvironment, true>>(ConfigService);
const port = config.get("PORT", { infer: true });
await app.listen(port);
Logger.log(`API de Cancha escuchando en http://localhost:${port} (GET /health, POST /graphql)`, "Bootstrap");
