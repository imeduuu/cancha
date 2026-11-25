// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { renderApplication } from "../test-utils/render-application";
import { installTestWebLocks } from "../test-utils/web-locks";
import { LocalStorageTournamentRepository } from "../infrastructure/persistence/local-storage-tournament-repository";
import { App } from "./app";

beforeEach(() => { installTestWebLocks(); localStorage.clear(); });
afterEach(cleanup);

/** A Primera 2027 planned with 10D before calendars were generated automatically: no fixtures. */
function planned2027(teamCount = 4): Tournament {
  const teams = Array.from({length: teamCount}, (_, i) => ({id: `club-${i}`, name: `Club ${String.fromCharCode(65 + i)}`}));
  return {id: "primera-2027-sin-calendario", competitionId: "anfp-liga-primera", name: "Liga de Primera 2027", season: 2027,
    createdAt: "2027-01-01T00:00:00.000Z", teams, legs: 1, tieBreakers: ["goalDifference", "goalsFor"], matchdays: [],
    format: "staged", competitionType: "league", importCoverage: "unknown",
    seasonPreparation: {schemaVersion: 1, sourceTournamentIds: [], plannedParticipants: teams.map(t => t.name), calendarReviews: []},
    competitionRules: {season: 2027, verification: {standings: "pending", placements: "pending"}}};
}

it("generates the round-robin calendar of a planned 2027 season and lets it be simulated", async () => {
  const repository = new LocalStorageTournamentRepository(false);
  repository.save(planned2027());repository.setActiveTournamentId("primera-2027-sin-calendario");
  await renderApplication(<App />);
  fireEvent.click(await screen.findByRole("button", {name: "Generar calendario"}));
  await waitFor(() => expect(repository.findAll()[0].matchdays).toHaveLength(6));
  const stored = repository.findAll()[0];
  expect(stored.matchdays.flatMap(d => d.fixtures)).toHaveLength(12);
  expect(stored.calendarProvenance).toBe("local-generated");
  expect(repository.findActivity().at(-1)?.action).toBe("calendar-programmed");
  expect(await screen.findByText(/Se generó un calendario local: 6 jornadas/)).toBeInTheDocument();
  expect(screen.queryByRole("button", {name: "Generar calendario"})).not.toBeInTheDocument();
  fireEvent.click((await screen.findAllByRole("button", {name: "Simular fecha"}))[0]);
  await waitFor(() => expect(repository.findAll()[0].matchdays[0].fixtures.every(f => f.result)).toBe(true));
  expect(repository.findAll()[0].matchdays.slice(1).flatMap(day => day.fixtures).every(fixture => !fixture.result)).toBe(true);
});

it("shows the calendar action for planned Argentine zones and keeps matches inside each zone", async () => {
  const repository = new LocalStorageTournamentRepository(false);
  const tournament = {...planned2027(), id: "nacional-2027", competitionId: "arg-primera-nacional",
    teams: planned2027().teams.map((team, i) => ({...team, groupName: i < 2 ? "Zona A" : "Zona B"}))};
  repository.save(tournament);repository.setActiveTournamentId(tournament.id);
  await renderApplication(<App />);
  fireEvent.click(await screen.findByRole("button", {name: "Generar calendario"}));
  await waitFor(() => expect(repository.findAll()[0].matchdays).toHaveLength(4));
  const stored = repository.findAll()[0];
  expect(stored.matchdays.flatMap(day => day.fixtures)).toHaveLength(8);
  expect(stored.matchdays.flatMap(day => day.fixtures).filter(fixture =>
    stored.teams.find(team => team.id === fixture.homeTeamId)?.groupName !== stored.teams.find(team => team.id === fixture.awayTeamId)?.groupName)).toHaveLength(4);
  expect(stored.calendarProvenance).toBe("local-generated");
});
