import { describe, expect, it } from "vitest";
import type { Tournament } from "../../domain/entities/tournament";
import { createArgentinaChampionsTrophy } from "../../domain/services/argentina-champions-trophy";
import { seasonHonours } from "./club-honours";
import { synchronizeArgentinaChampionsTrophy } from "./argentina-champions-trophy";

function source(aperturaWinner = "a", clausuraWinner = "c"): Tournament {
  return {
    id: "arg-liga-profesional-2026", competitionId: "arg-liga-profesional", name: "Liga Profesional", season: 2026,
    teams: ["a", "b", "c", "d"].map(id => ({ id, name: `Club ${id}` })), legs: 1, tieBreakers: [], createdAt: "2026-01-01T00:00:00.000Z",
    matchdays: ([ ["Apertura", aperturaWinner], ["Clausura", clausuraWinner] ] as const).map(([half, winner], i) => ({ number: i + 1, leg: i + 1, phaseName: `Torneo ${half} · Final`, fixtures: [{
      id: `${half}-final`, homeTeamId: winner, awayTeamId: winner === "a" ? (half === "Clausura" && aperturaWinner === clausuraWinner ? "d" : "b") : "a",
      knockoutResolution: "extra-time-then-penalties", result: { homeGoals: 0, awayGoals: 0, penalties: { homeGoals: 5, awayGoals: 4 } },
    }] })),
  };
}

describe("LPF 2026 Trofeo de Campeones", () => {
  it("pairs Apertura and Clausura champions in a playable single final and accredits its winner", () => {
    const trophy = createArgentinaChampionsTrophy(source());
    expect(trophy?.teams.map(team => team.id)).toEqual(["a", "c"]);
    expect(trophy?.matchdays[0].fixtures[0].knockoutResolution).toBe("extra-time-then-penalties");
    const finished = { ...trophy!, matchdays: [{ ...trophy!.matchdays[0], fixtures: [{ ...trophy!.matchdays[0].fixtures[0], result: { homeGoals: 1, awayGoals: 1, extraTime: { homeGoals: 0, awayGoals: 0 }, penalties: { homeGoals: 4, awayGoals: 3 } } }] }] };
    expect(seasonHonours(finished).awards).toContainEqual({ teamId: "a", label: "Campeón", tier: "verified" });
    expect(seasonHonours(finished).awards).toContainEqual({ teamId: "c", label: "Subcampeón", tier: "verified" });
  });

  it("uses the two half runners-up when one club wins both titles", () => {
    const trophy = createArgentinaChampionsTrophy(source("a", "a"));
    expect(trophy?.teams.map(team => team.id)).toEqual(["b", "d"]);
  });

  it("does not exist before both half finals are decided", () => {
    expect(createArgentinaChampionsTrophy({ ...source(), matchdays: source().matchdays.slice(0, 1) })).toBeUndefined();
  });

  it("registers the derived competition with an activity event", () => {
    const records: Tournament[] = [source()];
    const events: unknown[] = [];
    const repository = {
      findAll: () => records,
      save: (tournament: Tournament) => { const index = records.findIndex(item => item.id === tournament.id); if (index < 0) records.push(tournament); else records[index] = tournament; },
      saveWithActivity: (tournament: Tournament, event: unknown) => { repository.save(tournament); events.push(event); },
    };
    synchronizeArgentinaChampionsTrophy(records[0], repository);
    expect(records.some(tournament => tournament.id === "afa-trofeo-de-campeones-2026")).toBe(true);
    expect(events).toHaveLength(1);
  });
});
