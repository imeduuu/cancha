// The project uses jsdom at runtime in tests but does not install @types/jsdom.
// @ts-expect-error jsdom has no declaration package in this project.
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../../application/ports/tournament-repository";
import { importOfficialTournament } from "../../application/use-cases/import-official-tournament";
import { AnfpOfficialLeagueSource } from "./anfp-official-league-source";

const groups = [
  ["Grupo A", ["Coquimbo Unido", "Colo Colo", "Huachipato", "Deportes Concepción"]],
  ["Grupo B", ["Universidad Católica", "Cobresal", "Ñublense", "Universidad de Concepción"]],
  ["Grupo C", ["O'Higgins", "Palestino", "Deportes Limache", "Everton"]],
  ["Grupo D", ["Universidad de Chile", "Audax Italiano", "Unión La Calera", "Deportes La Serena"]],
] as const;

const roundRobin = [
  [[0, 3], [1, 2]],
  [[0, 2], [3, 1]],
  [[0, 1], [2, 3]],
  [[3, 0], [2, 1]],
  [[2, 0], [1, 3]],
  [[1, 0], [3, 2]],
] as const;

function game(
  id: string,
  home: string,
  away: string,
  options: { status?: 0 | 1; score?: string; special?: string; date?: string } = {},
): string {
  const status = options.status ?? 1;
  const [homeScore = "-", awayScore = "-"] = options.score?.split("-") ?? [];
  return `<div class="anwp-fl-game game-status-${status}" data-anwp-match="${id}" data-fl-game-datetime="${options.date ?? "2026-06-01T20:00:00-04:00"}">
    <div class="match-slim__team-home-title">${home}</div>
    <span class="anwp-fl-game__scores-home">${homeScore}</span>
    <div class="match-slim__team-away-title">${away}</div>
    <span class="anwp-fl-game__scores-away">${awayScore}</span>
    ${options.special ? `<div class="match-slim__bottom-special">${options.special}</div>` : ""}
  </div>`;
}

function officialPage(): string {
  const finalStages = `<div class="anwp-section"><div class="competition__stage-title">Finales</div></div>
    <div class="anwp-section"><div class="competition__round-title">Semifinales</div></div>
    <div class="competition__group-wrapper">
      ${game("semi-a-1", "Unión La Calera", "Coquimbo Unido", { score: "0-1", date: "2026-07-08T19:00:00-04:00" })}
      ${game("semi-a-2", "Coquimbo Unido", "Unión La Calera", { score: "0-1", special: "Penales 5-4", date: "2026-07-12T15:00:00-04:00" })}
      ${game("semi-b-1", "Ñublense", "O'Higgins", { score: "2-1", date: "2026-07-09T19:00:00-04:00" })}
      ${game("semi-b-2", "O'Higgins", "Ñublense", { score: "1-0", special: "Penales 4-2", date: "2026-07-12T20:00:00-04:00" })}
    </div>
    <div class="anwp-section"><div class="competition__round-title">Final</div></div>
    <div class="competition__group-wrapper">${game("final", "Coquimbo Unido", "O'Higgins", {
      status: 0,
      date: "-001-11-30T00:00:00-04:42",
    })}</div>`;

  const groupStages = groups.map(([groupName, teams], groupIndex) => {
    const dates = roundRobin.map((fixtures, roundIndex) => `<div class="matchday">
      <div class="competition__round-title">Fecha ${roundIndex + 1}</div>
      ${fixtures.map(([homeIndex, awayIndex], fixtureIndex) => game(
        `g${groupIndex + 1}-${roundIndex + 1}-${fixtureIndex + 1}`,
        teams[homeIndex], teams[awayIndex],
        { score: `${roundIndex % 3}-${fixtureIndex}`, date: `2026-03-${String(10 + roundIndex).padStart(2, "0")}T20:00:00-03:00` },
      )).join("")}
    </div>`).join("");
    return `<div class="competition__group-wrapper"><div class="competition__title-group">${groupName}</div>${dates}</div>`;
  }).join("");

  return `<div class="anwp-section"><div class="competition__stage-title">Temporada regular</div></div>${finalStages}
    <div class="anwp-section"><div class="competition__stage-title">Temporada regular</div></div>${groupStages}`;
}

function createRepository(): TournamentRepository {
  let saved: Tournament[] = [];
  return {
    findAll: () => [...saved],
    save: (tournament) => { saved = [tournament]; },
    saveWithActivity: (tournament) => { saved = [tournament]; },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AnfpOfficialLeagueSource · Copa de la Liga", () => {
  it("recognizes the 2026 competition and imports four groups and 16 unique participants", async () => {
    vi.stubGlobal("DOMParser", new JSDOM("").window.DOMParser);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(officialPage())));

    const season = await new AnfpOfficialLeagueSource().fetchSeason("copa-liga");
    const tournament = await importOfficialTournament(
      { fetchSeason: async () => season },
      createRepository(),
      () => new Date("2026-10-15T12:00:00.000Z"),
      "copa-liga",
    );

    expect(season).toMatchObject({
      id: "anfp-copa-de-la-liga-2026",
      season: 2026,
      competitionType: "cup",
      format: "staged",
      sourceUrl: "https://www.campeonatochileno.cl/competition/copa-de-la-liga/",
    });
    expect(new Set(tournament.teams.map(({ groupName }) => groupName)).size).toBe(4);
    expect(tournament.teams).toHaveLength(16);
    expect(new Set(tournament.teams.map(({ id }) => id)).size).toBe(16);
    expect(tournament.teams.map(({ competitionNumber }) => competitionNumber).sort((a, b) => a! - b!))
      .toEqual(Array.from({ length: 16 }, (_, index) => index + 1));
    expect(tournament.teams.find(({ name }) => name === "Coquimbo Unido")?.competitionNumber).toBe(1);
    expect(tournament.teams.find(({ competitionNumber }) => competitionNumber === 16)?.name)
      .toBe("Deportes Concepción");
    expect(tournament.knockoutStages).toEqual([
      { name: "Copa de la Liga · Semifinales", legs: 2 },
      { name: "Copa de la Liga · Final", legs: 1 },
    ]);
  });

  it("imports group and semifinal scores, penalties, and the postponed final without a result", async () => {
    vi.stubGlobal("DOMParser", new JSDOM("").window.DOMParser);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(officialPage())));
    const repository = createRepository();
    const season = await new AnfpOfficialLeagueSource().fetchSeason("copa-liga");
    const tournament = await importOfficialTournament(
      { fetchSeason: async () => season }, repository,
      () => new Date("2026-10-15T12:00:00.000Z"), "copa-liga",
    );
    const fixtures = tournament.matchdays.flatMap(({ fixtures }) => fixtures);
    const returningSemi = fixtures.find(({ id }) => id.endsWith("semi-a-2"));
    const postponedFinal = fixtures.find(({ id }) => id.endsWith("final"));

    expect(fixtures).toHaveLength(53);
    expect(fixtures.filter(({ result }) => result).length).toBe(52);
    expect(returningSemi).toMatchObject({
      result: { homeGoals: 0, awayGoals: 1, penalties: { homeGoals: 5, awayGoals: 4 } },
      knockoutResolution: "aggregate-then-penalties",
    });
    expect(postponedFinal).toMatchObject({ operationalState: { status: "postponed" } });
    expect(postponedFinal).not.toHaveProperty("result");
  });

  it("rejects incomplete or changed source structures instead of creating false matches", async () => {
    vi.stubGlobal("DOMParser", new JSDOM("").window.DOMParser);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      `<div class="anwp-section"><div class="competition__stage-title">Temporada regular</div></div>`
      + `<div class="competition__group-wrapper"><div class="competition__title-group">Grupo A</div></div>`,
    )));

    await expect(new AnfpOfficialLeagueSource().fetchSeason("copa-liga"))
      .rejects.toThrow(/fases de grupos y eliminatorias|partidos de grupos/);
  });

  it("retains Copa Chile parsing through the existing staged-cup structure", async () => {
    vi.stubGlobal("DOMParser", new JSDOM("").window.DOMParser);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`<div class="anwp-section">
      <div class="competition__stage-title">Fase de grupos</div></div>
      <div class="competition__group-wrapper"><div class="competition__title-group">Grupo A</div>
        <div class="matchday"><div class="competition__round-title">Fecha 1</div>
          ${game("chile-group", "Club A", "Club B", { score: "1-0" })}
        </div></div>
      <div class="anwp-section"><div class="competition__stage-title">Eliminatorias</div></div>
      <div class="anwp-section"><div class="competition__round-title">Semifinal</div></div>
      <div class="competition__group-wrapper">
        ${game("chile-1", "Club A", "Club B", { score: "1-0", date: "2026-07-01T20:00:00-04:00" })}
        ${game("chile-2", "Club B", "Club A", { score: "0-1", date: "2026-07-08T20:00:00-04:00" })}
      </div>`)));

    const season = await new AnfpOfficialLeagueSource().fetchSeason("copa-chile");
    expect(season.matchdays.some(({ phaseName }) => phaseName?.startsWith("Copa Chile · Semifinal"))).toBe(true);
    expect(season.matchdays.some(({ phaseName }) => phaseName === "Copa Chile · Grupo A")).toBe(true);
  });
});
