// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Fixture, Tournament } from "../../domain/entities/tournament";
import { MatchDetailsPanel } from "./match-details-panel";

afterEach(cleanup);

const fixture: Fixture = {
  id: "match",
  homeTeamId: "home",
  awayTeamId: "away",
  result: { homeGoals: 1, awayGoals: 0 },
};
const tournament: Tournament = {
  id: "season",
  name: "Temporada",
  teams: [{ id: "home", name: "Local" }, { id: "away", name: "Visita" }],
  legs: 1,
  tieBreakers: [],
  matchdays: [{ number: 1, leg: 1, fixtures: [fixture] }],
  createdAt: "2026-01-01T00:00:00.000Z",
  lineupRules: { startersPerTeam: 1 },
};

describe("MatchDetailsPanel", () => {
  it("saves incomplete alignments and allows adding and editing a manual event without touching the score", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <MatchDetailsPanel
        fixture={fixture}
        tournament={tournament}
        homeTeam="Local"
        awayTeam="Visita"
        players={[]}
        registrations={[]}
        onSave={onSave}
        onSaveSchedule={() => true}
      />,
    );

    expect(screen.getByRole("checkbox", {
      name: "La lista de eventos está completa y revisada",
    })).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Guardar alineaciones (se permite incompleta)" }));
    expect(onSave).toHaveBeenLastCalledWith("match", expect.objectContaining({
      lineups: expect.objectContaining({
        home: expect.objectContaining({ status: "incomplete", starters: [] }),
      }),
    }));

    await user.type(screen.getByRole("textbox", { name: "Nombre del jugador del evento" }), "Jugador Manual");
    await user.click(screen.getByRole("button", { name: "Agregar evento" }));
    const event = onSave.mock.calls[onSave.mock.calls.length - 1]?.[1].events[0];
    expect(event).toMatchObject({ type: "goal", playerName: "Jugador Manual", teamId: "home" });
    expect(onSave.mock.calls[onSave.mock.calls.length - 1]?.[1].eventsCoverage).toBe("unverified");
    expect(fixture.result).toEqual({ homeGoals: 1, awayGoals: 0 });

    await user.click(screen.getByRole("button", { name: "Editar evento Jugador Manual" }));
    const input = screen.getByRole("textbox", { name: "Nombre del jugador del evento" });
    fireEvent.change(input, { target: { value: "Jugador Editado" } });
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    const editedEvent = onSave.mock.calls[onSave.mock.calls.length - 1]?.[1].events[0];
    expect(editedEvent).toMatchObject({ id: event.id, playerName: "Jugador Editado" });
    expect(fixture.result).toEqual({ homeGoals: 1, awayGoals: 0 });

    await user.click(screen.getByRole("checkbox", { name: "La lista de eventos está completa y revisada" }));
    await user.click(screen.getByRole("button", { name: "Guardar verificación de eventos" }));
    expect(onSave).toHaveBeenLastCalledWith("match", { eventsCoverage: "complete" });
  });

  it("saves and removes local scheduling independently from the score", async () => {
    const user = userEvent.setup();
    const onSaveSchedule = vi.fn(() => true);
    const scheduledFixture: Fixture = {
      ...fixture,
      schedule: { date: "2026-10-14", time: "20:15", venue: "Cancha A" },
    };
    render(
      <MatchDetailsPanel
        fixture={scheduledFixture}
        tournament={tournament}
        homeTeam="Local"
        awayTeam="Visita"
        players={[]}
        registrations={[]}
        onSave={vi.fn()}
        onSaveSchedule={onSaveSchedule}
      />,
    );

    await user.click(screen.getByText("Alineaciones y eventos"));
    await user.click(screen.getByText("Programación del partido"));
    await user.clear(screen.getByRole("textbox", { name: "Estadio del partido Local contra Visita" }));
    await user.type(screen.getByRole("textbox", { name: "Estadio del partido Local contra Visita" }), "Estadio Norte");
    await user.click(screen.getByRole("button", { name: "Guardar programación" }));
    expect(onSaveSchedule).toHaveBeenLastCalledWith("match", {
      date: "2026-10-14",
      time: "20:15",
      venue: "Estadio Norte",
    });
    expect(scheduledFixture.result).toEqual({ homeGoals: 1, awayGoals: 0 });

    await user.click(screen.getByRole("button", { name: "Quitar programación" }));
    expect(onSaveSchedule).toHaveBeenLastCalledWith("match", null);
    expect(scheduledFixture.result).toEqual({ homeGoals: 1, awayGoals: 0 });
  });
});
