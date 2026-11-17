import { describe, expect, it } from "vitest";
import { getCompetitionRulesConfiguration } from "./competition-rules";

describe("getCompetitionRulesConfiguration", () => {
  it("keeps Argentina's cup-dependent qualification places provisional and explicitly unresolved", () => {
    const rules = getCompetitionRulesConfiguration("arg-liga-profesional-2026");
    expect(rules).toMatchObject({
      season: 2026,
      verification: { standings: "pending", placements: "provisional" },
      conditionalPlacements: [{
        status: "pending",
        description: expect.stringContaining("Copa Argentina"),
      }],
    });
  });

  it("does not claim that the 2025 Ascenso playoff format is verified for 2026", () => {
    const rules = getCompetitionRulesConfiguration("anfp-liga-de-ascenso-2026");
    expect(rules?.verification).toEqual({
      standings: "pending",
      placements: "provisional",
    });
    expect(rules?.placementsNote).toContain("no verificada para 2026");
  });

  it("leaves ANFA playoff positions pending verification", () => {
    for (const id of ["anfa-tercera-a-2026", "anfa-tercera-b-norte-2026", "anfa-tercera-b-sur-2026"]) {
      expect(getCompetitionRulesConfiguration(id)?.verification).toEqual({
        standings: "pending",
        placements: "pending",
      });
    }
  });

  it("keeps competition rules season-specific and does not invent historical presets", () => {
    expect(getCompetitionRulesConfiguration("anfp-liga-de-ascenso-2025")).toBeUndefined();
    expect(getCompetitionRulesConfiguration("afa-copa-argentina-2024")?.season).toBe(2024);
  });

  it("configures the official tie-break order only for Copa de la Liga 2026", () => {
    expect(getCompetitionRulesConfiguration("anfp-copa-de-la-liga-2026")).toMatchObject({
      season: 2026,
      verification: { standings: "verified" },
      tieBreakers: [
        "goalDifference", "wins", "goalsFor", "awayGoals", "redCards", "yellowCards", "competitionNumber",
      ],
    });
    expect(getCompetitionRulesConfiguration("anfp-copa-de-la-liga-2025")).toBeUndefined();
  });

  it("marks base Brazilian cup-qualified places as conditional instead of final allocations", () => {
    const rules = getCompetitionRulesConfiguration("brasileirao-serie-a-2026");
    expect(rules?.verification.placements).toBe("provisional");
    expect(rules?.conditionalPlacements?.[0].status).toBe("pending");
    expect(rules?.conditionalPlacements?.[0].description).toContain("campeón de copa");
    expect(rules?.conditionalPlacements?.[0].description).toContain("campeón de copa");
  });
});
