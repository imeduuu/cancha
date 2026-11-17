import type { Tournament } from "../domain/entities/tournament";
import type { ActivityEvent } from "../domain/entities/activity-event";
import type { TournamentRepository } from "../application/ports/tournament-repository";
import { continentalLeague } from "./continental-qualification-fixtures";

export function closureLeague(id = "closure-league"): Tournament {
  return {...continentalLeague(id), format: "round-robin", competitionType: "league"};
}
export function closureCup(): Tournament {
  const t = closureLeague("closure-cup"), [a,b,c,d] = t.teams;
  return {...t, competitionType: "cup", format: "staged", legs: 2, tieBreakers: [],
    competitionRules: {season: t.season!, verification: {standings: "verified", placements: "verified"}},
    knockoutStages: [{name: "Semifinal", legs: 1}, {name: "Final", legs: 1}],
    matchdays: [{number: 1, leg: 1, phaseName: "Semifinal", fixtures: [
      {id: "semi-a", homeTeamId: a.id, awayTeamId: b.id, knockoutResolution: "penalties", result: {homeGoals: 2, awayGoals: 0}},
      {id: "semi-b", homeTeamId: c.id, awayTeamId: d.id, knockoutResolution: "penalties", result: {homeGoals: 2, awayGoals: 0}},
    ]}, {number: 2, leg: 2, phaseName: "Final", fixtures: [
      {id: "final", homeTeamId: a.id, awayTeamId: c.id, knockoutResolution: "penalties", result: {homeGoals: 1, awayGoals: 0}},
    ]}]};
}
export function closureMemory(tournaments: Tournament[] = [closureLeague()], activity: ActivityEvent[] = []) {
  const state = {tournaments, activity, writes: 0};
  const repository: TournamentRepository = {
    findAll: () => state.tournaments,
    findActivity: () => state.activity,
    save: t => { state.writes += 1;state.tournaments = [t, ...state.tournaments.filter(old => old.id !== t.id)]; },
    recordActivity: event => { state.writes += 1;state.activity = [...state.activity, event]; },
    saveWithActivity: (t,event) => { repository.save(t);repository.recordActivity!(event); },
  };
  return {state, repository};
}
