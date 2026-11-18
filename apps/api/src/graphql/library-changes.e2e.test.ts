import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { createActivityEvent } from "@cancha/core/application/services/activity-log";
import { closureLeague } from "@cancha/core/test-utils/season-closure-fixtures";
import { importRejectionEvent, sourceIncidentEvent } from "@cancha/core/test-utils/library-changes-fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replicaSetStartupTimeoutMs } from "../test-utils/mongo-replica-set.js";
import { startGraphqlApp, type GraphqlResponse, type GraphqlTestApp, type TestSession } from "../test-utils/graphql-app.js";

let api: GraphqlTestApp;

beforeAll(async () => { api = await startGraphqlApp("library_changes"); }, replicaSetStartupTimeoutMs);
afterAll(async () => { await api?.stop(); });

interface LibrarySnapshot {
  tournaments: Tournament[];
  activity: ActivityEvent[];
  activeTournamentId: string | null;
  libraryVersion: number;
  versions: Record<string, number>;
}
interface LibraryCommit { committed: boolean; libraryVersion: number; versions: { id: string; version: number }[] }

const league = (id: string, name = `Liga ${id}`): Tournament => ({ ...closureLeague(id), name });
const event = (tournament: Pick<Tournament, "id" | "name">, summary = "Se actualizó el reglamento."): ActivityEvent =>
  createActivityEvent(tournament, { action: "regulations-updated", entityType: "tournament", summary });
/** Ids únicos por prueba: todas comparten la biblioteca del usuario del archivo. */
let serial = 0;
const fresh = (prefix: string) => `${prefix}-${++serial}`;

async function snapshot(session?: TestSession): Promise<LibrarySnapshot> {
  const response = await api.gqlWith<{ librarySnapshot: LibrarySnapshot }>(
    { token: (session ?? api.session).accessToken },
    "{ librarySnapshot }",
  );
  expect(response.errors).toBeUndefined();
  return response.data!.librarySnapshot;
}

function commit(changes: unknown, expectedLibraryVersion: number, session?: TestSession): Promise<GraphqlResponse<{ commitLibraryChanges: LibraryCommit }>> {
  return api.gqlWith<{ commitLibraryChanges: LibraryCommit }>(
    { token: (session ?? api.session).accessToken },
    `mutation Commit($changes: JSON!, $version: Int!) {
      commitLibraryChanges(changes: $changes, expectedLibraryVersion: $version) { committed libraryVersion versions { id version } }
    }`,
    { changes, version: expectedLibraryVersion },
  );
}

async function committed(changes: unknown, session?: TestSession): Promise<LibraryCommit> {
  const response = await commit(changes, (await snapshot(session)).libraryVersion, session);
  expect(response.errors).toBeUndefined();
  return response.data!.commitLibraryChanges;
}

/** Rechazado con `code` y la biblioteca (torneos, actividad, activo y versión) exactamente igual. */
async function expectRejected(changes: unknown, code: string, message?: RegExp, session?: TestSession): Promise<void> {
  const before = await snapshot(session);
  const response = await commit(changes, before.libraryVersion, session);
  expect(response.data).toBeNull();
  expect(response.errors![0].extensions?.code).toBe(code);
  if (message) expect(response.errors![0].message).toMatch(message);
  expect(await snapshot(session)).toEqual(before);
}

describe("commitLibraryChanges: confirmar la réplica del cliente (fase 5, C3)", () => {
  it("crea, edita, elimina y cambia el torneo activo, cada envío en una transacción", async () => {
    const a = league(fresh("a")), b = league(fresh("b")), c = league(fresh("c"));
    const first = await committed({ saved: [a, b], deleted: [], events: [event(a, "Alta A."), event(b, "Alta B.")], activeTournament: { id: a.id } });
    expect(first.committed).toBe(true);
    expect(first.versions).toEqual(expect.arrayContaining([{ id: a.id, version: 1 }, { id: b.id, version: 1 }]));

    const before = await snapshot();
    const second = await committed({
      saved: [{ ...a, name: "A editada" }, c],
      deleted: [b.id],
      events: [event(a, "Edita A."), event(c, "Alta C."), event(b, "Baja B.")],
      activeTournament: { id: c.id },
    });
    expect(second.libraryVersion).toBe(before.libraryVersion + 1);

    const after = await snapshot();
    expect(after.tournaments.slice(0, 2).map(({ id, name }) => [id, name])).toEqual([[c.id, c.name], [a.id, "A editada"]]);
    expect(after.tournaments.some(({ id }) => id === b.id)).toBe(false);
    expect(after.versions[a.id]).toBe(2);
    expect(after.activeTournamentId).toBe(c.id);
    expect(after.activity.slice(-3).map(({ summary }) => summary)).toEqual(["Edita A.", "Alta C.", "Baja B."]);
  });

  it("con una versión de biblioteca desactualizada responde CONFLICT sin escribir nada", async () => {
    const before = await snapshot();
    const response = await commit({ saved: [league(fresh("tarde"))], deleted: [], events: [] }, before.libraryVersion - 1);
    expect(response.errors![0].extensions).toEqual({
      code: "CONFLICT",
      expectedLibraryVersion: before.libraryVersion - 1,
      currentLibraryVersion: before.libraryVersion,
    });
    expect(await snapshot()).toEqual(before);
  });

  it("no admite replaceLibrary ni replaceActivity, aunque valgan false", async () => {
    const replacement = league(fresh("reemplazo"));
    await expectRejected({ saved: [replacement], deleted: [], events: [], replaceLibrary: true }, "VALIDATION", /restaurando un respaldo/);
    await expectRejected({ saved: [replacement], deleted: [], events: [], replaceActivity: false }, "VALIDATION", /restaurando un respaldo/);
  });

  it("un evento con id ya registrado se ignora y nunca reemplaza al guardado", async () => {
    const t = league(fresh("idempotente"));
    const original = event(t, "Versión guardada.");
    await committed({ saved: [t], deleted: [], events: [original] });

    const extra = event(t, "Evento nuevo.");
    const result = await committed({ saved: [], deleted: [], events: [{ ...original, summary: "Intento de reemplazo." }, extra] });
    expect(result.committed).toBe(true);
    const activity = (await snapshot()).activity;
    expect(activity.find(({ id }) => id === original.id)?.summary).toBe("Versión guardada.");
    expect(activity.filter(({ id }) => id === original.id)).toHaveLength(1);
    expect(activity.at(-1)?.id).toBe(extra.id);

    // Si sólo trae eventos conocidos, no hay nada que escribir.
    const before = await snapshot();
    expect((await committed({ saved: [], deleted: [], events: [original] })).committed).toBe(false);
    expect(await snapshot()).toEqual(before);
  });

  it("el tournamentId de un evento nuevo puede venir en el mismo envío", async () => {
    const t = league(fresh("mismo-envio"));
    const created = event(t, "Creado en el mismo envío.");
    await committed({ saved: [t], deleted: [], events: [created] });
    expect((await snapshot()).activity.at(-1)?.id).toBe(created.id);
  });

  it("una acción fuera de la lista con tournamentId inexistente es VALIDATION sin escribir nada", async () => {
    const ghost = league(fresh("fantasma"));
    const unrelated = league(fresh("acompanante"));
    await expectRejected(
      { saved: [unrelated], deleted: [], events: [event(unrelated), event(ghost, "Sobre un torneo inexistente.")] },
      "VALIDATION",
      /campeonato que no existe/,
    );
  });

  describe("excepciones de la lista cerrada (libraryLevelActivityActions)", () => {
    it("tournament-import-rejected con \"library\"", async () => {
      const rejected = importRejectionEvent("library");
      await committed({ saved: [], deleted: [], events: [rejected] });
      expect((await snapshot()).activity.at(-1)).toEqual(rejected);
    });

    it("tournament-import-rejected con el id de un torneo que nunca se guardó", async () => {
      const rejected = importRejectionEvent(fresh("rechazado"));
      await committed({ saved: [], deleted: [], events: [rejected] });
      expect((await snapshot()).activity.at(-1)).toEqual(rejected);
    });

    it("source-incident-reviewed con el competitionId de la fuente", async () => {
      const incident = sourceIncidentEvent(fresh("anfp-primera"));
      await committed({ saved: [], deleted: [], events: [incident] });
      expect((await snapshot()).activity.at(-1)).toEqual(incident);
    });

    it("una excepción con un torneo completo en before o after es VALIDATION", async () => {
      await expectRejected({ saved: [], deleted: [], events: [importRejectionEvent("library", { after: league(fresh("colado")) })] },
        "VALIDATION", /no puede incluir un torneo completo/);
      await expectRejected({ saved: [], deleted: [], events: [sourceIncidentEvent(fresh("anfp"), { before: league(fresh("colado")) })] },
        "VALIDATION", /no puede incluir un torneo completo/);
    });
  });

  it("un torneo inválido construido a mano es VALIDATION sin escribir nada", async () => {
    const valid = league(fresh("valido"));
    const handmade = { id: fresh("a-mano"), name: "Torneo a mano", teams: "no es una lista", matchdays: [] };
    await expectRejected({ saved: [valid, handmade], deleted: [], events: [event(valid)] }, "VALIDATION", /"Torneo a mano"/);
    const broken = { ...league(fresh("roto")), matchdays: [{ fixtures: "rotos" }] };
    await expectRejected({ saved: [broken], deleted: [], events: [] }, "VALIDATION", /No se guardaron los cambios/);
  });

  it("un evento inválido es VALIDATION sin escribir nada", async () => {
    const t = league(fresh("evento-invalido"));
    await expectRejected({ saved: [t], deleted: [], events: [{ ...event(t), occurredAt: "ayer" }] }, "VALIDATION", /evento de actividad no es válido/);
  });

  it("eliminar un id inexistente es VALIDATION sin escribir nada", async () => {
    await expectRejected({ saved: [], deleted: [fresh("no-existe")], events: [] }, "VALIDATION", /que se quiere eliminar/);
  });

  it("aislamiento: otro usuario no puede eliminar ni referenciar un torneo con el mismo id", async () => {
    const shared = league(fresh("compartido"), "Liga de A");
    await committed({ saved: [shared], deleted: [], events: [event(shared)] });
    const ofA = await snapshot();
    const bob = await api.register(`${fresh("bob")}@cancha.test`);

    await expectRejected({ saved: [], deleted: [shared.id], events: [] }, "VALIDATION", /que se quiere eliminar/, bob);
    await expectRejected({ saved: [], deleted: [], events: [event(shared, "B sobre A.")] }, "VALIDATION", /no existe/, bob);
    await expectRejected({ saved: [], deleted: [], events: [], activeTournament: { id: shared.id } }, "VALIDATION", /no existe/, bob);

    // Con el mismo id, B sólo crea su propia copia.
    await committed({ saved: [{ ...shared, name: "Copia de B" }], deleted: [], events: [] }, bob);
    expect((await snapshot(bob)).tournaments.map(({ name }) => name)).toEqual(["Copia de B"]);
    expect(await snapshot()).toEqual(ofA);
  });
});

describe("restoreBackup con expectedLibraryVersion", () => {
  const restore = (backup: string, version: number) => api.gql<{ restoreBackup: { added: number; libraryVersion: number } }>(
    `mutation Restore($backup: String!, $version: Int) {
      restoreBackup(backup: $backup, mode: MERGE, expectedLibraryVersion: $version) { added libraryVersion }
    }`,
    { backup, version },
  );

  it("una versión desactualizada es CONFLICT sin escribir nada; la vigente restaura", async () => {
    const backup = JSON.stringify((await api.gql<{ exportLibrary: unknown }>("{ exportLibrary }")).data!.exportLibrary);
    await committed({ saved: [league(fresh("posterior"))], deleted: [], events: [] });
    const before = await snapshot();

    const stale = await restore(backup, before.libraryVersion - 1);
    expect(stale.errors![0].extensions?.code).toBe("CONFLICT");
    expect(await snapshot()).toEqual(before);

    const current = await restore(backup, before.libraryVersion);
    expect(current.errors).toBeUndefined();
    expect(current.data!.restoreBackup.libraryVersion).toBe(before.libraryVersion + 1);
  });
});
