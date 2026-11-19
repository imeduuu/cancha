import { describe, expect, it } from "vitest";
import { developmentCorsOrigins, developmentJwtSecret, validateEnvironment } from "./env.validation.js";

const uri = "mongodb://localhost:27017/?replicaSet=rs0&directConnection=true";
const productionSecret = "s".repeat(32);
const production = { NODE_ENV: "production", JWT_ACCESS_SECRET: productionSecret, CORS_ORIGINS: "https://cancha.example.cl" };

describe("validateEnvironment", () => {
  it("aplica valores por defecto y conserva la URI", () => {
    expect(validateEnvironment({ MONGODB_URI: uri })).toEqual({
      NODE_ENV: "development",
      PORT: 3000,
      MONGODB_URI: uri,
      MONGODB_DB: "cancha",
      JWT_ACCESS_SECRET: developmentJwtSecret,
      CORS_ORIGINS: [...developmentCorsOrigins],
      AUTH_COOKIE_SAMESITE: "lax",
      AUTH_COOKIE_SECURE: true,
      REFRESH_TOKEN_TTL_DAYS: 30,
      AUTH_RATE_LIMIT: 10,
      AUTH_RATE_TTL_SECONDS: 60,
      TRUST_PROXY: 0,
      LOG_CLIENT_IP: false,
      OFFICIAL_SOURCE_TIMEOUT_MS: 20_000,
      OFFICIAL_SOURCE_MAX_BYTES: 5 * 1024 * 1024,
      OFFICIAL_SOURCE_CACHE_TTL_SECONDS: 600,
      OFFICIAL_SOURCE_CACHE_MAX_ENTRIES: 200,
      OFFICIAL_SOURCE_CACHE_MAX_BYTES: 64 * 1024 * 1024,
      OFFICIAL_SOURCE_RATE_LIMIT: 300,
      OFFICIAL_SOURCE_RATE_TTL_SECONDS: 60,
    });
  });

  it("convierte PORT a número y acepta mongodb+srv", () => {
    const env = validateEnvironment({
      ...production, PORT: " 8080 ", MONGODB_URI: "mongodb+srv://cluster.example.net", MONGODB_DB: "cancha_prod",
    });
    expect(env.PORT).toBe(8080);
    expect(env.NODE_ENV).toBe("production");
    expect(env.MONGODB_DB).toBe("cancha_prod");
  });

  it("exige MONGODB_URI", () => {
    expect(() => validateEnvironment({})).toThrow(/MONGODB_URI es obligatoria/);
    expect(() => validateEnvironment({ MONGODB_URI: "   " })).toThrow(/MONGODB_URI es obligatoria/);
  });

  it("rechaza esquemas de URI que no son de MongoDB", () => {
    expect(() => validateEnvironment({ MONGODB_URI: "http://localhost:27017" }))
      .toThrow(/debe comenzar con mongodb:\/\//);
  });

  it.each(["0", "70000", "3.5", "abc"])("rechaza PORT=%s", port => {
    expect(() => validateEnvironment({ MONGODB_URI: uri, PORT: port })).toThrow(/PORT debe ser un entero/);
  });

  it("rechaza NODE_ENV desconocido y nombres de base inválidos", () => {
    expect(() => validateEnvironment({ MONGODB_URI: uri, NODE_ENV: "staging" })).toThrow(/NODE_ENV debe ser/);
    expect(() => validateEnvironment({ MONGODB_URI: uri, MONGODB_DB: "can.cha" })).toThrow(/MONGODB_DB no es/);
  });

  it("informa todos los problemas a la vez", () => {
    let message = "";
    try { validateEnvironment({ PORT: "-1", NODE_ENV: "qa" }); }
    catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/^Configuración inválida de la API:/);
    expect(message.split("\n- ")).toHaveLength(4);
  });

  describe("autenticación y CORS", () => {
    it("en producción exige JWT_ACCESS_SECRET y CORS_ORIGINS, y rechaza el secreto de desarrollo", () => {
      expect(() => validateEnvironment({ MONGODB_URI: uri, NODE_ENV: "production" }))
        .toThrow(/JWT_ACCESS_SECRET es obligatoria en producción[\s\S]*CORS_ORIGINS es obligatoria en producción/);
      expect(() => validateEnvironment({ ...production, MONGODB_URI: uri, JWT_ACCESS_SECRET: developmentJwtSecret }))
        .toThrow(/no puede ser el valor de desarrollo/);
      expect(validateEnvironment({ ...production, MONGODB_URI: uri }).JWT_ACCESS_SECRET).toBe(productionSecret);
    });

    it("exige al menos 32 caracteres de secreto en cualquier entorno", () => {
      expect(() => validateEnvironment({ MONGODB_URI: uri, JWT_ACCESS_SECRET: "corto" }))
        .toThrow(/al menos 32 caracteres/);
    });

    it("normaliza la lista de orígenes y rechaza los que tienen ruta, barra final o esquema inválido", () => {
      const env = validateEnvironment({ MONGODB_URI: uri, CORS_ORIGINS: " https://a.example.cl , http://localhost:4179 " });
      expect(env.CORS_ORIGINS).toEqual(["https://a.example.cl", "http://localhost:4179"]);
      expect(() => validateEnvironment({ MONGODB_URI: uri, CORS_ORIGINS: "https://a.example.cl/,ftp://b.cl,https://c.cl/app" }))
        .toThrow(/inválidos: https:\/\/a\.example\.cl\/, ftp:\/\/b\.cl, https:\/\/c\.cl\/app/);
    });

    it("valida SameSite y Secure de la cookie", () => {
      expect(validateEnvironment({ MONGODB_URI: uri, AUTH_COOKIE_SAMESITE: "None" }).AUTH_COOKIE_SAMESITE).toBe("none");
      expect(() => validateEnvironment({ MONGODB_URI: uri, AUTH_COOKIE_SAMESITE: "relaxed" })).toThrow(/AUTH_COOKIE_SAMESITE debe ser/);
      expect(() => validateEnvironment({ MONGODB_URI: uri, AUTH_COOKIE_SAMESITE: "none", AUTH_COOKIE_SECURE: "false" }))
        .toThrow(/exige AUTH_COOKIE_SECURE=true/);
      expect(() => validateEnvironment({ ...production, MONGODB_URI: uri, AUTH_COOKIE_SECURE: "false" }))
        .toThrow(/no puede ser false en producción/);
      expect(() => validateEnvironment({ MONGODB_URI: uri, AUTH_COOKIE_SECURE: "si" })).toThrow(/true o false/);
      expect(validateEnvironment({ MONGODB_URI: uri, AUTH_COOKIE_SECURE: "false" }).AUTH_COOKIE_SECURE).toBe(false);
    });

    it("valida los enteros de sesión, rate limit y proxy", () => {
      const env = validateEnvironment({
        MONGODB_URI: uri, REFRESH_TOKEN_TTL_DAYS: "7", AUTH_RATE_LIMIT: "3", AUTH_RATE_TTL_SECONDS: "10", TRUST_PROXY: "1",
      });
      expect(env).toMatchObject({ REFRESH_TOKEN_TTL_DAYS: 7, AUTH_RATE_LIMIT: 3, AUTH_RATE_TTL_SECONDS: 10, TRUST_PROXY: 1 });
      expect(() => validateEnvironment({ MONGODB_URI: uri, AUTH_RATE_LIMIT: "0" })).toThrow(/AUTH_RATE_LIMIT debe ser un entero/);
      expect(() => validateEnvironment({ MONGODB_URI: uri, REFRESH_TOKEN_TTL_DAYS: "1.5" })).toThrow(/REFRESH_TOKEN_TTL_DAYS/);
    });

    // Express acepta true, "loopback" o listas de IPs; aquí sólo un número de saltos.
    // `true` confiaría en cualquier X-Forwarded-For y permitiría falsificar la IP del rate limit.
    it.each(["true", "false", "loopback", "10.0.0.1", "-1", "11", "1.5"])("rechaza TRUST_PROXY=%s", value => {
      expect(() => validateEnvironment({ MONGODB_URI: uri, TRUST_PROXY: value })).toThrow(/TRUST_PROXY debe ser un entero entre 0 y 10/);
    });
  });

  describe("valores de plantilla o de desarrollo en producción", () => {
    it("rechaza la cadena de Atlas sin completar sin repetir la URI (puede tener la contraseña)", () => {
      const atlas = "mongodb+srv://cancha:<db_password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority";
      let message = "";
      try { validateEnvironment({ ...production, MONGODB_URI: atlas }); }
      catch (error) { message = (error as Error).message; }
      expect(message).toMatch(/MONGODB_URI todavía tiene un marcador/);
      expect(message).not.toContain("cluster0");
      expect(() => validateEnvironment({ MONGODB_URI: "mongodb+srv://REEMPLAZAR.mongodb.net" })).toThrow(/MONGODB_URI todavía tiene un marcador/);
    });

    it("rechaza un JWT_ACCESS_SECRET que sigue siendo el marcador", () => {
      expect(() => validateEnvironment({ ...production, MONGODB_URI: uri, JWT_ACCESS_SECRET: "<REEMPLAZAR-con-un-secreto-aleatorio-largo>" }))
        .toThrow(/JWT_ACCESS_SECRET todavía es un marcador/);
    });

    it.each([
      ["http://cancha.example.cl", /sólo admite orígenes https públicos/],
      ["https://localhost:5173", /sólo admite orígenes https públicos/],
      ["https://cancha.example.cl,http://127.0.0.1:5173", /inválidos: http:\/\/127\.0\.0\.1:5173\)/],
      ["https://REEMPLAZAR-URL-DE-LA-WEB.vercel.app", /CORS_ORIGINS todavía tiene un marcador/],
    ])("en producción rechaza CORS_ORIGINS=%s", (origins, message) => {
      expect(() => validateEnvironment({ ...production, MONGODB_URI: uri, CORS_ORIGINS: origins })).toThrow(message);
    });

    it("fuera de producción conserva los orígenes http locales", () => {
      expect(validateEnvironment({ MONGODB_URI: uri, CORS_ORIGINS: "http://localhost:4179" }).CORS_ORIGINS).toEqual(["http://localhost:4179"]);
    });

    it("acepta una configuración de producción completa (Vercel + Render + Atlas)", () => {
      const env = validateEnvironment({
        ...production,
        MONGODB_URI: "mongodb+srv://cancha:s3cr3t@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority",
        CORS_ORIGINS: "https://cancha.vercel.app,https://cancha.example.cl",
        TRUST_PROXY: "2",
      });
      expect(env).toMatchObject({ NODE_ENV: "production", TRUST_PROXY: 2, LOG_CLIENT_IP: false, AUTH_COOKIE_SECURE: true });
    });
  });

  describe("LOG_CLIENT_IP", () => {
    it("está desactivado por defecto y sólo acepta true o false", () => {
      expect(validateEnvironment({ MONGODB_URI: uri }).LOG_CLIENT_IP).toBe(false);
      expect(validateEnvironment({ MONGODB_URI: uri, LOG_CLIENT_IP: "true" }).LOG_CLIENT_IP).toBe(true);
      expect(() => validateEnvironment({ MONGODB_URI: uri, LOG_CLIENT_IP: "1" })).toThrow(/LOG_CLIENT_IP debe ser true o false/);
    });
  });

  describe("proxy de fuentes oficiales", () => {
    it("convierte las variables y permite desactivar la caché con TTL 0", () => {
      const env = validateEnvironment({
        MONGODB_URI: uri,
        OFFICIAL_SOURCE_TIMEOUT_MS: "5000",
        OFFICIAL_SOURCE_MAX_BYTES: "2097152",
        OFFICIAL_SOURCE_CACHE_TTL_SECONDS: "0",
        OFFICIAL_SOURCE_CACHE_MAX_ENTRIES: "50",
        OFFICIAL_SOURCE_CACHE_MAX_BYTES: "16777216",
        OFFICIAL_SOURCE_RATE_LIMIT: "20",
        OFFICIAL_SOURCE_RATE_TTL_SECONDS: "30",
      });
      expect(env).toMatchObject({
        OFFICIAL_SOURCE_TIMEOUT_MS: 5000,
        OFFICIAL_SOURCE_MAX_BYTES: 2_097_152,
        OFFICIAL_SOURCE_CACHE_TTL_SECONDS: 0,
        OFFICIAL_SOURCE_CACHE_MAX_ENTRIES: 50,
        OFFICIAL_SOURCE_CACHE_MAX_BYTES: 16_777_216,
        OFFICIAL_SOURCE_RATE_LIMIT: 20,
        OFFICIAL_SOURCE_RATE_TTL_SECONDS: 30,
      });
    });

    it.each([
      ["OFFICIAL_SOURCE_TIMEOUT_MS", "500"],
      ["OFFICIAL_SOURCE_MAX_BYTES", String(65 * 1024 * 1024)],
      ["OFFICIAL_SOURCE_CACHE_TTL_SECONDS", "-1"],
      ["OFFICIAL_SOURCE_CACHE_MAX_ENTRIES", "0"],
      ["OFFICIAL_SOURCE_CACHE_MAX_BYTES", "1000"],
      ["OFFICIAL_SOURCE_RATE_LIMIT", "0"],
      ["OFFICIAL_SOURCE_RATE_TTL_SECONDS", "abc"],
    ])("rechaza %s=%s", (name, value) => {
      expect(() => validateEnvironment({ MONGODB_URI: uri, [name]: value })).toThrow(new RegExp(`${name} debe ser un entero`));
    });
  });
});
