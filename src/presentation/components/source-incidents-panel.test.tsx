// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { TournamentRepository } from "../../application/ports/tournament-repository";
import { recordSourceRejection, listSourceIncidents } from "../../application/services/source-incidents";
import { SourceIncidentsPanel } from "./source-incidents-panel";
afterEach(cleanup);
it("keeps draft values during rerenders and requires explicit documented manual verification", () => {
  const events: ActivityEvent[] = [];
  const repository: TournamentRepository = { findAll: () => [], save: () => {}, findActivity: () => events, recordActivity: e => { events.push(e); } };
  recordSourceRejection(repository, { id: "test-2026", name: "Liga de prueba", season: 2026,
    sourceUrl: "https://example.org/calendar", matchdays: [{ number: 1, matches: [{ id: "one", homeTeamName: "Club A", awayTeamName: "Club B" }] }] }, "Error de prueba");
  const changed = vi.fn();
  const view = render(<SourceIncidentsPanel repository={repository} onActivityChanged={changed} />);
  fireEvent.change(screen.getByLabelText("Local corregido"), { target: { value: "Club C" } });
  view.rerender(<SourceIncidentsPanel repository={repository} onActivityChanged={changed} />);
  expect(screen.getByLabelText("Local corregido")).toHaveValue("Club C");
  fireEvent.change(screen.getByLabelText("Documento HTTPS"), { target: { value: "https://example.org/document" } });
  fireEvent.change(screen.getByLabelText("Referencia documental"), { target: { value: "Acta de prueba" } });
  fireEvent.change(screen.getByLabelText("Motivo de la revisión"), { target: { value: "Corrección contrastada" } });
  fireEvent.click(screen.getByText("Registrar revisión"));
  expect(screen.getByRole("alert")).toHaveTextContent("confirmación explícita");
  expect(listSourceIncidents(repository)[0].status).toBe("pending");
  fireEvent.click(screen.getByLabelText(/He contrastado/));
  fireEvent.click(screen.getByLabelText(/Confirmo expresamente/));
  fireEvent.click(screen.getByText("Registrar revisión"));
  expect(listSourceIncidents(repository)[0].status).toBe("verified");
  expect(changed).toHaveBeenCalledOnce();
  expect(screen.getByLabelText(/Confirmo expresamente/)).not.toBeChecked();
  expect(events).toHaveLength(2);
});
it("shows a damaged history error without hiding it behind an empty list", () => {
  render(<SourceIncidentsPanel repository={{ findAll: () => [], save: () => {}, findActivity: () => { throw new Error("Historial dañado"); } }} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Historial dañado");
});
