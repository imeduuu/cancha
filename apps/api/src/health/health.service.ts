import { readFileSync } from "node:fs";
import { Inject, Injectable } from "@nestjs/common";
import type { Db } from "mongodb";
import { MONGO_DATABASE } from "../database/database.tokens.js";

export interface HealthReport {
  readonly status: "ok" | "error";
  readonly app: { readonly status: "up"; readonly version: string; readonly uptimeSeconds: number };
  readonly mongo:
    | { readonly status: "up"; readonly latencyMs: number }
    | { readonly status: "down"; readonly error: string };
}

/** Lo mínimo que necesita el chequeo: `Db` lo cumple y las pruebas lo simulan. */
export type PingableDatabase = Pick<Db, "command">;

const appVersion = (JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string }).version;

export const mongoPingTimeoutMs = 2_000;

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(@Inject(MONGO_DATABASE) private readonly database: PingableDatabase) {}

  async check(): Promise<HealthReport> {
    const app = {
      status: "up" as const,
      version: appVersion,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    };
    const started = performance.now();
    try {
      await withTimeout(this.database.command({ ping: 1 }), mongoPingTimeoutMs);
      return { status: "ok", app, mongo: { status: "up", latencyMs: Math.round(performance.now() - started) } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: "error", app, mongo: { status: "down", error: message } };
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`MongoDB no respondió al ping en ${ms} ms.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
