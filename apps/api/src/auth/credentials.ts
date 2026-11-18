/** Mínimo de caracteres de una contraseña nueva. */
export const minimumPasswordLength = 12;
/** Tope de caracteres: evita que una contraseña enorme convierta argon2 en un DoS. */
export const maximumPasswordLength = 256;
/** RFC 5321: una dirección no supera 254 caracteres. */
export const maximumEmailLength = 254;

// Pragmática: algo@dominio.tld, sin espacios ni @ repetidas. La verificación real
// de un email exige enviar un correo, y eso no existe todavía.
const emailPattern = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Forma canónica con que se guarda y busca un email: sin espacios alrededor y en minúsculas. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Primer problema del email normalizado, o undefined si es válido. */
export function emailIssue(email: string): string | undefined {
  if (email === "") return "El email es obligatorio.";
  if (email.length > maximumEmailLength) return `El email no puede superar ${maximumEmailLength} caracteres.`;
  if (!emailPattern.test(email)) return "El email no tiene un formato válido.";
  return undefined;
}

/** Primer problema de una contraseña nueva, o undefined si es válida. */
export function passwordIssue(password: string): string | undefined {
  // Se cuentan caracteres (code points), no unidades UTF-16.
  const length = [...password].length;
  if (length < minimumPasswordLength) {
    return `La contraseña debe tener al menos ${minimumPasswordLength} caracteres.`;
  }
  if (length > maximumPasswordLength) {
    return `La contraseña no puede superar ${maximumPasswordLength} caracteres.`;
  }
  return undefined;
}

/** Valida un registro; lanza `Error` (VALIDATION) con el primer problema. Devuelve el email normalizado. */
export function validateRegistration(email: string, password: string): string {
  const normalized = normalizeEmail(email);
  const issue = emailIssue(normalized) ?? passwordIssue(password);
  if (issue) throw new Error(issue);
  return normalized;
}
