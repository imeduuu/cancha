import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createOfficialSourceProxy,
  officialSourceTargets,
  type OfficialSourceTargets,
} from "@cancha/official-source-proxy";
import type { ApiEnvironment } from "../config/env.validation.js";
import { OfficialSourcesController } from "./official-sources.controller.js";
import { OFFICIAL_SOURCE_PROXY, OFFICIAL_SOURCE_TARGETS } from "./official-sources.tokens.js";

/**
 * Proxy cerrado de ANFP, ANFA, Copa Argentina y CBF (fase 6). Caché y rate
 * limit en memoria: valen por instancia (ver docs/official-source-proxy.md).
 */
@Module({
  controllers: [OfficialSourcesController],
  providers: [
    { provide: OFFICIAL_SOURCE_TARGETS, useValue: officialSourceTargets },
    {
      provide: OFFICIAL_SOURCE_PROXY,
      inject: [ConfigService, OFFICIAL_SOURCE_TARGETS],
      useFactory: (config: ConfigService<ApiEnvironment, true>, targets: OfficialSourceTargets) => createOfficialSourceProxy({
        targets,
        timeoutMs: config.get("OFFICIAL_SOURCE_TIMEOUT_MS", { infer: true }),
        maxResponseBytes: config.get("OFFICIAL_SOURCE_MAX_BYTES", { infer: true }),
        cacheTtlMs: config.get("OFFICIAL_SOURCE_CACHE_TTL_SECONDS", { infer: true }) * 1000,
        cacheMaxEntries: config.get("OFFICIAL_SOURCE_CACHE_MAX_ENTRIES", { infer: true }),
        cacheMaxBytes: config.get("OFFICIAL_SOURCE_CACHE_MAX_BYTES", { infer: true }),
        rateLimit: config.get("OFFICIAL_SOURCE_RATE_LIMIT", { infer: true }),
        rateWindowMs: config.get("OFFICIAL_SOURCE_RATE_TTL_SECONDS", { infer: true }) * 1000,
      }),
    },
  ],
})
export class OfficialSourcesModule {}
