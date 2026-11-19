/**
 * Todas las operaciones GraphQL que envía la web (fase 5). Están juntas para que
 * `operations.test.ts` las valide contra el esquema real de la API
 * (`apps/api/schema.graphql`, que la API mantiene al día con su propia prueba):
 * un nombre de tipo, campo o argumento equivocado falla en `npm test`, no en producción.
 */

const authFields = "accessToken accessTokenExpiresAt user { id email createdAt }";
const checkpointFields =
  "id name description createdAt updatedAt tournamentCount universeCount activityCount sizeBytes version revision backupVersion digest";

export const operations = {
  // Sesión
  register: `mutation Register($input: CredentialsInput!) { register(input: $input) { ${authFields} } }`,
  login: `mutation Login($input: CredentialsInput!) { login(input: $input) { ${authFields} } }`,
  refreshToken: `mutation RefreshToken { refreshToken { ${authFields} } }`,
  logout: "mutation Logout { logout }",

  // Biblioteca con sesión (réplica)
  librarySnapshot: "query LibrarySnapshot { librarySnapshot }",
  libraryVersion: "query LibraryVersion { library { libraryVersion } }",
  commitLibraryChanges: `mutation CommitLibraryChanges($changes: JSON!, $expectedLibraryVersion: Int!) {
    commitLibraryChanges(changes: $changes, expectedLibraryVersion: $expectedLibraryVersion) { committed libraryVersion }
  }`,
  restoreBackup: `mutation RestoreBackup($backup: String!, $mode: RestoreMode!, $expectedLibraryVersion: Int) {
    restoreBackup(backup: $backup, mode: $mode, expectedLibraryVersion: $expectedLibraryVersion) { added skipped libraryVersion }
  }`,

  // Puntos de guardado de la cuenta
  saveCheckpoints: `query SaveCheckpoints { saveCheckpoints { ${checkpointFields} } }`,
  createSaveCheckpoint: `mutation CreateSaveCheckpoint($name: String!, $description: String) {
    createSaveCheckpoint(name: $name, description: $description) { ${checkpointFields} }
  }`,
  deleteSaveCheckpoint: `mutation DeleteSaveCheckpoint($id: ID!, $version: Int!) { deleteSaveCheckpoint(id: $id, expectedVersion: $version) }`,
  saveCheckpointPreview: `query SaveCheckpointPreview($id: ID!) {
    saveCheckpointPreview(id: $id) { checkpoint { ${checkpointFields} } comparison libraryVersion }
  }`,
  restoreSaveCheckpoint: `mutation RestoreSaveCheckpoint($id: ID!, $version: Int!, $libraryVersion: Int!) {
    restoreSaveCheckpoint(id: $id, expectedVersion: $version, expectedLibraryVersion: $libraryVersion) { added skipped }
  }`,
  saveCheckpointContent: "query SaveCheckpointContent($id: ID!) { saveCheckpointContent(id: $id) }",
} as const;
