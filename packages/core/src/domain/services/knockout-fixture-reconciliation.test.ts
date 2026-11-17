import { describe, expect, it } from "vitest";
import type { Fixture } from "../entities/tournament";
import { reconcileFixtureParticipants } from "./knockout-fixture-reconciliation";

describe("reconcileFixtureParticipants", () => {
  it("removes result and team-specific match data when advancing teams change", () => {
    const fixture: Fixture = {
      id: "final",
      homeTeamId: "old-home",
      awayTeamId: "old-away",
      result: { homeGoals: 2, awayGoals: 1 },
      goalScorers: [{ teamId: "old-home", playerId: "player-1", playerName: "Player 1" }],
      lineups: {
        home: { starters: ["player-1"], substitutes: [], status: "incomplete" },
        away: { starters: [], substitutes: [], status: "incomplete" },
      },
      substitutions: [{
        id: "substitution-1",
        teamId: "old-home",
        playerOutId: "player-1",
        playerInId: "player-2",
      }],
      events: [{
        id: "event-1",
        type: "goal",
        teamId: "old-home",
        playerId: "player-1",
        playerName: "Player 1",
      }],
      schedule: { date: "2026-06-01", time: "18:00" },
      operationalState: {
        status: "cancelled",
        updatedAt: "2026-05-01T00:00:00.000Z",
        note: "Previous finalist withdrawn",
      },
    };

    const reconciled = reconcileFixtureParticipants(fixture, "new-home", "new-away");

    expect(reconciled).toEqual({
      id: "final",
      homeTeamId: "new-home",
      awayTeamId: "new-away",
      schedule: { date: "2026-06-01", time: "18:00" },
    });
  });
});

it("resets verified event coverage when the participants change",()=>{
 const old: Fixture={id:"final",homeTeamId:"a",awayTeamId:"b",events:[],eventsCoverage:"complete"};
 expect(reconcileFixtureParticipants(old,"c","d")?.eventsCoverage).toBeUndefined();
});
