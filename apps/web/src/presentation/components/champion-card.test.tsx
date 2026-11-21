// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { closureLeague } from "@cancha/core/test-utils/season-closure-fixtures";
import { ChampionCards } from "./champion-card";

afterEach(cleanup);
const pending = (t: Tournament): Tournament => ({...t, importCoverage: "unknown",
  competitionRules: {season: 2026, verification: {standings: "pending", placements: "provisional"}}});
const simulation = (t: Tournament): ActivityEvent => ({id: "sim", action: "matches-simulated", tournamentId: t.id,
  tournamentName: t.name, summary: "Simulación", occurredAt: t.createdAt});

it("shows a verified champion with its runner-up", () => {
  const t = closureLeague();
  render(<ChampionCards tournament={t} />);
  const card = screen.getByRole("region", {name: `Campeón: ${t.teams[0].name}`});
  expect(within(card).getByText("Reglamento verificado")).toBeVisible();
  expect(within(card).getByText(`Subcampeón: ${t.teams[1].name}`)).toBeVisible();
});

it("labels a simulated champion as unofficial", () => {
  const t = pending(closureLeague());
  render(<ChampionCards tournament={t} activity={[simulation(t)]} />);
  const card = screen.getByRole("region", {name: `Campeón (simulado): ${t.teams[0].name}`});
  expect(within(card).getByText("Simulado · no oficial")).toBeVisible();
  expect(within(card).getByText(/No es un resultado oficial/)).toBeVisible();
});

it("labels an imported champion with pending rules as calculated", () => {
  const t = pending(closureLeague());
  render(<ChampionCards tournament={t} />);
  expect(within(screen.getByRole("region", {name: `Campeón calculado: ${t.teams[0].name}`}))
    .getByText("Calculado · reglamento pendiente")).toBeVisible();
});

it("renders nothing while the league is undecided", () => {
  const t = closureLeague(), drawn = {...t, matchdays: t.matchdays.map(d => ({...d, fixtures: d.fixtures.map(f => ({...f, result: {homeGoals: 0, awayGoals: 0}}))}))};
  const {container} = render(<ChampionCards tournament={drawn} />);
  expect(container).toBeEmptyDOMElement();
});
