// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SecondDivisionPanel } from "./second-division-panel";
import { ImportOfficialTournament } from "./import-official-tournament";
import { divisionFixture } from "@cancha/core/domain/services/second-division-test-fixtures";
import { advanceSecondDivision } from "@cancha/core/domain/services/second-division-progression";

afterEach(cleanup);
const repository = { findAll: () => [], save: vi.fn(), saveWithActivity: vi.fn() };
describe("second division presentation", () => {
  it("shows the two Argentine zones including 36 games and exposes rule sources", () => {
    render(<SecondDivisionPanel tournament={advanceSecondDivision(divisionFixture("argentina"))}
      tournaments={[]} repository={repository} onChange={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Zona A · Fase regular" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Zona B · Fase regular" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Consultar reglamento oficial 2026", hidden: true }).getAttribute("href")).toContain("6823");
    expect(screen.getByRole("button", { name: "Revisar nuevas temporadas", hidden: true })).toHaveProperty("disabled", true);
  });
  it("offers each importer under its country with explicit external-provider attribution", async () => {
    const user = userEvent.setup();
    render(<ImportOfficialTournament repository={repository} onImported={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Argentina" }));
    expect(screen.getByText("Primera Nacional Argentina 2026")).toBeTruthy();
    expect(screen.getAllByText(/ESPN/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Brasil" }));
    expect(screen.getByText("Brasileirão Série B 2026")).toBeTruthy();
    expect(screen.queryByText("Primera Nacional Argentina 2026")).toBeNull();
  });
});
