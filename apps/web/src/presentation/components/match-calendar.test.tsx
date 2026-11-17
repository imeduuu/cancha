// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FixtureListProps } from "./fixture-list";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { MatchCalendar } from "./match-calendar";

afterEach(cleanup);

const tournament: Tournament = {
  id: "cup-season",
  competitionId: "cup",
  name: "Copa de prueba",
  season: 2026,
  competitionType: "cup",
  format: "staged",
  teams: [
    { id: "a", name: "Alfa", groupName: "Grupo A" },
    { id: "b", name: "Bravo", groupName: "Grupo A" },
    { id: "c", name: "Charlie", groupName: "Grupo B" },
    { id: "d", name: "Delta", groupName: "Grupo B" },
  ],
  legs: 1,
  tieBreakers: [],
  matchdays: [
    {
      number: 1,
      leg: 1,
      phaseName: "Fase de grupos",
      fixtures: [
        {
          id: "played",
          homeTeamId: "a",
          awayTeamId: "b",
          result: { homeGoals: 2, awayGoals: 0 },
        },
        {
          id: "invalid",
          homeTeamId: "a",
          awayTeamId: "c",
          result: { homeGoals: 100, awayGoals: 0 },
        },
        { id: "pending", homeTeamId: "c", awayTeamId: "d" },
      ],
    },
    {
      number: 2,
      leg: 1,
      phaseName: "Cuartos de final",
      fixtures: [
        { id: "next-a", homeTeamId: "a", awayTeamId: "d" },
        { id: "next-b", homeTeamId: "c", awayTeamId: "b" },
      ],
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  knockoutStages: [{ name: "Cuartos de final", legs: 1 }],
};

function renderCalendar(source = tournament, overrides: Partial<FixtureListProps> & {onOpenProgramming?: () => void} = {}) {
  const noOp = vi.fn();
  const fixtureProps: FixtureListProps = {
    matchdays: source.matchdays,
    teams: source.teams,
    allMatchdays: source.matchdays,
    competitionType: source.competitionType,
    onSimulateMatchday: noOp,
    onSimulateFixture: noOp,
    onSaveResult: noOp,
    onSaveGoalScorers: noOp,
    tournament: source,
    onSaveDetails: noOp,
    onSaveSchedule: () => true,
    onUpdateOperationalStatus: () => true,
    players: [],
    playerRegistrations: [],
    otherTournaments: [],
    ...overrides,
  };
  const onBack = vi.fn();
  render(<MatchCalendar {...fixtureProps} onBack={onBack} onOpenProgramming={overrides.onOpenProgramming} />);
  return { onBack, fixtureProps };
}

describe("MatchCalendar", () => {
  it("offers navigation to the programming center", () => {
    const onOpenProgramming = vi.fn();
    renderCalendar(tournament, { onOpenProgramming });
    screen.getByRole("button", { name: "Programar calendario" }).click();
    expect(onOpenProgramming).toHaveBeenCalledOnce();
  });
  it("groups the complete calendar by phase and jornada and reports each result state", () => {
    renderCalendar();

    expect(screen.getByRole("region", { name: "Calendario de Copa de prueba" }))
      .toHaveTextContent("Fase de grupos · Jornada 1");
    expect(screen.getByRole("status")).toHaveTextContent("1 disputados");
    expect(screen.getByRole("status")).toHaveTextContent("3 pendientes");
    expect(screen.getByRole("status")).toHaveTextContent("1 con datos inválidos");
    expect(screen.getAllByText("Disputado").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pendiente").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Datos inválidos").length).toBeGreaterThan(0);
  });

  it("filters by an explicit operational state and keeps its saved score under review", async () => {
    const user = userEvent.setup();
    const suspended: Tournament = {
      ...tournament,
      matchdays: tournament.matchdays.map((matchday) => ({
        ...matchday,
        fixtures: matchday.fixtures.map((fixture) => fixture.id === "played"
          ? {
            ...fixture,
            operationalState: {
              status: "suspended",
              updatedAt: "2026-10-14T20:00:00.000Z",
              note: "Incidencia",
            },
          }
          : fixture),
      })),
    };
    renderCalendar(suspended);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filtrar calendario por estado" }),
      "suspended",
    );
    expect(screen.getByRole("group", { name: "Alfa contra Bravo" })).toBeInTheDocument();
    expect(screen.getByText(/^Suspendido · actualizado/)).toBeInTheDocument();
    expect(screen.getByText("Resultado en revisión")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Charlie contra Delta" })).not.toBeInTheDocument();
  });

  it("navigates jornadas and combines team, jornada, group, phase and status filters", async () => {
    const user = userEvent.setup();
    renderCalendar();

    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar calendario por equipo" }), "a");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar calendario por grupo" }), "Grupo A");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar calendario por fase" }), "Fase de grupos");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar calendario por jornada" }), "Fase de grupos|1|1");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar calendario por estado" }), "played");

    expect(screen.getByRole("group", { name: "Alfa contra Bravo" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Alfa contra Charlie" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Charlie contra Delta" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar calendario por estado" }), "");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar calendario por equipo" }), "");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar calendario por grupo" }), "");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar calendario por fase" }), "");
    await user.click(screen.getByRole("button", { name: "Jornada siguiente" }));
    await user.click(screen.getByRole("button", { name: "Jornada siguiente" }));
    expect(within(screen.getByLabelText("Navegación entre jornadas"))
      .getByText("Cuartos de final · Jornada 2")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Alfa contra Delta" })).toBeInTheDocument();
  }, 10_000);

  it("jumps to a pending jornada and opens existing result editing without changing tournament identity", async () => {
    const user = userEvent.setup();
    const onSaveResult = vi.fn();
    renderCalendar(tournament, { onSaveResult });

    await user.click(screen.getByRole("button", { name: "Ir a pendiente" }));
    expect(within(screen.getByLabelText("Navegación entre jornadas"))
      .getByText("Fase de grupos · Jornada 1")).toBeInTheDocument();
    const fixture = screen.getByRole("group", { name: "Charlie contra Delta" });
    await user.clear(within(fixture).getByRole("spinbutton", { name: "Goles de Charlie" }));
    await user.type(within(fixture).getByRole("spinbutton", { name: "Goles de Charlie" }), "1");
    await user.type(within(fixture).getByRole("spinbutton", { name: "Goles de Delta" }), "0");
    await user.click(within(fixture).getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(onSaveResult).toHaveBeenCalledWith(
        "pending",
        { homeGoals: 1, awayGoals: 0 },
        null,
      );
    });
    expect(tournament.id).toBe("cup-season");
    expect(tournament.matchdays[0].fixtures[2]).not.toHaveProperty("result");
  }, 10_000);

  it("hides group and jornada filters when the model has a single ungrouped matchday", () => {
    const singleDay: Tournament = {
      ...tournament,
      format: "round-robin",
      competitionType: "league",
      knockoutStages: undefined,
      teams: tournament.teams.map(({ id, name }) => ({ id, name })),
      matchdays: [{
        number: 1,
        leg: 1,
        fixtures: [{ id: "single", homeTeamId: "a", awayTeamId: "b" }],
      }],
    };
    renderCalendar(singleDay);

    expect(screen.queryByRole("combobox", { name: "Filtrar calendario por grupo" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Filtrar calendario por jornada" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Alfa contra Bravo" })).toBeInTheDocument();
  });

  it("sorts by local date and time, keeps undated matches visible and filters scheduled dates", async () => {
    const user = userEvent.setup();
    const scheduledTournament: Tournament = {
      ...tournament,
      matchdays: tournament.matchdays.map((matchday) => ({
        ...matchday,
        fixtures: matchday.fixtures.map((fixture) => fixture.id === "played"
          ? { ...fixture, schedule: { date: "2099-01-01", time: "09:00" } }
          : fixture.id === "next-b"
            ? { ...fixture, schedule: { date: "2099-01-01", time: "11:00" } }
            : fixture.id === "next-a"
              ? { ...fixture, schedule: { date: "2099-12-31", time: "20:00" } }
              : fixture),
      })),
    };
    const { container } = render(
      <MatchCalendar
        matchdays={scheduledTournament.matchdays}
        teams={scheduledTournament.teams}
        allMatchdays={scheduledTournament.matchdays}
        competitionType={scheduledTournament.competitionType}
        onSimulateMatchday={vi.fn()}
        onSimulateFixture={vi.fn()}
        onSaveResult={vi.fn()}
        onSaveGoalScorers={vi.fn()}
        tournament={scheduledTournament}
        onSaveDetails={vi.fn()}
        onSaveSchedule={() => true}
        onUpdateOperationalStatus={() => true}
        players={[]}
        playerRegistrations={[]}
        otherTournaments={[]}
        onBack={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Ordenar calendario" }), "date");
    await user.clear(screen.getByLabelText("Filtrar desde fecha"));
    await user.type(screen.getByLabelText("Filtrar desde fecha"), "2099-01-01");
    await user.clear(screen.getByLabelText("Filtrar hasta fecha"));
    await user.type(screen.getByLabelText("Filtrar hasta fecha"), "2099-01-01");

    expect(screen.getByText("01/01/2099")).toBeInTheDocument();
    expect(screen.queryByText("31/12/2099")).not.toBeInTheDocument();
    expect(screen.getByText("Sin fecha asignada")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Charlie contra Delta" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Próximos partidos programados" }))
      .toHaveTextContent("Charlie contra Bravo");
    const groups = [...container.querySelectorAll(".match-calendar-day")];
    expect(groups.map((group) => group.querySelector("h4")?.textContent?.trim()?.slice(0, 10)))
      .toEqual(["01/01/2099", "Sin fecha "]);
    const firstDateGroups = groups[0].querySelectorAll('[role="group"]');
    expect(firstDateGroups[0]).toHaveAttribute("aria-label", "Alfa contra Bravo");
  });
});
