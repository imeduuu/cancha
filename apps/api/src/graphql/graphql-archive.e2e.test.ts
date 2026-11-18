import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replicaSetStartupTimeoutMs } from "../test-utils/mongo-replica-set.js";
import { startGraphqlApp, type GraphqlTestApp } from "../test-utils/graphql-app.js";

let api: GraphqlTestApp;

beforeAll(async () => { api = await startGraphqlApp("graphql_archive"); }, replicaSetStartupTimeoutMs);
afterAll(async () => { await api?.stop(); });

const gql = <T = Record<string, never>>(query: string, variables?: Record<string, unknown>) =>
  api.gql<T>(query, variables);

interface BackupEnvelope {
  format: string;
  version: number;
  exportedAt: string;
  tournaments: { id: string; name: string }[];
  activity: { id: string; action: string; imported?: boolean }[];
}
interface TournamentEnvelope { format: string; version: number; exportedAt: string; tournament: { id: string; name: string } }

const exportLibrary = async () => (await gql<{ exportLibrary: BackupEnvelope }>("{ exportLibrary }")).data!.exportLibrary;
const libraryVersion = async () =>
  (await gql<{ library: { libraryVersion: number } }>("{ library { libraryVersion } }")).data!.library.libraryVersion;
const withoutImportedMark = <T extends { imported?: boolean }>(events: readonly T[]) =>
  events.map(({ imported, ...event }) => { void imported; return event; });

async function create(name: string): Promise<{ id: string; version: number }> {
  const response = await gql<{ createTournament: { id: string; version: number } }>(`
    mutation Create($input: CreateTournamentInput!) { createTournament(input: $input) { id version } }
  `, { input: { name, teamNames: ["Norte", "Sur", "Este", "Oeste"], legs: 1, tieBreakers: ["goalDifference"] } });
  expect(response.errors).toBeUndefined();
  return response.data!.createTournament;
}

describe("JSON v7 por GraphQL: importar, restaurar y exportar", () => {
  it("ida y vuelta de la biblioteca: exportar, cambiar todo, restaurar en REPLACE y exportar igual", async () => {
    const first = await create("Liga exportada");
    await gql(`mutation { simulateChampionship(tournamentId: "${first.id}", expectedVersion: 1) { simulatedCount } }`);
    await create("Copa exportada");
    const original = await exportLibrary();
    expect(original).toMatchObject({ format: "cancha-backup", version: 7 });
    expect(original.tournaments).toHaveLength(2);

    // Cambios posteriores que la restauración debe deshacer.
    await gql(`mutation { renameTournament(tournamentId: "${first.id}", expectedVersion: 2, name: "Cambio posterior") { id } }`);
    await create("Torneo que no estaba en el respaldo");

    const restored = await gql<{ restoreBackup: { added: number; skipped: number; libraryVersion: number } }>(`
      mutation Restore($backup: String!) { restoreBackup(backup: $backup, mode: REPLACE) { added skipped libraryVersion } }
    `, { backup: JSON.stringify(original) });
    expect(restored.errors).toBeUndefined();
    expect(restored.data!.restoreBackup).toMatchObject({ added: 2, skipped: 0 });

    const again = await exportLibrary();
    expect(again.tournaments).toEqual(original.tournaments);
    const restoreEvent = again.activity.at(-1)!;
    expect(restoreEvent).toMatchObject({ action: "library-restored", after: { mode: "replace", added: 2, skipped: 0 } });
    expect(again.activity.slice(0, -1).every(({ imported }) => imported === true)).toBe(true);
    expect(withoutImportedMark(again.activity.slice(0, -1))).toEqual(withoutImportedMark(original.activity));

    const versions = await gql<{ tournaments: { id: string; version: number }[] }>("{ tournaments { id version } }");
    expect(versions.data!.tournaments.map(({ id }) => id)).toEqual(original.tournaments.map(({ id }) => id));
    const active = await gql<{ library: { activeTournamentId: string } }>("{ library { activeTournamentId } }");
    expect(active.data!.library.activeTournamentId).toBe(original.tournaments[0].id);
  });

  it("restaurar en MERGE agrega sólo lo que no existe", async () => {
    const backup = await exportLibrary();
    const extra = await create("Sólo en la base");

    const merged = await gql<{ restoreBackup: { added: number; skipped: number } }>(`
      mutation Restore($backup: String!) { restoreBackup(backup: $backup, mode: MERGE) { added skipped } }
    `, { backup: JSON.stringify(backup) });

    expect(merged.data!.restoreBackup).toEqual({ added: 0, skipped: backup.tournaments.length });
    const ids = (await exportLibrary()).tournaments.map(({ id }) => id);
    expect(ids).toContain(extra.id);
  });

  it("ida y vuelta de un torneo: exportar, eliminar, importar con ADD y exportar igual", async () => {
    const { id } = await create("Torneo viajero");
    const exported = (await gql<{ exportTournament: TournamentEnvelope }>(`{ exportTournament(id: "${id}") }`)).data!.exportTournament;
    expect(exported).toMatchObject({ format: "cancha-tournament", version: 7, tournament: { id, name: "Torneo viajero" } });

    await gql(`mutation { deleteTournament(tournamentId: "${id}", expectedVersion: 1) }`);
    const imported = await gql<{ importTournament: { id: string; version: number } }>(`
      mutation Import($archive: String!) { importTournament(archive: $archive, decision: ADD) { id version } }
    `, { archive: JSON.stringify(exported) });
    expect(imported.errors).toBeUndefined();
    expect(imported.data!.importTournament).toEqual({ id, version: 1 });

    const again = (await gql<{ exportTournament: TournamentEnvelope }>(`{ exportTournament(id: "${id}") }`)).data!.exportTournament;
    expect(again.tournament).toEqual(exported.tournament);

    const copy = await gql<{ importTournament: { id: string; name: string } }>(`
      mutation Import($archive: String!) { importTournament(archive: $archive, decision: COPY) { id name } }
    `, { archive: JSON.stringify(exported) });
    expect(copy.data!.importTournament.id).not.toBe(id);
    expect(copy.data!.importTournament.name).toMatch(/Torneo viajero/);
  });

  it("un respaldo inválido o de una versión futura se rechaza sin escribir nada", async () => {
    const before = await exportLibrary();
    const version = await libraryVersion();
    const restore = (backup: string) => gql(`
      mutation Restore($backup: String!) { restoreBackup(backup: $backup, mode: REPLACE) { added } }
    `, { backup });

    const broken = await restore("{ esto no es json");
    expect(broken.errors![0].extensions).toEqual({ code: "VALIDATION" });
    const future = await restore(JSON.stringify({ ...before, version: 99 }));
    expect(future.errors![0].extensions).toEqual({ code: "VALIDATION" });
    expect(future.errors![0].message).toMatch(/versi/i);
    const invalidTournament = await restore(JSON.stringify({ ...before, tournaments: [{ id: "roto" }] }));
    expect(invalidTournament.errors![0].extensions).toEqual({ code: "VALIDATION" });

    expect(await libraryVersion()).toBe(version);
    const after = await exportLibrary();
    expect(after.tournaments).toEqual(before.tournaments);
    expect(after.activity).toEqual(before.activity);
  });

  it("importar con ADD un id existente es VALIDATION y sólo queda el evento de rechazo", async () => {
    const { id } = await create("Torneo existente");
    const archive = (await gql<{ exportTournament: TournamentEnvelope }>(`{ exportTournament(id: "${id}") }`)).data!.exportTournament;
    const before = await exportLibrary();

    const response = await gql(`
      mutation Import($archive: String!) { importTournament(archive: $archive, decision: ADD) { id } }
    `, { archive: JSON.stringify(archive) });

    expect(response.errors![0]).toMatchObject({
      message: "Ya existe un torneo con ese identificador. Elige crear una copia o actualizarlo.",
      extensions: { code: "VALIDATION" },
    });
    const after = await exportLibrary();
    expect(after.tournaments).toEqual(before.tournaments);
    expect(after.activity.slice(before.activity.length).map(({ action }) => action)).toEqual(["tournament-import-rejected"]);
  });

  it("exportar un torneo inexistente es NOT_FOUND", async () => {
    const response = await gql(`{ exportTournament(id: "no-existe") }`);
    expect(response.errors![0].extensions).toEqual({ code: "NOT_FOUND" });
  });
}, 60_000);
