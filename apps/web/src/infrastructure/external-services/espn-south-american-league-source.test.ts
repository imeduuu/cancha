import { afterEach, describe, expect, it, vi } from "vitest";
import { EspnSouthAmericanLeagueSource } from "./espn-south-american-league-source";

interface TestEventOptions {
  id: string;
  date: string;
  phase: string;
  home: string;
  away: string;
  homeGoals?: number;
  awayGoals?: number;
  postponed?: boolean;
  statusName?: string;
  statusState?: string;
  statusCompleted?: boolean;
  details?: readonly object[];
}

function event({
  id,
  date,
  phase,
  home,
  away,
  homeGoals = 0,
  awayGoals = 0,
  postponed = false,
  statusName,
  statusState,
  statusCompleted,
  details,
}: TestEventOptions) {
  const completed = !id.startsWith("pending") && !postponed;
  return {
    id,
    date,
    season: { slug: phase },
    competitions: [{
      status: {
        type: {
          completed: statusCompleted ?? completed,
          state: statusState ?? (completed ? "post" : "pre"),
          name: postponed ? "STATUS_POSTPONED" : statusName
            ?? (completed ? "STATUS_FULL_TIME" : "STATUS_SCHEDULED"),
        },
      },
      competitors: [
        {
          homeAway: "home",
          team: { displayName: home, id: home },
          ...(completed ? { score: String(homeGoals) } : {}),
        },
        {
          homeAway: "away",
          team: { displayName: away, id: away },
          ...(completed ? { score: String(awayGoals) } : {}),
        },
      ],
      ...(details ? { details } : {}),
    }],
  };
}

function stubScoreboard(events: readonly object[]) {
  const response = new Response(JSON.stringify({ events }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EspnSouthAmericanLeagueSource", () => {
  it("reports an unexpected JSON response in user-readable terms", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    await expect(new EspnSouthAmericanLeagueSource().fetchSeason("brasil-primera"))
      .rejects.toThrow("formato JSON inválido");
  });

  it("imports Argentina Apertura, playoffs, Clausura and published results as separate stages", async () => {
    const fetchMock = stubScoreboard([
      event({
        id: "apertura-1",
        date: "2026-01-22T20:00:00Z",
        phase: "torneo-apertura",
        home: "Boca Juniors",
        away: "River Plate",
        homeGoals: 2,
        awayGoals: 1,
      }),
      event({
        id: "pending-apertura-2",
        date: "2026-01-23T20:00:00Z",
        phase: "torneo-apertura",
        home: "Lanús",
        away: "Racing Club",
      }),
      event({
        id: "apertura-r16-1",
        date: "2026-05-20T20:00:00Z",
        phase: "apertura---round-of-16",
        home: "Boca Juniors",
        away: "Racing Club",
      }),
      event({
        id: "clausura-1",
        date: "2026-07-01T20:00:00Z",
        phase: "torneo-clausura",
        home: "River Plate",
        away: "Lanús",
      }),
    ]);

    const season = await new EspnSouthAmericanLeagueSource()
      .fetchSeason("argentina-primera");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://site.api.espn.com/apis/site/v2/sports/soccer/arg.1/scoreboard?dates=2026&limit=1000",
    );
    expect(season).toMatchObject({
      id: "arg-liga-profesional-2026",
      season: 2026,
      format: "staged",
      sourceName: "ESPN (API pública)",
    });
    expect(season.matchdays.map(({ phaseName, number }) => [phaseName, number])).toEqual([
      ["Torneo Apertura · Fase regular", 1],
      ["Torneo Apertura · Octavos de final", 1],
      ["Torneo Clausura · Fase regular", 1],
    ]);
    expect(season.matchdays[0].matches[0]).toMatchObject({
      id: "apertura-1",
      homeTeamName: "Boca Juniors",
      awayTeamName: "River Plate",
      homeGoals: 2,
      awayGoals: 1,
      homeGroupName: "Zona A",
      awayGroupName: "Zona B",
    });
    expect(season.matchdays[0].matches[1]).not.toHaveProperty("homeGoals");
    expect(season.placementRules).toEqual({
      championPlaces: 1,
      libertadoresPlaces: { from: 2, to: 2 },
      libertadoresQualifyingPlaces: { from: 3, to: 3 },
      sudamericanaPlaces: { from: 4, to: 9 },
      relegationPlaces: 1,
    });
  });

  it("imports Argentine knockout scores split into regulation, extra time and penalties", async () => {
    const details = [
      { team: { id: "River Plate" }, scoreValue: 1, scoringPlay: true, shootout: false, clock: { displayValue: "37'" } },
      { team: { id: "San Lorenzo" }, scoreValue: 1, scoringPlay: true, shootout: false, clock: { displayValue: "55'" } },
      { team: { id: "San Lorenzo" }, scoreValue: 1, scoringPlay: true, shootout: false, clock: { displayValue: "94'" } },
      { team: { id: "River Plate" }, scoreValue: 1, scoringPlay: true, shootout: false, clock: { displayValue: "120'+1'" } },
      ...[3, 4].flatMap((score, index) =>
        Array.from({ length: score }, () => ({
          team: { id: index === 0 ? "River Plate" : "San Lorenzo" },
          scoreValue: 1,
          scoringPlay: true,
          shootout: true,
        })),
      ),
    ];
    stubScoreboard([event({
      id: "completed-shootout",
      date: "2026-05-17T20:00:00Z",
      phase: "apertura---semifinals",
      home: "River Plate",
      away: "San Lorenzo",
      homeGoals: 2,
      awayGoals: 2,
      statusName: "STATUS_FINAL_PEN",
      details,
    })]);

    const season = await new EspnSouthAmericanLeagueSource()
      .fetchSeason("argentina-primera");

    expect(season.matchdays[0].matches[0]).toMatchObject({
      homeGoals: 1,
      awayGoals: 1,
      extraTime: { homeGoals: 1, awayGoals: 1 },
      penalties: { homeGoals: 3, awayGoals: 4 },
      knockoutResolution: "extra-time-then-penalties",
    });
  });

  it("uses direct penalties for knockout matches ending after regulation without extra time", async () => {
    stubScoreboard([event({
      id: "direct-penalties",
      date: "2026-05-17T20:00:00Z",
      phase: "apertura---semifinals",
      home: "Belgrano (Córdoba)",
      away: "Argentinos Juniors",
      homeGoals: 1,
      awayGoals: 1,
      statusName: "STATUS_FINAL_PEN",
      details: [
        { team: { id: "Belgrano (Córdoba)" }, scoreValue: 1, scoringPlay: true, shootout: false, clock: { displayValue: "7'" } },
        { team: { id: "Argentinos Juniors" }, scoreValue: 1, scoringPlay: true, shootout: false, clock: { displayValue: "90'+4'" } },
        ...[4, 3].flatMap((score, index) =>
          Array.from({ length: score }, () => ({
            team: { id: index === 0 ? "Belgrano (Córdoba)" : "Argentinos Juniors" },
            scoreValue: 1,
            scoringPlay: true,
            shootout: true,
          })),
        ),
      ],
    })]);

    const season = await new EspnSouthAmericanLeagueSource()
      .fetchSeason("argentina-primera");

    expect(season.matchdays[0].matches[0]).toMatchObject({
      homeGoals: 1,
      awayGoals: 1,
      penalties: { homeGoals: 4, awayGoals: 3 },
      knockoutResolution: "penalties",
    });
    expect(season.matchdays[0].matches[0]).not.toHaveProperty("extraTime");
  });

  it("restores only a postponed Brazilian return fixture missing from the active schedule", async () => {
    const teamNames = Array.from({ length: 20 }, (_, index) => `Club ${String(index).padStart(2, "0")}`);
    const pairings: { home: string; away: string }[] = [];
    let rotation = [...teamNames];
    for (let round = 0; round < teamNames.length - 1; round += 1) {
      for (let index = 0; index < teamNames.length / 2; index += 1) {
        pairings.push({
          home: rotation[index],
          away: rotation[rotation.length - index - 1],
        });
      }
      rotation = [
        rotation[0],
        rotation[rotation.length - 1],
        ...rotation.slice(1, -1),
      ];
    }
    const matches = pairings.flatMap((pairing, index) => [
      event({
        id: `brazil-first-${index}`,
        date: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
        phase: "2026-brasileiro-serie-a",
        ...pairing,
        homeGoals: 1,
        awayGoals: 0,
      }),
      ...(index === 0 ? [] : [event({
        id: `brazil-return-${index}`,
        date: new Date(Date.UTC(2026, 6, index + 1)).toISOString(),
        phase: "2026-brasileiro-serie-a",
        home: pairing.away,
        away: pairing.home,
        homeGoals: 1,
        awayGoals: 0,
      })]),
    ]);
    matches.push(event({
      id: "postponed-missing-return",
      date: "2026-03-01T20:00:00Z",
      phase: "2026-brasileiro-serie-a",
      home: pairings[0].away,
      away: pairings[0].home,
      postponed: true,
    }), ...pairings.slice(1, 4).map((pairing, index) => event({
      id: `postponed-already-rescheduled-${index}`,
      date: new Date(Date.UTC(2026, 3, index + 1)).toISOString(),
      phase: "2026-brasileiro-serie-a",
      home: pairing.home,
      away: pairing.away,
      postponed: true,
    })));
    stubScoreboard(matches);

    const season = await new EspnSouthAmericanLeagueSource()
      .fetchSeason("brasil-primera");

    expect(season).toMatchObject({
      id: "brasileirao-serie-a-2026",
      name: "Campeonato Brasileiro Série A",
      format: "staged",
      placementRules: {
        championPlaces: 1,
        libertadoresPlaces: { from: 1, to: 4 },
        libertadoresQualifyingPlaces: { from: 5, to: 6 },
        sudamericanaPlaces: { from: 7, to: 12 },
        relegationPlaces: 4,
      },
    });
    const fixtures = season.matchdays.flatMap((matchday) => matchday.matches);
    expect(fixtures).toHaveLength(380);
    expect(fixtures.find((match) => match.id === "postponed-missing-return"))
      .not.toHaveProperty("homeGoals");
    expect(fixtures.some((match) => match.id.startsWith("postponed-already-rescheduled"))).toBe(false);
    expect(season.matchdays).toHaveLength(38);
    expect(season.matchdays.every((matchday) => matchday.matches.length === 10)).toBe(true);
    expect(season.matchdays.every((matchday) => {
      const teamNamesInRound = matchday.matches.flatMap((match) => [
        match.homeTeamName,
        match.awayTeamName,
      ]);
      return new Set(teamNamesInRound).size === teamNamesInRound.length;
    })).toBe(true);
    expect(fixtures.find((match) => match.id === "postponed-missing-return"))
      .toMatchObject({ operationalStatus: "postponed" });
  });

  it("preserves ESPN operational states and completed results in published fixtures", async () => {
    stubScoreboard([
      event({ id: "pending-scheduled-1", date: "2026-04-01T20:00:00Z", phase: "torneo-apertura", home: "Boca Juniors", away: "River Plate" }),
      event({ id: "cancelled-1", date: "2026-04-02T20:00:00Z", phase: "torneo-apertura", home: "Lanús", away: "Racing Club", statusName: "STATUS_CANCELED" }),
      event({ id: "suspended-1", date: "2026-04-03T20:00:00Z", phase: "torneo-apertura", home: "Rosario Central", away: "Newell's Old Boys", statusName: "STATUS_SUSPENDED", statusCompleted: false }),
      event({ id: "finished-1", date: "2026-04-04T20:00:00Z", phase: "torneo-apertura", home: "Platense", away: "Defensa y Justicia", homeGoals: 2, awayGoals: 1 }),
    ]);

    const season = await new EspnSouthAmericanLeagueSource().fetchSeason("argentina-primera");
    const matches = season.matchdays.flatMap(({ matches: round }) => round);

    expect(matches).toHaveLength(4);
    expect(matches.find(({ id }) => id === "pending-scheduled-1"))
      .toMatchObject({ operationalStatus: "scheduled", schedule: { date: "2026-04-01", time: "20:00", utcOffset: "Z" } });
    expect(matches.find(({ id }) => id === "cancelled-1"))
      .toMatchObject({ operationalStatus: "cancelled" });
    expect(matches.find(({ id }) => id === "suspended-1"))
      .toMatchObject({ operationalStatus: "suspended" });
    expect(matches.find(({ id }) => id === "finished-1"))
      .toMatchObject({ operationalStatus: "finished", homeGoals: 2, awayGoals: 1 });
  });

  it("preserves date-only schedules without inventing a kickoff time and rejects invalid dates", async () => {
    stubScoreboard([event({
      id: "date-only",
      date: "2026-04-01",
      phase: "torneo-apertura",
      home: "Boca Juniors",
      away: "River Plate",
    })]);
    const season = await new EspnSouthAmericanLeagueSource().fetchSeason("argentina-primera");
    expect(season.matchdays.flatMap(({ matches }) => matches).find(({ id }) => id === "date-only")?.schedule)
      .toEqual({ date: "2026-04-01" });

    stubScoreboard([event({
      id: "bad-date",
      date: "2026-02-30T20:00:00Z",
      phase: "torneo-apertura",
      home: "Boca Juniors",
      away: "River Plate",
    })]);
    await expect(new EspnSouthAmericanLeagueSource().fetchSeason("argentina-primera"))
      .rejects.toThrow(/bad-date/);
  });

  it("rejects an ESPN event with unknown and incomplete status data", async () => {
    stubScoreboard([event({
      id: "unknown-1",
      date: "2026-04-01T20:00:00Z",
      phase: "torneo-apertura",
      home: "Boca Juniors",
      away: "River Plate",
      statusName: "STATUS_UNRECOGNIZED",
      statusState: "post",
      statusCompleted: false,
    })]);

    await expect(new EspnSouthAmericanLeagueSource().fetchSeason("argentina-primera"))
      .rejects.toThrow(/estado desconocido o incompleto/);
  });

  it("reports an upstream HTTP error instead of returning an empty season", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));

    await expect(new EspnSouthAmericanLeagueSource().fetchSeason("brasil-primera"))
      .rejects.toThrow("La API de ESPN respondió con HTTP 503.");
  });
});

describe("published future calendars", () => {
  function futurePayload(year=2027) {
    return { events: [{ ...event({id:"pending-2027",date:"2027-04-01T18:00:00Z",phase:"published-new-phase",home:"Club A",away:"Club B"}),season:{year,slug:"published-new-phase"} }] };
  }
  function futureStandings(year=2027) { return {standings:{season:year,entries:[{team:{displayName:"Club A"}},{team:{displayName:"Club B"}}]}}; }
  it("requests the selected year, preserves published phases and leaves future sporting rules absent",async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(futurePayload())))
      .mockResolvedValueOnce(new Response(JSON.stringify(futureStandings())));vi.stubGlobal("fetch",fetchMock);
    const result=await new EspnSouthAmericanLeagueSource().fetchPublishedSeason("brasil-serie-b",2027);
    expect(String(fetchMock.mock.calls[0][0])).toContain("dates=2027");expect(String(fetchMock.mock.calls[1][0])).toContain("season=2027");
    expect(result.id).toBe("brasileirao-serie-b-2027");expect(result.matchdays[0].phaseName).toBe("published-new-phase");
    expect(result.placementRules).toBeUndefined();expect(result.knockoutStages).toBeUndefined();expect(result.teams).toHaveLength(2);
  });
  it("rejects another year's events before attempting roster comparison",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify(futurePayload(2026)))));
    await expect(new EspnSouthAmericanLeagueSource().fetchPublishedSeason("argentina-nacional",2027)).rejects.toThrow("otra temporada");
  });
  it("rejects a roster that does not prove the requested year",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(futurePayload())))
      .mockResolvedValueOnce(new Response(JSON.stringify(futureStandings(2026)))));
    await expect(new EspnSouthAmericanLeagueSource().fetchPublishedSeason("brasil-primera",2027)).rejects.toThrow("año solicitado");
  });
  it("reports an unpublished calendar without making up fixtures",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({events:[]}))));
    await expect(new EspnSouthAmericanLeagueSource().fetchPublishedSeason("argentina-primera",2028)).rejects.toThrow("No hay calendario");
  });
});

it("rejects an explicitly wrong season in a first-division 2026 response",async()=>{
 const wrong={...event({id:"pending-year",date:"2026-04-01T18:00:00Z",phase:"2026-brasileiro",home:"Club A",away:"Club B"}),season:{year:2027,slug:"2026-brasileiro"}};
 stubScoreboard([wrong]);
 await expect(new EspnSouthAmericanLeagueSource().fetchSeason("brasil-primera")).rejects.toThrow(/temporada/i);
});
