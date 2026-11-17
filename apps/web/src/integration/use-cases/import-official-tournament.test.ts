import { LocalStorageTournamentRepository } from "../../infrastructure/persistence/local-storage-tournament-repository";
import { describe, expect, it, vi } from "vitest";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { calculateStandings } from "@cancha/core/domain/services/standings";
import type { OfficialLeagueSource, OfficialLeagueSeason } from "@cancha/core/application/ports/official-league-source";
import type { TournamentRepository } from "@cancha/core/application/ports/tournament-repository";
import { importOfficialTournament } from "@cancha/core/application/use-cases/import-official-tournament";

const season: OfficialLeagueSeason = {
  id: "anfp-liga-primera-2026",
  name: "Liga de Primera Mercado Libre",
  season: 2026,
  sourceUrl: "https://www.campeonatochileno.cl/ligas/liga-de-primera-mercado-libre/",
  matchdays: [
    {
      number: 1,
      matches: [
        { id: "match-1-a", homeTeamName: "Colo Colo", awayTeamName: "Universidad Católica", homeGoals: 2, awayGoals: 1 },
        { id: "match-1-b", homeTeamName: "O'Higgins", awayTeamName: "Audax Italiano" },
      ],
    },
    {
      number: 2,
      matches: [
        { id: "match-2-a", homeTeamName: "Colo Colo", awayTeamName: "Audax Italiano" },
        { id: "match-2-b", homeTeamName: "Universidad Católica", awayTeamName: "O'Higgins" },
      ],
    },
    {
      number: 3,
      matches: [
        { id: "match-3-a", homeTeamName: "Colo Colo", awayTeamName: "O'Higgins" },
        { id: "match-3-b", homeTeamName: "Audax Italiano", awayTeamName: "Universidad Católica" },
      ],
    },
    {
      number: 4,
      matches: [
        { id: "match-4-a", homeTeamName: "Universidad Católica", awayTeamName: "Colo Colo" },
        { id: "match-4-b", homeTeamName: "Audax Italiano", awayTeamName: "O'Higgins" },
      ],
    },
    {
      number: 5,
      matches: [
        { id: "match-5-a", homeTeamName: "Audax Italiano", awayTeamName: "Colo Colo" },
        { id: "match-5-b", homeTeamName: "O'Higgins", awayTeamName: "Universidad Católica" },
      ],
    },
    {
      number: 6,
      matches: [
        { id: "match-6-a", homeTeamName: "O'Higgins", awayTeamName: "Colo Colo" },
        { id: "match-6-b", homeTeamName: "Universidad Católica", awayTeamName: "Audax Italiano" },
      ],
    },
  ],
};

function createSource(value: OfficialLeagueSeason = season): OfficialLeagueSource {
  return { fetchSeason: vi.fn(async () => value) };
}

function createRepository(existing: Tournament[] = []): TournamentRepository {
  let tournaments = [...existing];
  const save = vi.fn((tournament: Tournament) => {
    tournaments = [tournament, ...tournaments.filter(({ id }) => id !== tournament.id)];
  });
  return {
    save,
    saveWithActivity: vi.fn((tournament: Tournament) => save(tournament)),
    recordActivity: vi.fn(),
    findAll: vi.fn(() => [...tournaments]),
  };
}

describe("importOfficialTournament", () => {
  it("imports official teams, results, pending matches and two legs", async () => {
    const repository = createRepository();
    const tournament = await importOfficialTournament(
      createSource(),
      repository,
      () => new Date("2026-10-12T00:00:00.000Z"),
    );

    expect(tournament).toMatchObject({
      id: "anfp-liga-primera-2026",
      name: "Liga de Primera Mercado Libre 2026",
      legs: 2,
      sourceUrl: season.sourceUrl,
      createdAt: "2026-10-12T00:00:00.000Z",
    });
    expect(tournament.teams.map((team) => team.name)).toEqual([
      "Colo Colo",
      "Universidad Católica",
      "O'Higgins",
      "Audax Italiano",
    ]);
    expect(tournament.matchdays[0]).toMatchObject({ number: 1, leg: 1 });
    expect(tournament.matchdays[3]).toMatchObject({ number: 4, leg: 2 });
    expect(tournament.matchdays[0].fixtures[0]).toMatchObject({
      result: { homeGoals: 2, awayGoals: 1 },
    });
    expect(tournament.matchdays[1].fixtures[0].result).toBeUndefined();
    expect(repository.save).toHaveBeenCalledWith(tournament);
    expect(tournament.season).toBe(2026);
    expect(tournament.importCoverage).toBe("unknown");
  });

  it("maps official operational statuses to the existing fixture operational state", async () => {
    const operationalSeason: OfficialLeagueSeason = {
      ...season,
      matchdays: season.matchdays.map((matchday) => ({
        ...matchday,
        matches: matchday.matches.map((match) => ({
          ...match,
          ...(match.id === "match-1-a" ? { operationalStatus: "finished" as const } : {}),
          ...(match.id === "match-1-b" ? { operationalStatus: "suspended" as const } : {}),
          ...(match.id === "match-2-a" ? { operationalStatus: "postponed" as const } : {}),
          ...(match.id === "match-2-b" ? { operationalStatus: "cancelled" as const } : {}),
        })),
      })),
    };
    const timestamp = "2026-10-12T00:00:00.000Z";
    const tournament = await importOfficialTournament(
      createSource(operationalSeason),
      createRepository(),
      () => new Date(timestamp),
    );
    const fixtures = tournament.matchdays.flatMap(({ fixtures: round }) => round);

    expect(fixtures.find(({ id }) => id.endsWith("match-1-a"))?.operationalState)
      .toEqual({ status: "finished", updatedAt: timestamp });
    expect(fixtures.find(({ id }) => id.endsWith("match-1-b"))?.operationalState)
      .toEqual({ status: "suspended", updatedAt: timestamp });
    expect(fixtures.find(({ id }) => id.endsWith("match-2-a"))?.operationalState)
      .toEqual({ status: "postponed", updatedAt: timestamp });
    expect(fixtures.find(({ id }) => id.endsWith("match-2-b"))?.operationalState)
      .toEqual({ status: "cancelled", updatedAt: timestamp });
  });

  it("imports optional official schedules and preserves them on updates when the source omits one", async () => {
    const scheduledSeason = {
      ...season,
      matchdays: season.matchdays.map((matchday, dayIndex) => ({
        ...matchday,
        matches: matchday.matches.map((match, matchIndex) => dayIndex === 0 && matchIndex === 0
          ? { ...match, schedule: { date: "2026-04-01", time: "20:00", utcOffset: "Z" } }
          : match),
      })),
    };
    const original = await importOfficialTournament(createSource(scheduledSeason), createRepository());
    expect(original.matchdays[0].fixtures[0].schedule)
      .toEqual({ date: "2026-04-01", time: "20:00", utcOffset: "Z", provenance: "official-import" });

    const repository = createRepository([original]);
    const updated = await importOfficialTournament(
      createSource(), repository, undefined, "primera", undefined,
      { conflictResolution: "update-preserving-results" },
    );
    expect(updated.matchdays[0].fixtures[0].schedule).toEqual(original.matchdays[0].fixtures[0].schedule);
    expect(updated.matchdays[0].fixtures[1].schedule).toBeUndefined();
  });

  it("rejects a season with no schedule without saving", async () => {
    const repository = createRepository();
    await expect(importOfficialTournament(
      createSource({ ...season, matchdays: [] }),
      repository,
    )).rejects.toThrow("no contiene fechas para importar");
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("does not save if the external source is inaccessible or returns an unexpected shape", async () => {
    const repository = createRepository();
    const unavailable: OfficialLeagueSource = {
      fetchSeason: vi.fn(async () => {
        throw new Error("La fuente respondió con HTTP 503.");
      }),
    };
    await expect(importOfficialTournament(unavailable, repository))
      .rejects.toThrow("HTTP 503");
    expect(repository.save).not.toHaveBeenCalled();

    const unexpected = createSource({
      ...season,
      matchdays: [{ number: 1, matches: undefined as never }],
    });
    await expect(importOfficialTournament(unexpected, repository))
      .rejects.toThrow("formato publicado no es válido");
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects a match with only one reported official score", async () => {
    const invalidSeason: OfficialLeagueSeason = {
      ...season,
      matchdays: [{
        number: 1,
        matches: [{
          id: "incomplete-score",
          homeTeamName: "Colo Colo",
          awayTeamName: "Audax Italiano",
          homeGoals: 1,
        }],
      }],
    };
    const repository = createRepository();

    await expect(importOfficialTournament(createSource(invalidSeason), repository))
      .rejects.toThrow("El marcador oficial del partido incomplete-score está incompleto.");
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects an official match against the same team", async () => {
    const invalidSeason: OfficialLeagueSeason = {
      ...season,
      matchdays: [{
        number: 1,
        matches: [{
          id: "self-match",
          homeTeamName: "Colo Colo",
          awayTeamName: "colo   colo",
        }],
      }],
    };

    await expect(importOfficialTournament(createSource(invalidSeason), createRepository()))
      .rejects.toThrow("El partido oficial self-match enfrenta a un equipo consigo mismo.");
  });

  it("rejects duplicated official match identifiers without saving", async () => {
    const invalidSeason: OfficialLeagueSeason = {
      ...season,
      matchdays: [
        { number: 1, matches: [{ id: "duplicate", homeTeamName: "Club A", awayTeamName: "Club B" }] },
        { number: 2, matches: [{ id: "duplicate", homeTeamName: "Club A", awayTeamName: "Club B" }] },
      ],
    };
    const repository = createRepository();
    await expect(importOfficialTournament(createSource(invalidSeason), repository))
      .rejects.toThrow("la fuente oficial repitió el identificador del partido duplicate");
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects the same staged fixture repeated at another date", async () => {
    const invalidSeason: OfficialLeagueSeason = {
      ...season,
      id: "custom-staged-league-2026",
      format: "staged",
      teams: [{ name: "Club A" }, { name: "Club B" }],
      matchdays: [
        {
          number: 1,
          phaseName: "Fase regular",
          matches: [{ id: "match-first", homeTeamName: "Club A", awayTeamName: "Club B" }],
        },
        {
          number: 2,
          phaseName: "Fase regular",
          matches: [{ id: "match-duplicate", homeTeamName: "Club A", awayTeamName: "Club B" }],
        },
      ],
    };
    const repository = createRepository();

    await expect(importOfficialTournament(createSource(invalidSeason), repository))
      .rejects.toThrow(/Fase "Fase regular", fechas 1, 2.*Club A.*Club B/);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects a repeated pairing in a single-round league schedule", async () => {
    const invalidSeason: OfficialLeagueSeason = {
      ...season,
      format: "round-robin",
      teams: [{ name: "Club A" }, { name: "Club B" }, { name: "Club C" }, { name: "Club D" }],
      matchdays: [
        { number: 1, matches: [{ id: "single-a", homeTeamName: "Club A", awayTeamName: "Club B" }] },
        { number: 2, matches: [{ id: "single-b", homeTeamName: "Club A", awayTeamName: "Club B" }] },
      ],
    };
    const repository = createRepository();

    await expect(importOfficialTournament(createSource(invalidSeason), repository))
      .rejects.toThrow(/Club A.*Club B.*1 rueda\(s\)/i);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects duplicated rounds, teams, and participants absent from a published team list", async () => {
    const duplicateRound = {
      ...season,
      matchdays: [
        { number: 1, matches: [{ id: "round-a", homeTeamName: "Club A", awayTeamName: "Club B" }] },
        { number: 1, matches: [{ id: "round-b", homeTeamName: "Club C", awayTeamName: "Club D" }] },
      ],
    } satisfies OfficialLeagueSeason;
    await expect(importOfficialTournament(createSource(duplicateRound), createRepository()))
      .rejects.toThrow("jornada/ronda está duplicada");

    const duplicateTeams = {
      ...season,
      teams: [{ name: "Club A" }, { name: " club a " }],
    } satisfies OfficialLeagueSeason;
    await expect(importOfficialTournament(createSource(duplicateTeams), createRepository()))
      .rejects.toThrow('repitió el equipo " club a "');

    const unknownParticipant = {
      ...season,
      teams: [{ name: "Club A" }, { name: "Club B" }],
      matchdays: [{
        number: 1,
        matches: [{ id: "foreign", homeTeamName: "Club A", awayTeamName: "Club C" }],
      }],
    } satisfies OfficialLeagueSeason;
    await expect(importOfficialTournament(createSource(unknownParticipant), createRepository()))
      .rejects.toThrow('no pertenece a la lista de equipos');
  });

  it("rejects a season ID that conflicts with its published season number", async () => {
    await expect(importOfficialTournament(createSource({
      ...season,
      season: 2025,
    }), createRepository())).rejects.toThrow("no coincide con la temporada publicada");
  });

  it("rejects invalid official scores and round numbers without saving", async () => {
    const invalidSeason: OfficialLeagueSeason = {
      ...season,
      matchdays: [{
        number: 0,
        matches: [{ id: "invalid-date", homeTeamName: "Club A", awayTeamName: "Club B" }],
      }],
    };
    const repository = createRepository();
    await expect(importOfficialTournament(createSource(invalidSeason), repository))
      .rejects.toThrow("Fecha 1: la fuente oficial publicó un número de fecha inválido.");
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects duplicate teams in the official source roster", async () => {
    const repository = createRepository();
    await expect(importOfficialTournament(createSource({
      ...season,
      teams: [{ name: "Colo Colo" }, { name: " colo   colo " }],
    }), repository)).rejects.toThrow("repitió el equipo");
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("keeps separately published stages and repeated round numbers distinct", async () => {
    const stagedSeason: OfficialLeagueSeason = {
      ...season,
      id: "anfp-liga-segunda-ascenso-2026",
      name: "Liga de Segunda División Panini",
      format: "staged",
      zoneName: "Zona de Ascenso",
      placementRules: { championPlaces: 1 },
      matchdays: [
        {
          number: 1,
          phaseName: "Fase final Campeón",
          matches: [{ id: "champion-1", homeTeamName: "Deportes Rengo", awayTeamName: "Lota Schwager" }],
        },
        {
          number: 1,
          phaseName: "Fase final descenso",
          matches: [{ id: "relegation-1", homeTeamName: "Atlético Colina", awayTeamName: "General Velásquez" }],
        },
        {
          number: 1,
          phaseName: "Liguilla",
          matches: [{ id: "playoff-1", homeTeamName: "Lota Schwager", awayTeamName: "Atlético Colina" }],
        },
      ],
    };
    const tournament = await importOfficialTournament(createSource(stagedSeason), createRepository());

    expect(tournament).toMatchObject({
      id: "anfp-liga-segunda-ascenso-2026",
      format: "staged",
      zoneName: "Zona de Ascenso",
      placementRules: { championPlaces: 1 },
      legs: 3,
    });
    expect(tournament.matchdays.map((matchday) => [matchday.number, matchday.leg, matchday.phaseName]))
      .toEqual([
        [1, 1, "Fase final Campeón"],
        [1, 2, "Fase final descenso"],
        [1, 3, "Liguilla"],
      ]);
  });

  it("imports groups and knockout resolution scores", async () => {
    const argSeason: OfficialLeagueSeason = {
      ...season,
      id: "arg-liga-profesional-2026",
      name: "Liga Profesional Argentina",
      format: "staged",
      placementRules: {
        championPlaces: 1,
        libertadoresPlaces: { from: 2, to: 2 },
      },
      rulesNote: "Criterios oficiales",
      matchdays: [{
        number: 1,
        phaseName: "Torneo Apertura · Semifinales",
        matches: [{
          id: "final-semi",
          homeTeamName: "Boca Juniors",
          awayTeamName: "River Plate",
          homeGroupName: "Zona A",
          awayGroupName: "Zona B",
          knockoutResolution: "extra-time-then-penalties",
          homeGoals: 1,
          awayGoals: 1,
          extraTime: { homeGoals: 0, awayGoals: 0 },
          penalties: { homeGoals: 5, awayGoals: 4 },
        }],
      }],
    };

    const tournament = await importOfficialTournament(
      createSource(argSeason),
      createRepository(),
      () => new Date("2026-06-01T00:00:00.000Z"),
    );

    expect(tournament.teams.map(({ name, groupName }) => [name, groupName])).toEqual([
      ["Boca Juniors", "Zona A"],
      ["River Plate", "Zona B"],
    ]);
    expect(tournament.placementRules?.note).toBe("Criterios oficiales");
    expect(tournament.competitionRules?.verification).toEqual({
      standings: "pending",
      placements: "provisional",
    });
    expect(tournament.matchdays[0].fixtures[0]).toMatchObject({
      knockoutResolution: "extra-time-then-penalties",
      result: {
        homeGoals: 1,
        awayGoals: 1,
        extraTime: { homeGoals: 0, awayGoals: 0 },
        penalties: { homeGoals: 5, awayGoals: 4 },
      },
    });
  });

  it("adds a new season without overwriting a different saved season", async () => {
    const olderSeason = {
      ...season,
      id: "anfp-liga-primera-2025",
      season: 2025,
    };
    const repository = createRepository([{
      id: olderSeason.id,
      name: "Liga 2025",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [],
      createdAt: "2025-01-01T00:00:00.000Z",
      season: 2025,
    }]);
    const nextSeason = { ...season, id: "anfp-liga-primera-2027", season: 2027 };
    const imported = await importOfficialTournament(
      createSource(nextSeason),
      repository,
      undefined,
      "primera",
    );

    expect(imported.season).toBe(2027);
    expect(repository.findAll().map(({ id }) => id)).toContain(olderSeason.id);
    expect(repository.findAll().map(({ id }) => id)).toContain(nextSeason.id);
  });

  it("requires an explicit choice before replacing an existing season", async () => {
    const existing = await importOfficialTournament(createSource(), createRepository());
    const repository = createRepository([existing]);
    await expect(importOfficialTournament(createSource(), repository))
      .rejects.toThrow("Elige crear una copia, actualizar conservando resultados existentes o reemplazar");
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("creates an independent copy or updates the matching season while preserving prior results", async () => {
    const baseline = await importOfficialTournament(createSource(), createRepository());
    const edited: Tournament = {
      ...baseline,
      matchdays: baseline.matchdays.map((matchday, matchdayIndex) => ({
        ...matchday,
        fixtures: matchday.fixtures.map((fixture, fixtureIndex) =>
          matchdayIndex === 0 && fixtureIndex === 0
            ? {
              ...fixture,
              result: { homeGoals: 7, awayGoals: 6 },
              events: [{
                id: "reviewed-card", type: "yellow-card", teamId: fixture.homeTeamId,
                playerName: "Jugador", minute: 30,
              }],
              eventsCoverage: "complete" as const,
            }
            : fixture,
        ),
      })),
    };
    const repository = createRepository([edited]);
    const sourceChanged = {
      ...season,
      matchdays: season.matchdays.map((matchday, index) => index === 0
        ? {
          ...matchday,
          matches: matchday.matches.map((match, matchIndex) => matchIndex === 0
            ? { ...match, homeGoals: 0, awayGoals: 0 }
            : match),
        }
        : matchday),
    };

    const preserved = await importOfficialTournament(
      createSource(sourceChanged),
      repository,
      () => new Date("2026-10-13T00:00:00.000Z"),
      "primera",
      undefined,
      { conflictResolution: "update-preserving-results" },
    );
    expect(preserved.matchdays[0].fixtures[0].result).toEqual({ homeGoals: 7, awayGoals: 6 });
    expect(preserved.matchdays[0].fixtures[0].eventsCoverage).toBe("complete");
    expect(preserved.matchdays[0].fixtures[0].events).toEqual(edited.matchdays[0].fixtures[0].events);

    const copy = await importOfficialTournament(
      createSource(),
      repository,
      () => new Date("2026-10-13T00:00:00.000Z"),
      "primera",
      undefined,
      { conflictResolution: "copy" },
    );
    expect(copy.id).not.toBe(baseline.id);
    expect(repository.findAll().some(({ id }) => id === baseline.id)).toBe(true);
    expect(repository.findAll().some(({ id }) => id === copy.id)).toBe(true);
  });

  it("replaces source results explicitly and recalculates standings", async () => {
    const baseline = await importOfficialTournament(createSource(), createRepository());
    const repository = createRepository([baseline]);
    const updatedSeason = {
      ...season,
      matchdays: season.matchdays.map((matchday, index) => index === 0
        ? {
          ...matchday,
          matches: matchday.matches.map((match, matchIndex) => matchIndex === 0
            ? { ...match, homeGoals: 0, awayGoals: 4 }
            : match),
        }
        : matchday),
    };
    const replaced = await importOfficialTournament(
      createSource(updatedSeason),
      repository,
      undefined,
      "primera",
      undefined,
      { conflictResolution: "replace" },
    );
    expect(replaced.matchdays[0].fixtures[0].result).toEqual({ homeGoals: 0, awayGoals: 4 });
    const standings = calculateStandings(replaced);
    expect(standings.find(({ teamId }) => teamId === "official-universidad-catolica")?.points).toBe(3);
    expect(standings.find(({ teamId }) => teamId === "official-colo-colo")?.points).toBe(0);
    expect(repository.save).toHaveBeenCalledWith(replaced);
  });

  it("marks source-reported partial imports instead of treating them as complete", async () => {
    const partial = await importOfficialTournament(
      createSource({ ...season, coverage: "partial" }),
      createRepository(),
    );
    expect(partial.importCoverage).toBe("partial");
  });

  it("keeps official competition notes when no placement table applies", async () => {
    const cupSeason: OfficialLeagueSeason = {
      ...season,
      id: "cbf-copa-do-brasil-2026",
      name: "Copa do Brasil",
      format: "staged",
      rulesNote: "Las eliminatorias se disputan a ida y vuelta.",
      matchdays: [{
        number: 1,
        phaseName: "Copa do Brasil · 1ª Fase",
        matches: [{
          id: "cup-game",
          homeTeamName: "Club A",
          awayTeamName: "Club B",
          knockoutResolution: "penalties",
        }],
      }],
    };
    const tournament = await importOfficialTournament(
      createSource(cupSeason),
      createRepository(),
    );

    expect(tournament.rulesNote).toBe("Las eliminatorias se disputan a ida y vuelta.");
    expect(tournament.placementRules).toBeUndefined();
  });

  it("adds unlisted cup stages and normalizes two-leg rounds without changing leagues", async () => {
    const cupSeason: OfficialLeagueSeason = {
      ...season,
      id: "cbf-copa-do-brasil-2026",
      name: "Copa do Brasil",
      format: "staged",
      competitionType: "cup",
      knockoutStages: [
        { name: "Copa do Brasil · Quartas de final", legs: 2 },
        { name: "Copa do Brasil · Semifinais", legs: 2 },
        { name: "Copa do Brasil · Final", legs: 2 },
      ],
      matchdays: [
        {
          number: 1,
          phaseName: "Copa do Brasil · Quartas de final",
          matches: [{ id: "qf-ida", homeTeamName: "Club A", awayTeamName: "Club B" }],
        },
        {
          number: 2,
          phaseName: "Copa do Brasil · Quartas de final",
          matches: [{ id: "qf-vuelta", homeTeamName: "Club B", awayTeamName: "Club A" }],
        },
      ],
    };
    const tournament = await importOfficialTournament(
      createSource(cupSeason),
      createRepository(),
    );

    expect(tournament.competitionType).toBe("cup");
    expect(tournament.matchdays.map(({ phaseName, fixtures }) => [
      phaseName,
      fixtures.length,
    ])).toEqual([
      ["Copa do Brasil · Quartas de final · Ida", 1],
      ["Copa do Brasil · Quartas de final · Vuelta", 1],
      ["Copa do Brasil · Semifinais · Ida", 0],
      ["Copa do Brasil · Semifinais · Vuelta", 0],
      ["Copa do Brasil · Final · Ida", 0],
      ["Copa do Brasil · Final · Vuelta", 0],
    ]);
    expect(tournament.matchdays[0].fixtures[0].knockoutResolution).toBeUndefined();
    expect(tournament.matchdays[1].fixtures[0].knockoutResolution)
      .toBe("aggregate-then-penalties");
  });

  it.each([
    ["ausente", (teams: NonNullable<OfficialLeagueSeason["teams"]>) => teams.map(({ name }, index) => ({ name, ...(index === 0 ? {} : { competitionNumber: index + 1 }) }))],
    ["duplicada", (teams: NonNullable<OfficialLeagueSeason["teams"]>) => teams.map(({ name }, index) => ({ name, competitionNumber: index === 1 ? 1 : index + 1 }))],
    ["inválida", (teams: NonNullable<OfficialLeagueSeason["teams"]>) => teams.map(({ name }, index) => ({ name, competitionNumber: index === 0 ? 1.5 : index + 1 }))],
  ] as const)("rechaza numeración oficial %s para Copa de la Liga", async (_case, makeTeams) => {
    const teams = Array.from({ length: 16 }, (_, index) => ({
      name: `Equipo ${index + 1}`,
      competitionNumber: index + 1,
    }));
    const invalidSeason: OfficialLeagueSeason = {
      ...season,
      id: "anfp-copa-de-la-liga-2026",
      name: "Copa de la Liga",
      teams: makeTeams(teams),
    };
    await expect(importOfficialTournament(createSource(invalidSeason), createRepository()))
      .rejects.toThrow(/numeración de competición|numeración \d+|números oficiales/);
  });
});

describe("audit: preservation on reimport", () => {
  it("keeps squad data, local match details, suspended states and season provenance", async () => {
    const first = await importOfficialTournament(createSource(), createRepository());
    const fixture = first.matchdays[0].fixtures[0];
    const local: Tournament = { ...first,
      players: [{id:"p1",firstName:"Jugador",lastName:"Local"}],
      playerRegistrations: [{playerId:"p1",teamId:fixture.homeTeamId,status:"active"}],
      matchRegulations:{schemaVersion:1,season:2026,verification:"pending"},
      seasonPreparation:{schemaVersion:1,sourceTournamentIds:["previous"],plannedParticipants:first.teams.map(t=>t.name),calendarReviews:[]},
      matchdays:first.matchdays.map(day=>({...day,fixtures:day.fixtures.map(f=>f.id===fixture.id?{...f,
        lineups:{home:{starters:["p1"],substitutes:[],status:"incomplete"},away:{starters:[],substitutes:[],status:"incomplete"}},
        substitutions:[],operationalState:{status:"suspended",updatedAt:"2026-10-16T00:00:00Z"}}:f)})) };
    const repository=createRepository([local]);
    const next=await importOfficialTournament(createSource(),repository,undefined,"primera",undefined,{conflictResolution:"update-preserving-results"});
    expect(next.players).toEqual(local.players);
    expect(next.playerRegistrations).toEqual(local.playerRegistrations);
    expect(next.matchRegulations).toEqual(local.matchRegulations);
    expect(next.seasonPreparation).toEqual(local.seasonPreparation);
    expect(next.matchdays[0].fixtures[0].lineups).toEqual(local.matchdays[0].fixtures[0].lineups);
    expect(next.matchdays[0].fixtures[0].operationalState?.status).toBe("suspended");
    expect(calculateStandings(next).find(t=>t.teamId===fixture.homeTeamId)?.played).toBe(0);
  });
  it("rejects a preserving update that would silently omit a recorded result",async()=>{
    const first=await importOfficialTournament(createSource(),createRepository());const repository=createRepository([first]);
    const incomplete={...season,matchdays:season.matchdays.map((day,i)=>i===0?{...day,matches:day.matches.slice(1)}:day)};
    await expect(importOfficialTournament(createSource(incomplete),repository,undefined,"primera",undefined,{conflictResolution:"update-preserving-results"})).rejects.toThrow(/omit|conservar/i);
    expect(repository.save).not.toHaveBeenCalled();
  });
});

it("round-trips preserved local data and identifies an external provider in activity",async()=>{
 const values=new Map<string,string>();vi.stubGlobal("localStorage",{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)});
 try {
   const repository=new LocalStorageTournamentRepository(false);
   const source=createSource({...season,sourceName:"ESPN (proveedor externo)"});
   const first=await importOfficialTournament(source,repository);
   const club=first.teams[0];const local: Tournament={...first,
     teams:first.teams.map(t=>t.id===club.id?{...t,averageIdentity:"Identidad histórica local"}:t),
     players:[{id:"local-player",firstName:"Jugador",lastName:"Local"}],
     playerRegistrations:[{playerId:"local-player",teamId:club.id,status:"active"}],
     matchRegulations:{schemaVersion:1,season:2026,verification:"pending"}};
   repository.save(local);
   await importOfficialTournament(source,repository,undefined,"primera",undefined,{conflictResolution:"update-preserving-results"});
   const restored=new LocalStorageTournamentRepository(false);const loaded=restored.findAll()[0];
   expect(loaded.players).toEqual(local.players);expect(loaded.matchRegulations).toEqual(local.matchRegulations);
   expect(loaded.teams.find(t=>t.id===club.id)?.averageIdentity).toBe("Identidad histórica local");
   const imports=restored.findActivity().filter(e=>e.action==="tournament-imported");
   expect(imports).toHaveLength(2);expect(imports.every(event=>event.summary.includes("ESPN")&&!event.summary.includes("fuente oficial"))).toBe(true);
 } finally {vi.unstubAllGlobals();}
});
