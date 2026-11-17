// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SeasonSimulationCenter } from "./season-simulation-center";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { SeasonSimulationAccess, SeasonSimulationNavigation } from "./season-simulation-access";

afterEach(cleanup);
function setup() {
  let t: Tournament = {id: "t", name: "Liga", season: 2026, format: "round-robin", legs: 1,
    teams: [{id: "a", name: "Club A"}, {id: "b", name: "Club B"}], tieBreakers: ["goalDifference"],
    createdAt: "2026-01-01T00:00:00Z", competitionRules: {season: 2026, verification: {standings: "verified", placements: "verified"}},
    matchdays: [{number: 1, leg: 1, fixtures: [{id: "f", homeTeamId: "a", awayTeamId: "b"}]}]};
  const repo = {findAll: () => [t], save: vi.fn(), saveWithActivity: vi.fn((next: Tournament) => {t = next;})};
  const props = {tournaments: [t], repository: repo, universeId: "a", getUniverseId: () => "a",
    onChanged: vi.fn(), onCalendar: vi.fn(), onClose: vi.fn()};
  return {props, repo};
}
it("abrir y revisar no escribe; solo el botón de confirmación simula", async () => {
  const {props,repo} = setup(); render(<SeasonSimulationCenter {...props}/>);
  expect(repo.saveWithActivity).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Alcance"), {target: {value: "0"}});
  fireEvent.click(screen.getByRole("button", {name: "Revisar simulación"}));
  expect(screen.getByText(/1 encuentros pendientes/)).toBeInTheDocument();
  expect(repo.saveWithActivity).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name: "Confirmar simulación local"}));
  expect(repo.saveWithActivity).toHaveBeenCalledTimes(1);await waitFor(() => expect(props.onChanged).toHaveBeenCalledOnce());
});
it("el cambio de universo impide ejecutar la vista previa", async () => {
  const {props,repo} = setup(); render(<SeasonSimulationCenter {...props} getUniverseId={() => "b"}/>);
  fireEvent.change(screen.getByLabelText("Alcance"), {target: {value: "0"}});
  fireEvent.click(screen.getByRole("button", {name: "Revisar simulación"}));
  fireEvent.click(screen.getByRole("button", {name: "Confirmar simulación local"}));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/universo/));expect(repo.saveWithActivity).not.toHaveBeenCalled();
});
it("ofrece navegación al centro sin ejecutar operaciones deportivas", () => {
  const open = vi.fn();const {props} = setup();
  render(<SeasonSimulationNavigation.Provider value={open}><SeasonSimulationAccess tournament={props.tournaments[0]}/></SeasonSimulationNavigation.Provider>);
  fireEvent.click(screen.getByRole("button", {name: "Abrir Centro de simulación"}));
  expect(open).toHaveBeenCalledWith(props.tournaments[0]);
});
