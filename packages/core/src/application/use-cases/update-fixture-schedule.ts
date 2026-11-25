import { DomainError } from "../../domain/domain-error.js";
import type { MatchSchedule, Tournament } from "../../domain/entities/tournament";
import { validateMatchSchedule } from "../../domain/services/match-scheduling";
import type { TournamentRepository } from "../ports/tournament-repository";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";

export function updateFixtureSchedule(
  tournament: Tournament,
  fixtureId: string,
  schedule: MatchSchedule | null,
  repository: TournamentRepository,
): Tournament {
  const target = tournament.matchdays.flatMap(({ fixtures }) => fixtures)
    .find(({ id }) => id === fixtureId);
  if (!target) throw new DomainError("No se encontró el partido que quieres programar.");
  if (JSON.stringify(target.schedule ?? null) === JSON.stringify(schedule)) return tournament;
  if (schedule !== null) {
    schedule = { ...schedule, provenance: "manual" };
    const issue = validateMatchSchedule(schedule);
    if (issue) throw new DomainError(issue);
  }

  const matchdays = tournament.matchdays.map((matchday) => ({
    ...matchday,
    fixtures: matchday.fixtures.map((fixture) => {
      if (fixture.id !== fixtureId) return fixture;
      const { schedule: _previousSchedule, ...withoutSchedule } = fixture;
      return schedule ? { ...withoutSchedule, schedule } : withoutSchedule;
    }),
  }));
  const updatedTournament = { ...tournament, matchdays };
  saveWithActivity(repository, updatedTournament, createActivityEvent(tournament, {
    action: "match-schedule-updated",
    entityId: fixtureId,
    entityType: "match",
    summary: `Se actualizó la programación del partido ${fixtureId}.`,
    before: target.schedule ?? null,
    after: schedule,
  }));
  return updatedTournament;
}
