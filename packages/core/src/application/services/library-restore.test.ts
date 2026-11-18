import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { Tournament } from "../../domain/entities/tournament";
import { contractTournament } from "../../test-utils/tournament-repository-contract";
import { createActivityEvent } from "./activity-log";
import { planLibraryRestore, validateLibraryRestore } from "./library-restore";

const event = (tournament: Tournament, summary: string): ActivityEvent =>
  createActivityEvent(tournament, { action: "regulations-updated", entityType: "tournament", summary });
const fixed = { createId: () => "evento-restauracion", now: () => new Date("2026-05-01T10:00:00.000Z") };

describe("validateLibraryRestore", () => {
  it("acepta un respaldo válido y rechaza torneos inválidos, ids repetidos o eventos inválidos", () => {
    const a = contractTournament("a");
    expect(() => validateLibraryRestore([a], [event(a, "Uno.")])).not.toThrow();
    expect(() => validateLibraryRestore([{ ...a, name: " " }], []))
      .toThrow(/^No se importó " ": Nombre del torneo/);
    expect(() => validateLibraryRestore([{ ...a, name: "" }], []))
      .toThrow(/^No se importó "a": /);
    expect(() => validateLibraryRestore([a, a], []))
      .toThrow('No se importó el respaldo: el identificador "a" está duplicado.');
    expect(() => validateLibraryRestore([a], [{ ...event(a, "x"), action: "no-existe" } as unknown as ActivityEvent]))
      .toThrow("No se importó el respaldo: el historial contiene eventos inválidos.");
    expect(() => validateLibraryRestore([a], [], () => false))
      .toThrow("No se importó el respaldo: la estructura de uno de los torneos no es válida.");
  });
});

describe("planLibraryRestore", () => {
  const existingA = contractTournament("a", "A vigente");
  const existingB = contractTournament("b", "B vigente");
  const previous = event(existingA, "Historial vigente.");

  it("merge agrega lo nuevo, omite ids existentes, conserva historial y torneo activo", () => {
    const incomingA = contractTournament("a", "A del respaldo");
    const incomingC = contractTournament("c", "C del respaldo");
    const restoredEvent = event(incomingC, "Del respaldo.");

    const plan = planLibraryRestore({
      mode: "merge",
      incoming: [incomingA, incomingC],
      incomingActivity: [restoredEvent, previous],
      existing: [existingA, existingB],
      existingActivity: [previous],
      activeTournamentId: "b",
      ...fixed,
    });

    expect(plan).toMatchObject({ added: 1, skipped: 1, activeTournamentId: "b" });
    expect(plan.tournaments.map(({ name }) => name)).toEqual(["C del respaldo", "A vigente", "B vigente"]);
    expect(plan.activity.map(({ summary }) => summary))
      .toEqual(["Historial vigente.", "Del respaldo.", "Se restauró un respaldo (merge) con 1 competiciones agregadas."]);
    expect(plan.activity[1].imported).toBe(true);
    expect(plan.event).toMatchObject({
      id: "evento-restauracion",
      occurredAt: "2026-05-01T10:00:00.000Z",
      action: "library-restored",
      tournamentId: "c",
      tournamentName: "C del respaldo",
      after: { mode: "merge", added: 1, skipped: 1 },
    });
  });

  it("replace deja sólo el respaldo y su historial, con el primero como torneo activo", () => {
    const incoming = [contractTournament("x"), contractTournament("y")];
    const plan = planLibraryRestore({
      mode: "replace",
      incoming,
      incomingActivity: [],
      existing: [existingA, existingB],
      existingActivity: [previous],
      activeTournamentId: "a",
      ...fixed,
    });

    expect(plan).toMatchObject({ added: 2, skipped: 0, activeTournamentId: "x" });
    expect(plan.tournaments.map(({ id }) => id)).toEqual(["x", "y"]);
    expect(plan.activity.map(({ action }) => action)).toEqual(["library-restored"]);
  });

  it("el torneo activo se elige entre los seleccionables (p. ej. el universo vigente)", () => {
    const plan = planLibraryRestore({
      mode: "merge",
      incoming: [contractTournament("c")],
      existing: [existingA, existingB],
      existingActivity: [],
      activeTournamentId: "a",
      selectable: tournaments => tournaments.filter(({ id }) => id !== "a"),
      ...fixed,
    });
    expect(plan.activeTournamentId).toBe("c");
  });

  it("un respaldo vacío en merge registra el evento de la biblioteca sin agregar nada", () => {
    const plan = planLibraryRestore({
      mode: "merge", incoming: [], existing: [existingA], existingActivity: [], activeTournamentId: null, ...fixed,
    });
    expect(plan).toMatchObject({ added: 0, skipped: 0, activeTournamentId: "a" });
    expect(plan.event).toMatchObject({ tournamentId: "library", tournamentName: "Biblioteca" });
  });
});
