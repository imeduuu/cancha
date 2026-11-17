import { describe, expect, it } from "vitest";
import { validateEnvironment } from "./env.validation.js";

const uri = "mongodb://localhost:27017/?replicaSet=rs0&directConnection=true";

describe("validateEnvironment", () => {
  it("aplica valores por defecto y conserva la URI", () => {
    expect(validateEnvironment({ MONGODB_URI: uri })).toEqual({
      NODE_ENV: "development",
      PORT: 3000,
      MONGODB_URI: uri,
      MONGODB_DB: "cancha",
    });
  });

  it("convierte PORT a número y acepta mongodb+srv", () => {
    const env = validateEnvironment({
      NODE_ENV: "production", PORT: " 8080 ", MONGODB_URI: "mongodb+srv://cluster.example.net", MONGODB_DB: "cancha_prod",
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
});
