import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CopaArgentinaOfficialSource,
  CopaDoBrasilOfficialSource,
} from "./south-american-cup-sources";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CopaArgentinaOfficialSource", () => {
  it("imports official rounds, pending fixtures and penalty shootouts", async () => {
    const editions = [{
      id: "14",
      name: "14º EDICIÓN",
      hash: "2026",
      url: "/es/fixture/feed/14_14-EDICION.json",
      default: "1",
      competition_seasons: [
        { id: "3069", name: "32avos de Final" },
        { id: "3070", name: "16avos de Final" },
      ],
    }];
    const feed = [
      {
        id: "3669",
        class: "3069",
        match_status: "5",
        match_status_text: "Finalizado",
        teams: [
          { team_name: "Independiente Rivadavia", score: 1, penalties: 6 },
          { team_name: "Estudiantes", score: 1, penalties: 7 },
        ],
      },
      {
        id: "3678",
        class: "3069",
        match_status: "0",
        match_status_text: "Programado",
        teams: [
          { team_name: "Lanús", score: null, penalties: 0 },
          { team_name: "Sarmiento de La Banda", score: null, penalties: 0 },
        ],
      },
      {
        id: "pending-round",
        class: "3070",
        match_status: "0",
        match_status_text: "Programado",
        teams: [
          { team_name: "Boca", score: null, penalties: 0 },
          { team_name: "River", score: null, penalties: 0 },
        ],
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith("editions.json") ? editions : feed;
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const season = await new CopaArgentinaOfficialSource().fetchSeason("copa-argentina");

    expect(season).toMatchObject({
      id: "afa-copa-argentina-2026",
      season: 2026,
      format: "staged",
      competitionType: "cup",
    });
    expect(season.knockoutStages?.map(({ name, legs }) => [name, legs])).toEqual([
      ["Copa Argentina · 32avos de Final", 1],
      ["Copa Argentina · 16avos de Final", 1],
      ["Copa Argentina · Final", 1],
    ]);
    expect(season.matchdays.map(({ phaseName, matches }) => [phaseName, matches.length])).toEqual([
      ["Copa Argentina · 32avos de Final", 2],
      ["Copa Argentina · 16avos de Final", 1],
    ]);
    expect(season.matchdays[0].matches[0]).toMatchObject({
      homeGoals: 1,
      awayGoals: 1,
      knockoutResolution: "penalties",
      penalties: { homeGoals: 6, awayGoals: 7 },
    });
    expect(season.matchdays[0].matches[1]).not.toHaveProperty("homeGoals");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("CopaDoBrasilOfficialSource", () => {
  it("imports official phases, two-leg round numbers and penalty results", async () => {
    const singleMatchPhase = {
      fase_id: "1995",
      fase_nome: "1ª Fase",
      rodadas_qtd: "1",
      fase_tipo: "eliminacao",
      tipo_rodada: "padrao",
      partidas: "1",
    };
    const twoLegPhase = {
      fase_id: "1999",
      fase_nome: "5ª Fase",
      rodadas_qtd: "2",
      fase_tipo: "eliminacao",
      tipo_rodada: "padrao",
      partidas: "2",
    };
    const game = (
      id: string,
      round: string,
      home: string,
      away: string,
      homeGoals: number | null,
      awayGoals: number | null,
      homePenalties = 0,
      awayPenalties = 0,
    ) => ({
      id_jogo: id,
      num_jogo: id,
      rodada: round,
      mandante: { nome: home, gols: homeGoals, panaltis: String(homePenalties) },
      visitante: { nome: away, gols: awayGoals, panaltis: String(awayPenalties) },
    });
    const initialPayload = `0:{"phasesList":${JSON.stringify([
      singleMatchPhase,
      twoLegPhase,
    ])},"phase":${JSON.stringify(twoLegPhase)}}`;
    const phasePayload = (phase: typeof singleMatchPhase, games: readonly object[]) =>
      `0:{"phasesList":[],"phase":${JSON.stringify(phase)},"data":${JSON.stringify(games)}}`;
    const year = new Date().getFullYear();
    const basePath = `/brazil-cup-source/futebol-brasileiro/tabelas/copa-do-brasil/masculino/${year}`;
    const responses: Record<string, string> = {
      [basePath]: initialPayload,
      [`${basePath}/1995`]: phasePayload(singleMatchPhase, [
        game("one-leg-pending", "1", "Clube A", "Clube B", null, null),
        game("regulation-win", "2", "Clube E", "Clube F", 2, 1, 2, 4),
      ]),
      [`${basePath}/1999`]: phasePayload(twoLegPhase, [
        game("first-leg", "1", "Clube C", "Clube D", 1, 0),
        game("second-leg", "2", "Clube D", "Clube C", 1, 1, 4, 3),
      ]),
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const body = responses[String(input)];
      return body === undefined
        ? new Response("Not found", { status: 404 })
        : new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const season = await new CopaDoBrasilOfficialSource().fetchSeason("copa-brasil");

    expect(season).toMatchObject({
      id: `cbf-copa-do-brasil-${year}`,
      sourceName: "CBF (sitio oficial)",
      format: "staged",
      competitionType: "cup",
    });
    expect(season.knockoutStages?.map(({ name, legs }) => [name, legs])).toEqual([
      ["Copa do Brasil · 1ª Fase", 1],
      ["Copa do Brasil · 5ª Fase", 2],
    ]);
    expect(season.matchdays.map(({ phaseName, number }) => [phaseName, number])).toEqual([
      ["Copa do Brasil · 1ª Fase", 1],
      ["Copa do Brasil · 1ª Fase", 2],
      ["Copa do Brasil · 5ª Fase", 1],
      ["Copa do Brasil · 5ª Fase", 2],
    ]);
    expect(season.matchdays[0].matches[0]).toMatchObject({
      knockoutResolution: "penalties",
    });
    expect(season.matchdays[0].matches[0]).not.toHaveProperty("homeGoals");
    expect(season.matchdays[1].matches[0]).not.toHaveProperty("penalties");
    expect(season.matchdays[3].matches[0]).toMatchObject({
      homeGoals: 1,
      awayGoals: 1,
      penalties: { homeGoals: 4, awayGoals: 3 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
