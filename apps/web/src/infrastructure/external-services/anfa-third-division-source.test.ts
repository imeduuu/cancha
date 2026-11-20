// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnfaThirdDivisionSource, anfaCalendarUnavailableMessage } from "./anfa-third-division-source";

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

  it.each([
    ["directo", 404, ""],
    ["a través del proxy", 502, "La fuente oficial respondió con HTTP 404."],
  ])("explica que ANFA no publica el calendario ante un 404 (%s)", async (_via, status, body) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));

    await expect(new AnfaThirdDivisionSource().fetchSeason("tercera-b", "norte"))
      .rejects.toThrow(anfaCalendarUnavailableMessage("Tercera B Norte"));
  });

  it.each([
    [502, "La fuente oficial respondió con HTTP 500."],
    [502, "No se pudo conectar con la fuente oficial."],
    [500, ""],
  ])("otros errores (%i %j) conservan el código HTTP", async (status, body) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));

    await expect(new AnfaThirdDivisionSource().fetchSeason("tercera-a"))
      .rejects.toThrow(`ANFA Tercera División respondió con HTTP ${status} al consultar Tercera A Nacional.`);
  });
});
