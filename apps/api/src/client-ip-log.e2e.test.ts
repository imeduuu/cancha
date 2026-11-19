import { Logger } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { startGraphqlApp, type GraphqlTestApp } from "./test-utils/graphql-app.js";

// LOG_CLIENT_IP=true (diagnóstico temporal de TRUST_PROXY, docs/deployment.md):
// cada petición deja una línea con X-Forwarded-For, la IP del socket y req.ip.
// Una app por archivo porque ConfigModule lee process.env al importar.
const log = vi.spyOn(Logger.prototype, "log");
const warn = vi.spyOn(Logger.prototype, "warn");
let api: GraphqlTestApp;
let startupWarnings: string[] = [];

// El contexto de un `new Logger("ClientIp")` vive en la instancia (this), no en los argumentos.
const fromClientIp = (mock: typeof log | typeof warn) => mock.mock.calls
  .filter((_, index) => (mock.mock.contexts[index] as { context?: string } | undefined)?.context === "ClientIp")
  .map(([message]) => String(message));
const diagnostics = () => fromClientIp(log).map(line => JSON.parse(line) as Record<string, unknown>);

beforeAll(async () => {
  api = await startGraphqlApp("client_ip_log", { LOG_CLIENT_IP: "true", TRUST_PROXY: "1" });
  // Se copian aquí: los espías no conservan entre beforeAll y el primer it las llamadas hechas al arrancar.
  startupWarnings = fromClientIp(warn);
});

afterAll(async () => {
  await api?.stop();
  vi.restoreAllMocks();
});

it("avisa al arrancar que se registran IPs", () => {
  expect(startupWarnings).toEqual([expect.stringMatching(/LOG_CLIENT_IP=true.*Desactívalo/)]);
});

it("registra la cadena recibida y la IP que deduce Express con TRUST_PROXY, sin la query", async () => {
  log.mockClear();
  await request(api.app.getHttpServer())
    .get("/health?token=no-debe-aparecer")
    .set("X-Forwarded-For", "203.0.113.9, 198.51.100.7");
  const [line] = diagnostics();
  expect(line).toMatchObject({
    method: "GET",
    path: "/health",
    xForwardedFor: "203.0.113.9, 198.51.100.7",
    trustProxy: 1,
    ip: "198.51.100.7",
    ips: ["198.51.100.7"],
  });
  expect(typeof line.socket).toBe("string");
  expect(JSON.stringify(line)).not.toContain("no-debe-aparecer");
});
