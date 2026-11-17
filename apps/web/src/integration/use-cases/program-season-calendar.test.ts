import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { LocalStorageTournamentRepository } from "../../infrastructure/persistence/local-storage-tournament-repository";
import { projectSportsUniverseDashboard } from "@cancha/core/application/services/sports-universe-dashboard";
import { projectSeasonProgression } from "@cancha/core/application/services/season-progression";
import { createTournamentBackup, parseTournamentBackup } from "@cancha/core/application/services/tournament-archive";
import {
  confirmCalendarProgramming,
  getCalendarProgrammingBlockers,
  previewGeneratedCalendar,
  previewManualCalendar,
} from "@cancha/core/application/use-cases/program-season-calendar";

function prepared(): Tournament {
  return {
    id: "future-season",
    competitionId: "arg-liga-profesional",
    name: "Liga local 2027",
    season: 2027,
    format: "staged",
    teams: ["A", "B", "C", "D"].map((name) => ({ id: name.toLowerCase(), name: `Club ${name}` })),
    legs: 1,
    tieBreakers: ["goalDifference"],
    matchdays: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    competitionRules: {
      season: 2027,
      verification: { standings: "verified", placements: "verified" },
      sourceUrls: ["https://www.afa.com.ar/reglamento-2027"],
      standingsNote: "Documento de tabla",
      placementsNote: "Documento de clasificación",
    },
    seasonPreparation: {
      schemaVersion: 1,
      sourceTournamentIds: [],
      plannedParticipants: ["Club A", "Club B", "Club C", "Club D"],
      calendarReviews: [],
    },
  };
}

function repository(initial: Tournament) {
  let saved = initial;
  const save = vi.fn((next: Tournament) => { saved = next; });
  const repo = {
    findAll: () => [saved],
    save,
    saveWithActivity: vi.fn((next: Tournament) => save(next)),
  };
  return repo;
}

afterEach(() => vi.unstubAllGlobals());

describe("season calendar programming", () => {
  it("previews a valid local round-robin schedule without writing", () => {
    const tournament = prepared();
    const repo = repository(tournament);
    const proposal = previewGeneratedCalendar(tournament, "universe-a", 2);

    expect(repo.save).not.toHaveBeenCalled();
    expect(proposal.proposed.calendarProvenance).toBe("local-generated");
    expect(proposal.proposed.format).toBe("round-robin");
    expect(proposal.proposed.matchdays).toHaveLength(6);
    expect(proposal.proposed.matchdays.flatMap(({ fixtures }) => fixtures)).toHaveLength(12);
    expect(proposal.proposed.matchdays.flatMap(({ fixtures }) => fixtures)
      .every(({ schedule }) => schedule === undefined)).toBe(true);
    expect(tournament.matchdays).toEqual([]);
  });

  it("blocks grouped automatic generation unsupported by the existing generator", () => {
    const tournament = prepared();
    const grouped = { ...tournament, teams: tournament.teams.map((team) => ({ ...team, groupName: "Grupo A" })) };
    expect(() => previewGeneratedCalendar(grouped, "universe-a", 1)).toThrow("no conserva grupos");
  });

  it("blocks a pending regulation and insufficient participants", () => {
    const tournament = prepared();
    expect(getCalendarProgrammingBlockers({
      ...tournament,
      competitionRules: { ...tournament.competitionRules!, verification: { standings: "pending", placements: "verified" } },
    })).toContain("El reglamento anual y sus fuentes todavía no están completamente verificados.");
    expect(() => previewGeneratedCalendar({
      ...tournament,
      competitionRules: { ...tournament.competitionRules!, verification: { standings: "pending", placements: "verified" } },
    }, null, 1)).toThrow("reglamento anual");
    expect(() => previewGeneratedCalendar({ ...tournament, teams: tournament.teams.slice(0, 1) }, null, 1))
      .toThrow("al menos dos");
    expect(() => previewGeneratedCalendar({
      ...tournament,
      teams: [{ id: "duplicate", name: "Club A" }, { id: "duplicate", name: "Club A" }],
    }, null, 1)).toThrow("incompletas o duplicadas");
  });

  it("rejects manual local-home conflicts before saving", () => {
    const tournament = { ...prepared(), format: "round-robin" as const };
    expect(() => previewManualCalendar(tournament, null, [{
      number: 1,
      leg: 1,
      fixtures: [
        { id: "m1", homeTeamId: "a", awayTeamId: "b" },
        { id: "m2", homeTeamId: "a", awayTeamId: "c" },
      ],
    }])).toThrow("más de un partido de la misma fecha");
  });

  it("rejects invalid participant references and repeated pairings", () => {
    const tournament = { ...prepared(), format: "round-robin" as const };
    expect(() => previewManualCalendar(tournament, null, [{
      number: 1,
      leg: 1,
      fixtures: [{ id: "unknown", homeTeamId: "missing", awayTeamId: "b" }],
    }])).toThrow("no existe");
    expect(() => previewManualCalendar(tournament, null, [
      { number: 1, leg: 1, fixtures: [{ id: "first", homeTeamId: "a", awayTeamId: "b" }] },
      { number: 2, leg: 1, fixtures: [{ id: "second", homeTeamId: "b", awayTeamId: "a" }] },
    ])).toThrow("duplicado en la rueda");
  });

  it("adds manual matches without replacing an official calendar or its results", () => {
    const tournament: Tournament = {
      ...prepared(),
      format: "round-robin",
      calendarProvenance: "official-import",
      sourceName: "Proveedor oficial",
      sourceUrl: "https://example.org/calendar",
      matchdays: [{
        number: 1,
        leg: 1,
        fixtures: [{
          id: "official-match",
          homeTeamId: "a",
          awayTeamId: "b",
          calendarProvenance: "official-import",
          result: { homeGoals: 1, awayGoals: 0 },
        }],
      }],
    };
    const repo = repository(tournament);
    const proposal = previewManualCalendar(tournament, null, [{
      number: 2,
      leg: 1,
      fixtures: [{ id: "", homeTeamId: "c", awayTeamId: "d" }],
    }]);
    const saved = confirmCalendarProgramming(proposal, tournament, repo, null);
    expect(saved.matchdays[0].fixtures[0].result).toEqual({ homeGoals: 1, awayGoals: 0 });
    expect(saved.matchdays[0].fixtures[0].calendarProvenance).toBe("official-import");
    expect(saved.matchdays[1].fixtures[0].calendarProvenance).toBe("manual");
    expect(saved.calendarProvenance).toBe("official-import");
    expect(saved.sourceUrl).toBe("https://example.org/calendar");
  });

  it("rejects confirmation after the season changes or the active universe changes", () => {
    const tournament = prepared();
    const repo = repository(tournament);
    const proposal = previewGeneratedCalendar(tournament, "universe-a", 1);
    expect(() => confirmCalendarProgramming(proposal, tournament, repo, "universe-b"))
      .toThrow("universo activo cambió");
    repo.save({ ...tournament, name: "Cambio" });
    expect(() => confirmCalendarProgramming(proposal, tournament, repo, "universe-a"))
      .toThrow("temporada o sus dependencias cambiaron");
    expect(repo.saveWithActivity).not.toHaveBeenCalled();
  });

  it("blocks replacing a calendar with results and preserves its data", () => {
    const tournament = {
      ...prepared(),
      format: "round-robin" as const,
      matchdays: [{
        number: 1,
        leg: 1,
        fixtures: [{ id: "played", homeTeamId: "a", awayTeamId: "b", result: { homeGoals: 2, awayGoals: 1 } }],
      }],
    };
    expect(() => previewGeneratedCalendar(tournament, null, 1)).toThrow("resultados o actividad deportiva");
    expect(tournament.matchdays[0].fixtures[0].result).toEqual({ homeGoals: 2, awayGoals: 1 });
  });

  it("saves only after confirmation and makes pending fixtures visible to dashboard and progression", () => {
    const tournament = prepared();
    const repo = repository(tournament);
    const proposal = previewGeneratedCalendar(tournament, null, 1);
    expect(repo.saveWithActivity).not.toHaveBeenCalled();
    const saved = confirmCalendarProgramming(proposal, tournament, repo, null);
    expect(repo.saveWithActivity).toHaveBeenCalledTimes(1);
    expect(saved.calendarProvenance).toBe("local-generated");
    expect(saved.sourceName).toContain("Calendario local");
    expect(saved.matchdays.flatMap(({ fixtures }) => fixtures)).toHaveLength(6);
    expect(saved.matchdays.flatMap(({ fixtures }) => fixtures)
      .every(({ calendarProvenance }) => calendarProvenance === "local-generated")).toBe(true);
    expect(projectSportsUniverseDashboard([saved], [], {
      version: 1, activeUniverseId: null, universes: [], assignments: {},
    }).competitions[0].statistics.pending).toBe(6);
    expect(projectSeasonProgression([saved.id], [saved], []).rows[0].stages[0]).toBe("Pendiente");
  });

  it("restores local-calendar provenance in the existing JSON v7 backup format", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    const original = prepared();
    const repo = new LocalStorageTournamentRepository(false);
    repo.save(original);
    const proposal = previewGeneratedCalendar(original, null, 1);
    const saved = confirmCalendarProgramming(proposal, original, repo, null);
    const restored = new LocalStorageTournamentRepository(false).findAll()[0];
    const backup = createTournamentBackup([restored], () => new Date("2027-01-01T00:00:00.000Z"));

    expect(backup.version).toBe(7);
    expect(parseTournamentBackup(JSON.stringify(backup))[0].calendarProvenance).toBe("local-generated");
    expect(restored.calendarProvenance).toBe(saved.calendarProvenance);
    expect(restored.matchdays.flatMap(({ fixtures }) => fixtures)[0].calendarProvenance).toBe("local-generated");
  });
});
