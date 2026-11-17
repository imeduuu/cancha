// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnfaThirdDivisionSource } from "./anfa-third-division-source";

function calendarPage(scoreMarkup: string): string {
  return `<table class="table table-striped table-responsive table-hover"><tbody>
    <tr><td>1</td><td><div class="team-cell"><strong>Local FC</strong></div></td>
    <td><span class="resultado-box">${scoreMarkup}</span></td>
    <td><div class="team-cell"><strong>Visitante FC</strong></div></td></tr>
  </tbody></table>`;
}

function stubCalendar(scoreMarkup: string) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    return new Response(url.includes("?j=")
      ? calendarPage(scoreMarkup)
      : '<a href="calendario_ta.php?j=1">1</a>');
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("AnfaThirdDivisionSource", () => {
  it("imports a match without a score as pending", async () => {
    stubCalendar("");

    const season = await new AnfaThirdDivisionSource().fetchSeason("tercera-a");

    expect(season.matchdays[0].matches[0]).toMatchObject({
      homeTeamName: "Local FC",
      awayTeamName: "Visitante FC",
    });
    expect(season.matchdays[0].matches[0]).not.toHaveProperty("homeGoals");
  });

  it.each(["2-1", " 2-1 "]) ("imports score %j", async (score) => {
    stubCalendar(score);

    const season = await new AnfaThirdDivisionSource().fetchSeason("tercera-a");

    expect(season.matchdays[0].matches[0]).toMatchObject({ homeGoals: 2, awayGoals: 1 });
  });

  it.each(["abc", "2-", "-1-2"]) ("rejects invalid score %j", async (score) => {
    stubCalendar(score);

    await expect(new AnfaThirdDivisionSource().fetchSeason("tercera-a"))
      .rejects.toThrow(/marcador inválido para el partido anfa-j1-local-fc-visitante-fc/);
  });
});
