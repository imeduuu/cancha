import { describe, expect, it } from "vitest";
import { closureLeague } from "../../test-utils/season-closure-fixtures";
import { getTournamentStorageIssue } from "./tournament-storage";

describe("getTournamentStorageIssue", () => {
  it("acepta un torneo válido", () => {
    expect(getTournamentStorageIssue(closureLeague())).toBeUndefined();
  });

  it("devuelve el primer problema de integridad", () => {
    expect(getTournamentStorageIssue({ ...closureLeague(), name: " " }))
      .toBe("Nombre del torneo: no puede estar vacío.");
  });

  it("rechaza datos de partido inválidos", () => {
    const tournament = closureLeague();
    const [matchday] = tournament.matchdays;
    const [fixture] = matchday.fixtures;
    const broken = {
      ...tournament,
      matchdays: [{ ...matchday, fixtures: [{ ...fixture, eventsCoverage: "parcial" }, ...matchday.fixtures.slice(1)] }, ...tournament.matchdays.slice(1)],
    } as unknown as typeof tournament;
    expect(getTournamentStorageIssue(broken)).toMatch(/^Fecha\/fase 1, partido 1, eventos:/);
  });
});
