/** No hay sesión válida (token ausente, alterado, expirado o revocado): UNAUTHENTICATED. */
export class AuthenticationError extends Error {
  constructor(message = "Debes iniciar sesión para continuar.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/** La petición viene de un origen que no está en CORS_ORIGINS: FORBIDDEN. */
export class ForbiddenOriginError extends Error {
  constructor() {
    super("El origen de la petición no está permitido.");
    this.name = "ForbiddenOriginError";
  }
}

/** Mensaje único de login fallido: no revela si el email existe. */
export const invalidCredentialsMessage = "Email o contraseña incorrectos";
