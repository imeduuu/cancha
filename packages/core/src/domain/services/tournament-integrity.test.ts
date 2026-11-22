import { describe, expect, it } from "vitest";
import type { Tournament } from "../entities/tournament";
import { generateRoundRobinSchedule } from "./round-robin-scheduler";
import { validateTournamentIntegrity } from "./tournament-integrity";

function createTournament(teamCount: number): Tournament {
  const teams = Array.from({ length: teamCount }, (_, index) => ({
    id: `team-${index + 1}`,
    name: `Club ${index + 1}`,
  }));
  return {
    id: "test-league",
    name: "Test League",
    teams,
    legs: 2,
    tieBreakers: ["goalDifference", "goalsFor"],
    matchdays: generateRoundRobinSchedule(teams, 2),
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("validateTournamentIntegrity", () => {
  it.each([4, 5])("accepts valid round-robin calendars with %i teams", (teamCount) => {
    expect(validateTournamentIntegrity(createTournament(teamCount))).toEqual([]);
  });

  it.each([0, 4])("accepts %i relegation places for a four-team tournament", (relegationPlaces) => {
    expect(validateTournamentIntegrity({
      ...createTournament(4),
      placementRules: { relegationPlaces },
    })).toEqual([]);
  });

  it.each([-1, 1.5, 5])("rejects invalid relegationPlaces %i for a four-team tournament", (relegationPlaces) => {
    expect(validateTournamentIntegrity({
      ...createTournament(4),
      placementRules: { relegationPlaces },
    }).join(" ")).toContain("Puestos de descenso");
  });

  it("rejects competition rules tied to a different season", () => {
    const tournament: Tournament = {
      ...createTournament(4),
      season: 2026,
      competitionRules: {
        season: 2025,
        verification: { standings: "pending", placements: "pending" },
      },
    };

    expect(validateTournamentIntegrity(tournament).join(" "))
      .toContain("temporada del torneo y la de sus reglas");
  });

  it("accepts matching seasons and legacy records with only a rules season", () => {
    const tournament = createTournament(4);
    const current: Tournament = {
      ...tournament,
      season: 2026,
      competitionRules: {
        season: 2026,
        verification: { standings: "pending", placements: "provisional" },
      },
    };
    const historical: Tournament = {
      ...tournament,
      competitionRules: {
        season: 2025,
        verification: { standings: "pending", placements: "pending" },
      },
    };

    expect(validateTournamentIntegrity(current)).toEqual([]);
    expect(validateTournamentIntegrity(historical)).toEqual([]);
  });

  it("rejects the same local fixture repeated in different dates of a single-round league", () => {
    const tournament = createTournament(4);
    const first = tournament.matchdays[0].fixtures[0];
    const invalid: Tournament = {
      ...tournament,
      legs: 1,
      matchdays: [
        { ...tournament.matchdays[0], fixtures: [first] },
        {
          ...tournament.matchdays[1],
          number: 2,
          fixtures: [{ ...first, id: "repeated-at-home" }],
        },
      ],
    };

    expect(validateTournamentIntegrity(invalid).join(" "))
      .toMatch(/Fase "Fase sin nombre", fechas 1, 2.*Club \d+.*Club \d+/);
  });

  it("rejects two legs with the same home team while accepting the scheduled return leg", () => {
    const tournament = createTournament(4);
    const firstFixture = tournament.matchdays[0].fixtures[0];
    const validReturn = validateTournamentIntegrity(tournament);
    const secondLeg = tournament.matchdays.find((matchday) => matchday.leg === 2);
    const returnFixture = secondLeg?.fixtures.find((fixture) =>
      fixture.homeTeamId === firstFixture.awayTeamId
      && fixture.awayTeamId === firstFixture.homeTeamId,
    );
    expect(validReturn).toEqual([]);
    expect(returnFixture).toBeDefined();
    if (!secondLeg || !returnFixture) throw new Error("Falta la vuelta del partido de prueba.");

    const invalid: Tournament = {
      ...tournament,
      matchdays: tournament.matchdays.map((matchday) => matchday === secondLeg
        ? {
          ...matchday,
          fixtures: matchday.fixtures.map((fixture) => fixture.id === returnFixture.id
            ? { ...fixture, homeTeamId: firstFixture.homeTeamId, awayTeamId: firstFixture.awayTeamId }
            : fixture),
        }
        : matchday),
    };
    expect(validateTournamentIntegrity(invalid).join(" ")).toContain("localía incompatible con 2 rueda(s)");
  });

  it("does not confuse identical pairings in distinct knockout phases", () => {
    const base = createTournament(4);
    const staged: Tournament = {
      ...base,
      format: "staged",
      competitionType: "cup",
      knockoutStages: [
        { name: "Fase previa", legs: 1 },
        { name: "Final", legs: 1 },
      ],
      matchdays: [
        {
          number: 1,
          leg: 1,
          phaseName: "Fase previa",
          fixtures: [{ id: "first-phase", homeTeamId: "team-1", awayTeamId: "team-2" }],
        },
        {
          number: 1,
          leg: 2,
          phaseName: "Final",
          fixtures: [{ id: "later-phase", homeTeamId: "team-1", awayTeamId: "team-2" }],
        },
      ],
    };

    expect(validateTournamentIntegrity(staged)).toEqual([]);
  });

  it("allows a league playoff to replay a pairing already played in the regular season", () => {
    const base = createTournament(4);
    const regularFixture = base.matchdays[0].fixtures[0];
    const tournament: Tournament = {
      ...base,
      knockoutStages: [{ name: "Liguilla Ascenso", legs: 2, advanceWinners: false }],
      matchdays: [
        ...base.matchdays,
        {
          number: 1,
          leg: 1,
          phaseName: "Liguilla Ascenso · Ida",
          fixtures: [{ ...regularFixture, id: "playoff-first-leg" }],
        },
        {
          number: 1,
          leg: 2,
          phaseName: "Liguilla Ascenso · Vuelta",
          fixtures: [{
            ...regularFixture,
            id: "playoff-return-leg",
            homeTeamId: regularFixture.awayTeamId,
            awayTeamId: regularFixture.homeTeamId,
          }],
        },
      ],
    };

    expect(validateTournamentIntegrity(tournament)).toEqual([]);
  });

  it("accepts the configured ida and vuelta of a two-leg knockout stage", () => {
    const base = createTournament(4);
    const staged: Tournament = {
      ...base,
      format: "staged",
      competitionType: "cup",
      knockoutStages: [{ name: "Semifinales", legs: 2 }],
      matchdays: [
        {
          number: 1,
          leg: 1,
          phaseName: "Semifinales · Ida",
          fixtures: [{ id: "semi-first", homeTeamId: "team-1", awayTeamId: "team-2" }],
        },
        {
          number: 1,
          leg: 2,
          phaseName: "Semifinales · Vuelta",
          fixtures: [{ id: "semi-return", homeTeamId: "team-2", awayTeamId: "team-1" }],
        },
      ],
    };

    expect(validateTournamentIntegrity(staged)).toEqual([]);
    const sameHomeTwice: Tournament = {
      ...staged,
      matchdays: staged.matchdays.map((matchday) => matchday.phaseName?.endsWith("Vuelta")
        ? {
          ...matchday,
          fixtures: [{ id: "semi-return", homeTeamId: "team-1", awayTeamId: "team-2" }],
        }
        : matchday),
    };
    expect(validateTournamentIntegrity(sameHomeTwice).join(" "))
      .toContain("no respeta la ida y vuelta configurada");
  });

  it("accepts the expected double round-robin schedule in continental staged groups", () => {
    const teams = Array.from({ length: 8 }, (_, groupIndex) =>
      Array.from({ length: 4 }, (_, teamIndex) => ({
        id: `team-${groupIndex}-${teamIndex}`,
        name: `Club ${groupIndex}-${teamIndex}`,
        groupName: `Grupo ${groupIndex}`,
      })),
    ).flat();
    const rounds = [
      [[0, 1], [2, 3]],
      [[0, 2], [1, 3]],
      [[0, 3], [1, 2]],
    ] as const;
    // Build each matchday with two matches per group, reversing the hosts in leg two.
    const scheduledMatchdays = Array.from({ length: 6 }, (_, index) => ({
      number: (index % 3) + 1,
      leg: index < 3 ? 1 : 2,
      phaseName: "Copa Libertadores · Fase de grupos",
      fixtures: teams.filter((_, teamIndex) => teamIndex % 4 === 0).flatMap((firstTeam, groupIndex) => {
        const group = teams.slice(groupIndex * 4, groupIndex * 4 + 4);
        return rounds[index % 3].map(([homeIndex, awayIndex], pairIndex) => {
          const reverse = index >= 3;
          const home = group[reverse ? awayIndex : homeIndex];
          const away = group[reverse ? homeIndex : awayIndex];
          return {
            id: `${firstTeam.id}-${index}-${pairIndex}`,
            homeTeamId: home.id,
            awayTeamId: away.id,
          };
        });
      }),
    }));
    const tournament: Tournament = {
      ...createTournament(2),
      id: "conmebol-libertadores-2026",
      name: "Copa Libertadores 2026",
      teams,
      legs: 2,
      format: "staged",
      matchdays: scheduledMatchdays,
    };

    expect(validateTournamentIntegrity(tournament)).toEqual([]);
  });

  it("detects repeated and missing continental group pairings in staged calendars", () => {
    const teams = Array.from({ length: 8 }, (_, groupIndex) =>
      Array.from({ length: 4 }, (_, teamIndex) => ({
        id: `team-${groupIndex}-${teamIndex}`,
        name: `Club ${groupIndex}-${teamIndex}`,
        groupName: `Grupo ${groupIndex}`,
      })),
    ).flat();
    const rounds = [
      [[0, 1], [2, 3]],
      [[0, 2], [1, 3]],
      [[0, 3], [1, 2]],
    ] as const;
    const validMatchdays = Array.from({ length: 6 }, (_, index) => ({
      number: (index % 3) + 1,
      leg: index < 3 ? 1 : 2,
      phaseName: "Copa Libertadores · Fase de grupos",
      fixtures: teams.filter((_, teamIndex) => teamIndex % 4 === 0).flatMap((_, groupIndex) => {
        const group = teams.slice(groupIndex * 4, groupIndex * 4 + 4);
        return rounds[index % 3].map(([homeIndex, awayIndex], pairIndex) => {
          const reverse = index >= 3;
          const home = group[reverse ? awayIndex : homeIndex];
          const away = group[reverse ? homeIndex : awayIndex];
          return { id: `${groupIndex}-${index}-${pairIndex}`, homeTeamId: home.id, awayTeamId: away.id };
        });
      }),
    }));
    const corrupted = validMatchdays.map((matchday, index) =>
      ({ ...matchday, fixtures: matchday.fixtures.map((fixture) => {
        const groupIndex = Number(fixture.homeTeamId.split("-")[1]);
        if (groupIndex !== 0) return fixture;
        const pairings = [
          [[0, 1], [2, 3]],
          [[0, 1], [2, 3]],
          [[0, 1], [2, 3]],
          [[0, 2], [1, 3]],
          [[0, 3], [1, 2]],
          [[0, 3], [1, 2]],
        ] as const;
        const slot = matchday.fixtures.indexOf(fixture);
        const [homeIndex, awayIndex] = pairings[index][slot % 2];
        const group = teams.slice(0, 4);
        return { ...fixture, homeTeamId: group[homeIndex].id, awayTeamId: group[awayIndex].id };
      }) }));
    const tournament: Tournament = {
      ...createTournament(2),
      id: "conmebol-libertadores-2026",
      name: "Copa Libertadores 2026",
      teams,
      legs: 2,
      format: "staged",
      matchdays: corrupted,
    };

    const issues = validateTournamentIntegrity(tournament).join(" ");
    expect(issues).toContain("aparece 3 veces");
    expect(issues).toContain("grupo Grupo 0");
  });

  it("detects duplicate teams and fixture identifiers", () => {
    const tournament = createTournament(4);
    const [firstMatchday, secondMatchday] = tournament.matchdays;
    const duplicateFixture = {
      ...secondMatchday.fixtures[0],
      id: firstMatchday.fixtures[0].id,
      homeTeamId: "missing-team",
    };
    const invalid: Tournament = {
      ...tournament,
      teams: [...tournament.teams, { ...tournament.teams[0] }],
      matchdays: [
        firstMatchday,
        { ...secondMatchday, fixtures: [duplicateFixture, ...secondMatchday.fixtures.slice(1)] },
      ],
    };

    const issues = validateTournamentIntegrity(invalid).join(" ");
    expect(issues).toContain('identificador: "team-1" está duplicado');
    expect(issues).toContain(`identificador: "${firstMatchday.fixtures[0].id}" está duplicado`);
    expect(issues).toContain('el equipo "missing-team" no existe');
  });

  it("rejects invalid dates, scores, repeated pairings and teams scheduled simultaneously", () => {
    const tournament = createTournament(4);
    const firstMatchday = tournament.matchdays[0];
    const firstFixture = firstMatchday.fixtures[0];
    const invalid: Tournament = {
      ...tournament,
      matchdays: [{
        ...firstMatchday,
        number: 0,
        fixtures: [
          { ...firstFixture, result: { homeGoals: 100, awayGoals: -1 } },
          {
            id: "duplicate-pair",
            homeTeamId: firstFixture.awayTeamId,
            awayTeamId: firstFixture.homeTeamId,
          },
          {
            id: "simultaneous-team",
            homeTeamId: firstFixture.homeTeamId,
            awayTeamId: "team-4",
          },
        ],
      }],
    };

    const issues = validateTournamentIntegrity(invalid).join(" ");
    expect(issues).toContain("número: debe ser un entero positivo");
    expect(issues).toContain("marcador: cada valor debe ser un entero entre 0 y 99");
    expect(issues).toContain("el mismo cruce está duplicado en la fecha");
    expect(issues).toContain("un equipo aparece en más de un partido de la misma fecha");
  });

  it("rejects malformed scheduling and operational metadata", () => {
    const tournament = createTournament(4);
    const matchday = tournament.matchdays[0];
    const fixture = matchday.fixtures[0];
    const invalid: Tournament = {
      ...tournament,
      matchdays: [{
        ...matchday,
        fixtures: [{
          ...fixture,
          schedule: { date: "2026-02-30" },
          operationalState: { status: "scheduled", updatedAt: "not-a-date" },
        }],
      }],
    };

    const issues = validateTournamentIntegrity(invalid).join(" ");
    expect(issues).toContain("programación: La fecha debe existir");
    expect(issues).toContain("estado operativo: los datos no son válidos");
  });

  it("rejects knockout participants who did not advance from the completed previous stage", () => {
    const tournament = createTournament(4);
    const invalid: Tournament = {
      ...tournament,
      format: "staged",
      competitionType: "cup",
      knockoutStages: [
        { name: "Quarterfinals", legs: 1 },
        { name: "Semifinals", legs: 1 },
        { name: "Final", legs: 1 },
      ],
      matchdays: [
        {
          number: 1,
          leg: 1,
          phaseName: "Quarterfinals",
          fixtures: [
            { id: "qf-1", homeTeamId: "team-1", awayTeamId: "team-2", result: { homeGoals: 2, awayGoals: 0 } },
            { id: "qf-2", homeTeamId: "team-3", awayTeamId: "team-4", result: { homeGoals: 1, awayGoals: 0 } },
          ],
        },
        {
          number: 1,
          leg: 2,
          phaseName: "Semifinals",
          fixtures: [{ id: "sf-1", homeTeamId: "team-1", awayTeamId: "team-2" }],
        },
      ],
    };

    expect(validateTournamentIntegrity(invalid).join(" "))
      .toContain('los participantes no clasificaron desde "Quarterfinals"');
  });
});
