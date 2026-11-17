// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { MatchRegulationsEditor } from "./match-regulations-editor";

afterEach(cleanup);

function makeTournament(withEvent = false): Tournament {
  return {
    id: "season-2026",
    competitionId: "competition",
    name: "Liga 2026",
    season: 2026,
    teams: [{ id: "a", name: "Alfa" }, { id: "b", name: "Bravo" }],
    legs: 1,
    tieBreakers: [],
    matchdays: [{
      number: 1,
      leg: 1,
      fixtures: [{
        id: "match",
        homeTeamId: "a",
        awayTeamId: "b",
        ...(withEvent ? {
          events: [{ id: "event", type: "goal" as const, teamId: "a", playerName: "Jugador" }],
        } : {}),
      }],
    }],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("MatchRegulationsEditor", () => {
  it("saves configured zero distinctly from unconfigured fields and defaults to pending", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<MatchRegulationsEditor tournament={makeTournament()} onSave={onSave} />);

    await user.type(screen.getByRole("spinbutton", { name: "Máximo de sustituciones" }), "0");
    await user.click(screen.getByRole("button", { name: "Guardar reglamento" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      matchRegulations: expect.objectContaining({
        season: 2026,
        schemaVersion: 1,
        verification: "pending",
        substitutions: { maxCount: 0 },
      }),
    }));
    expect(onSave.mock.calls[0][0].matchRegulations.lineup).toBeUndefined();
  });

  it("requires confirmation before changing rules used to validate existing details and preserves events", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    const onSave = vi.fn();
    const tournament = makeTournament(true);
    render(<MatchRegulationsEditor tournament={tournament} onSave={onSave} />);

    await user.type(screen.getByRole("spinbutton", { name: "Titulares requeridos" }), "11");
    await user.click(screen.getByRole("button", { name: "Guardar reglamento" }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      matchRegulations: expect.objectContaining({ lineup: { requiredStarters: 11 } }),
      matchdays: tournament.matchdays,
    }));
    confirm.mockRestore();
  });
});
