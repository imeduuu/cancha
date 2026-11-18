import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { Tournament } from "../../domain/entities/tournament";
import { closureLeague } from "../../test-utils/season-closure-fixtures";
import { createActivityEvent } from "../services/activity-log";
import { importRejectionEvent as rejection, sourceIncidentEvent } from "../../test-utils/library-changes-fixtures";
import {
  carriesTournamentSnapshot,
  isLibraryLevelActivityAction,
  libraryLevelActivityActions,
  validateLibraryChanges,
  type LoadedLibraryIds,
} from "./library-changes";

const league = (id: string): Tournament => ({ ...closureLeague(id), name: `Liga ${id}` });
const event = (tournament: Pick<Tournament, "id" | "name">, summary = "Se actualizó el reglamento."): ActivityEvent =>
  createActivityEvent(tournament, { action: "regulations-updated", entityType: "tournament", summary });
const loaded = (tournamentIds: string[] = ["a"], activityIds: string[] = []): LoadedLibraryIds => ({
  tournamentIds: new Set(tournamentIds),
  activityIds: new Set(activityIds),
});
describe("validateLibraryChanges", () => {
  it("acepta un envío válido y lo devuelve normalizado", () => {
    const a = league("a"), c = league("c");
    const changes = { saved: [a, c], deleted: [], events: [event(a), event(c)], activeTournament: { id: "c" } };
    expect(validateLibraryChanges(changes, loaded())).toEqual(changes);
  });

  it("rechaza replaceLibrary y replaceActivity aunque valgan false", () => {
    for (const flag of [{ replaceLibrary: true }, { replaceLibrary: false }, { replaceActivity: false }]) {
      expect(() => validateLibraryChanges({ saved: [], deleted: [], events: [], ...flag }, loaded()))
        .toThrow(/sólo se puede restaurando un respaldo/);
    }
  });

  it("rechaza campos desconocidos y formas inválidas", () => {
    expect(() => validateLibraryChanges({ saved: [], deleted: [], events: [], extra: 1 }, loaded())).toThrow(/"extra" no es válido/);
    expect(() => validateLibraryChanges({ saved: {}, deleted: [], events: [] }, loaded())).toThrow(/deben ser listas/);
    expect(() => validateLibraryChanges(null, loaded())).toThrow(/formato esperado/);
  });

  it("valida cada torneo con getTournamentStorageIssue, también los construidos a mano", () => {
    const handmade = { id: "roto", name: "Torneo roto", teams: "no es una lista" };
    expect(() => validateLibraryChanges({ saved: [handmade], deleted: [], events: [] }, loaded()))
      .toThrow(/No se guardaron los cambios: "Torneo roto"/);
    expect(() => validateLibraryChanges({ saved: [league("a"), league("a")], deleted: [], events: [] }, loaded()))
      .toThrow(/duplicados/);
  });

  it("valida cada evento con isActivityEvent", () => {
    const invalid = { ...event(league("a")), summary: "" };
    expect(() => validateLibraryChanges({ saved: [], deleted: [], events: [invalid] }, loaded()))
      .toThrow(/evento de actividad no es válido/);
  });

  it("ignora los eventos con id ya registrado, sin exigirles nada más", () => {
    const known = event({ id: "borrado-hace-tiempo", name: "Viejo" });
    const fresh = event(league("a"));
    const result = validateLibraryChanges({ saved: [], deleted: [], events: [known, fresh] }, loaded(["a"], [known.id]));
    expect(result.events).toEqual([fresh]);
  });

  it("exige que el tournamentId de un evento nuevo exista o venga en el mismo envío", () => {
    expect(() => validateLibraryChanges({ saved: [], deleted: [], events: [event(league("x"))] }, loaded()))
      .toThrow(/campeonato que no existe \("x"\)/);
    const x = league("x");
    expect(validateLibraryChanges({ saved: [x], deleted: [], events: [event(x)] }, loaded()).events).toHaveLength(1);
    // tournament-deleted se refiere a un torneo que existía al cargar.
    expect(validateLibraryChanges({ saved: [], deleted: ["a"], events: [event(league("a"))] }, loaded()).deleted).toEqual(["a"]);
  });

  it("exceptúa sólo la lista cerrada de acciones sin torneo", () => {
    expect([...libraryLevelActivityActions]).toEqual(["tournament-import-rejected", "source-incident-reviewed"]);
    expect(isLibraryLevelActivityAction("tournament-created")).toBe(false);
    const events = [rejection("library"), rejection("torneo-rechazado"), sourceIncidentEvent("anfp-primera")];
    expect(validateLibraryChanges({ saved: [], deleted: [], events }, loaded()).events).toEqual(events);
  });

  it("las excepciones no pueden traer un torneo completo en before o after", () => {
    for (const bad of [
      rejection("library", { after: league("z") }),
      rejection("library", { before: { nested: [league("z")] } }),
      sourceIncidentEvent("anfp-primera", {}, { documento: league("z") }),
      sourceIncidentEvent("anfp-primera", { before: league("z") }),
    ]) {
      expect(() => validateLibraryChanges({ saved: [], deleted: [], events: [bad] }, loaded()))
        .toThrow(/no puede incluir un torneo completo/);
    }
  });

  it("los eliminados deben existir al cargar y no guardarse a la vez", () => {
    expect(() => validateLibraryChanges({ saved: [], deleted: ["nada"], events: [] }, loaded())).toThrow(/"nada" que se quiere eliminar/);
    expect(() => validateLibraryChanges({ saved: [league("a")], deleted: ["a"], events: [] }, loaded())).toThrow(/a la vez/);
  });

  it("el torneo activo debe existir después de aplicar el envío", () => {
    expect(() => validateLibraryChanges({ saved: [], deleted: [], events: [], activeTournament: { id: "nada" } }, loaded()))
      .toThrow(/torneo activo "nada" no existe/);
    expect(() => validateLibraryChanges({ saved: [], deleted: ["a"], events: [], activeTournament: { id: "a" } }, loaded()))
      .toThrow(/torneo activo "a" no existe/);
    expect(validateLibraryChanges({ saved: [], deleted: [], events: [], activeTournament: { id: null } }, loaded()).activeTournament)
      .toEqual({ id: null });
  });

  it("carriesTournamentSnapshot reconoce un torneo a cualquier profundidad", () => {
    expect(carriesTournamentSnapshot(league("a"))).toBe(true);
    expect(carriesTournamentSnapshot({ a: [{ b: league("a") }] })).toBe(true);
    expect(carriesTournamentSnapshot({ id: "x", teams: [] })).toBe(false);
    expect(carriesTournamentSnapshot("texto")).toBe(false);
  });
});
