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
function planned2027(): Tournament {
  const teams = Array.from({length: 16}, (_, i) => ({id: `club-${i}`, name: `Club ${String.fromCharCode(65 + i)}`}));
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
  await waitFor(() => expect(repository.findAll()[0].matchdays).toHaveLength(30));
  const stored = repository.findAll()[0];
  expect(stored.matchdays.flatMap(d => d.fixtures)).toHaveLength(240);
  expect(stored.calendarProvenance).toBe("local-generated");
  expect(repository.findActivity().at(-1)?.action).toBe("calendar-programmed");
  expect(await screen.findByText(/Se generó un calendario local todos contra todos: 30 jornadas/)).toBeInTheDocument();
  expect(screen.queryByRole("button", {name: "Generar calendario"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Simular campeonato"}));
  await waitFor(() => expect(repository.findAll()[0].matchdays.flatMap(d => d.fixtures).every(f => f.result)).toBe(true));
});
