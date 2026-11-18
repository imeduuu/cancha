import { describe, expect, it } from "vitest";
import { emailIssue, normalizeEmail, passwordIssue, validateRegistration } from "./credentials.js";

describe("credenciales", () => {
  it("normaliza el email: sin espacios alrededor y en minúsculas", () => {
    expect(normalizeEmail("  Ana.Perez@Ejemplo.CL ")).toBe("ana.perez@ejemplo.cl");
  });

  it.each([
    ["", "El email es obligatorio."],
    ["sin-arroba.cl", "El email no tiene un formato válido."],
    ["a@b", "El email no tiene un formato válido."],
    ["a b@c.cl", "El email no tiene un formato válido."],
    ["a@@c.cl", "El email no tiene un formato válido."],
    [`${"a".repeat(250)}@c.cl`, "El email no puede superar 254 caracteres."],
  ])("rechaza el email %j", (email, message) => {
    expect(emailIssue(email)).toBe(message);
  });

  it("acepta emails habituales", () => {
    expect(emailIssue("ana+cancha@sub.ejemplo.cl")).toBeUndefined();
  });

  it("exige entre 12 y 256 caracteres de contraseña, contados como caracteres", () => {
    expect(passwordIssue("corta")).toBe("La contraseña debe tener al menos 12 caracteres.");
    expect(passwordIssue("a".repeat(12))).toBeUndefined();
    expect(passwordIssue("⚽".repeat(12))).toBeUndefined();
    expect(passwordIssue("a".repeat(257))).toBe("La contraseña no puede superar 256 caracteres.");
  });

  it("validateRegistration devuelve el email normalizado o lanza el primer problema", () => {
    expect(validateRegistration(" Ana@Ejemplo.cl ", "contraseña segura")).toBe("ana@ejemplo.cl");
    expect(() => validateRegistration("ana", "contraseña segura")).toThrow("El email no tiene un formato válido.");
    expect(() => validateRegistration("ana@ejemplo.cl", "corta")).toThrow(/al menos 12/);
  });
});
