/** Error esperado por una regla del dominio o una operación de aplicación. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}
