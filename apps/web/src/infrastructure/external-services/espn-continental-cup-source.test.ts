import { afterEach, describe, expect, it, vi } from "vitest";
import { EspnContinentalCupSource } from "./espn-continental-cup-source";

function event(
  id: string,
  slug: string,
  home: string,
  away: string,
  options: {
    readonly leg?: 1 | 2;
    readonly homeGoals?: number;
    readonly awayGoals?: number;
    readonly homePenalties?: number;
    readonly awayPenalties?: number;
    readonly completed?: boolean;
    readonly groupName?: string;
    readonly statusName?: string;
    readonly statusState?: string;
  } = {},
) {
  const completed = options.completed ?? true;
  return {
    id,
    date: `2026-10-${String(id.charCodeAt(0) % 20 + 1).padStart(2, "0")}T20:00:00Z`,
    season: { slug },
    competitions: [{
      status: { type: {
        name: options.statusName ?? (completed ? "STATUS_FULL_TIME" : "STATUS_SCHEDULED"),
        state: options.statusState ?? (completed ? "post" : "pre"),
        completed,
      } },
      ...(options.leg ? { leg: { value: options.leg } } : {}),
      ...(options.groupName ? { group: { name: options.groupName } } : {}),
      competitors: [
        {
          homeAway: "home",
          team: { id: `home-${id}`, displayName: home },
          ...(completed ? { score: String(options.homeGoals ?? 0) } : {}),
          ...(options.homePenalties !== undefined
            ? { shootoutScore: options.homePenalties }
            : {}),
        },
        {
          homeAway: "away",
          team: { id: `away-${id}`, displayName: away },
          ...(completed ? { score: String(options.awayGoals ?? 0) } : {}),
          ...(options.awayPenalties !== undefined
            ? { shootoutScore: options.awayPenalties }
            : {}),
        },
      ],
    }],
  };
}

function stubEvents(events: readonly object[]) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ events }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EspnContinentalCupSource", () => {
  it("reports an unexpected JSON response in user-readable terms", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    await expect(new EspnContinentalCupSource().fetchSeason("libertadores"))
      .rejects.toThrow("formato JSON inválido");
  });

  it("imports Libertadores qualifying rounds, groups and return-leg penalties without TBD finalists", async () => {
    const fetchMock = stubEvents([
      event("qualifying-first", "first-stage", "Team A", "Team B", {
        leg: 1,
        homeGoals: 1,
      }),
      event("qualifying-return", "first-stage", "Team B", "Team A", {
        leg: 2,
        homePenalties: 4,
        awayPenalties: 3,
      }),
      event("group-fixture", "group-stage", "Team C", "Team D", {
        completed: false,
        groupName: "Group C",
      }),
      event("round-of-16", "round-of-16", "Team E", "Team F", {
        leg: 1,
        completed: false,
      }),
      event("semifinal", "semifinals", "Team G", "Team H", {
        leg: 2,
        completed: false,
      }),
      event("final", "final", "TBD Home", "TBD Away", { completed: false }),
    ]);

    const season = await new EspnContinentalCupSource().fetchSeason("libertadores");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://site.api.espn.com/apis/site/v2/sports/soccer/conmebol.libertadores/scoreboard?dates=2026&limit=1000",
    );
    expect(season).toMatchObject({
      id: "conmebol-libertadores-2026",
      competitionType: "cup",
      format: "staged",
    });
    expect(season.matchdays.map(({ phaseName, matches }) => [phaseName, matches.length])).toEqual([
      ["Copa Libertadores · Fase de grupos", 1],
      ["Copa Libertadores · Fase previa 1 · Ida", 1],
      ["Copa Libertadores · Fase previa 1 · Vuelta", 1],
      ["Copa Libertadores · Octavos de final · Ida", 1],
      ["Copa Libertadores · Semifinales · Vuelta", 1],
    ]);
    expect(season.matchdays[2].matches[0]).toMatchObject({
      knockoutResolution: "aggregate-then-penalties",
      penalties: { homeGoals: 4, awayGoals: 3 },
    });
    expect(season.matchdays[1].matches[0]).not.toHaveProperty("knockoutResolution");
    expect(season.matchdays[3].matches[0]).not.toHaveProperty("knockoutResolution");
    expect(season.matchdays[0].matches[0]).toMatchObject({
      homeGroupName: "Group C",
      awayGroupName: "Group C",
    });
    expect(season.knockoutStages?.find(({ name }) => name.endsWith("Fase previa 3")))
      .toMatchObject({ advanceWinners: false });
    expect(season.matchdays.some(({ matches }) =>
      matches.some(({ homeTeamName }) => homeTeamName.startsWith("TBD")),
    )).toBe(false);
  });

  it("imports Sudamericana's group and playoff formats with pending future stages", async () => {
    stubEvents([
      event("first-stage", "first-stage", "Team A", "Team B"),
      event("group-stage", "group-stage", "Team C", "Team D", { completed: false }),
      event("playoff-first", "knockout-round-playoffs", "Team E", "Team F", {
        leg: 1,
        completed: false,
      }),
      event("playoff-return", "knockout-round-playoffs", "Team F", "Team E", {
        leg: 2,
        completed: false,
      }),
      event("final", "final", "To Be Determined", "To Be Determined", { completed: false }),
    ]);

    const season = await new EspnContinentalCupSource().fetchSeason("sudamericana");

    expect(season).toMatchObject({
      id: "conmebol-sudamericana-2026",
      competitionType: "cup",
    });
    expect(season.matchdays.map(({ phaseName }) => phaseName)).toEqual([
      "Copa Sudamericana · Fase de grupos",
      "Copa Sudamericana · Primera fase",
      "Copa Sudamericana · Playoff de octavos · Ida",
      "Copa Sudamericana · Playoff de octavos · Vuelta",
    ]);
    expect(season.knockoutStages?.find(({ name }) => name.endsWith("Playoff de octavos")))
      .toMatchObject({ legs: 2, advanceWinners: false });
  });

  it("preserves supported ESPN operational states, pending matches and final scores", async () => {
    stubEvents([
      event("scheduled", "group-stage", "Team A", "Team B", { completed: false }),
      event("postponed", "group-stage", "Team C", "Team D", {
        completed: false,
        statusName: "STATUS_POSTPONED",
        statusState: "post",
      }),
      event("cancelled", "group-stage", "Team E", "Team F", {
        completed: false,
        statusName: "STATUS_CANCELED",
        statusState: "post",
      }),
      event("suspended", "group-stage", "Team G", "Team H", {
        completed: false,
        statusName: "STATUS_SUSPENDED",
        statusState: "in",
      }),
      event("finished", "group-stage", "Team I", "Team J", { homeGoals: 2, awayGoals: 0 }),
    ]);

    const season = await new EspnContinentalCupSource().fetchSeason("libertadores");
    const matches = season.matchdays.flatMap(({ matches: round }) => round);

    expect(matches).toHaveLength(5);
    expect(matches.find(({ id }) => id === "scheduled")).toMatchObject({ operationalStatus: "scheduled" });
    expect(matches.find(({ id }) => id === "postponed")).toMatchObject({ operationalStatus: "postponed" });
    expect(matches.find(({ id }) => id === "cancelled")).toMatchObject({ operationalStatus: "cancelled" });
    expect(matches.find(({ id }) => id === "suspended")).toMatchObject({ operationalStatus: "suspended" });
    expect(matches.find(({ id }) => id === "finished"))
      .toMatchObject({ operationalStatus: "finished", homeGoals: 2, awayGoals: 0 });
  });

  it("does not import an abandoned event as a normal pending fixture", async () => {
    stubEvents([event("abandoned", "group-stage", "Team A", "Team B", {
      completed: false,
      statusName: "STATUS_ABANDONED",
      statusState: "post",
    })]);

    await expect(new EspnContinentalCupSource().fetchSeason("libertadores"))
      .rejects.toThrow("ESPN no publicó partidos importables");
  });

  it("rejects unknown or incomplete status data", async () => {
    stubEvents([event("unknown", "group-stage", "Team A", "Team B", {
      completed: false,
      statusName: "STATUS_UNRECOGNIZED",
      statusState: "post",
    })]);

    await expect(new EspnContinentalCupSource().fetchSeason("libertadores"))
      .rejects.toThrow(/estado desconocido o incompleto/);
  });
});

it("rejects another explicitly published year in a continental response",async()=>{
 const wrong={...event("year","group-stage","Club A","Club B"),season:{year:2027,slug:"group-stage"}};
 stubEvents([wrong]);
 await expect(new EspnContinentalCupSource().fetchSeason("libertadores")).rejects.toThrow(/temporada/i);
});
