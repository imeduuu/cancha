import type { PointsSystem, Tournament } from "../../domain/entities/tournament";
import type { TieBreaker } from "../../domain/value-objects/tie-breaker";
import { generateRoundRobinSchedule } from "../../domain/services/round-robin-scheduler";
import { cleanTeamName } from "../../domain/services/team-name";
import type { TournamentRepository } from "../ports/tournament-repository";
import {
  getFirstTournamentInputError,
  validateTournamentInput,
} from "../validation/validate-tournament-input";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";

export interface CreateTournamentInput {
  name: string;
  teamNames: readonly string[];
  legs: number;
  tieBreakers: readonly TieBreaker[];
  pointsSystem?: PointsSystem;
}

export function createTournament(
  input: CreateTournamentInput,
  repository: TournamentRepository,
  now: () => Date = () => new Date(),
): Tournament {
  const validationError = getFirstTournamentInputError(validateTournamentInput(input));
  if (validationError) {
    throw new Error(validationError);
  }

  const name = input.name.trim();
  const teamNames = input.teamNames.map(cleanTeamName);
  const teams = teamNames.map((teamName, index) => ({
    id: `team-${index + 1}`,
    name: teamName,
  }));
  const matchdays = generateRoundRobinSchedule(teams, input.legs);
  const createdAt = now().toISOString();

  const idBase = `tournament-${Date.parse(createdAt)}`;
  const existingIds = new Set(repository.findAll().map(({ id }) => id));
  let id = idBase;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${idBase}-${suffix}`;
    suffix += 1;
  }

  const tournament: Tournament = {
    id,
    competitionId: id,
    name,
    teams,
    legs: input.legs,
    tieBreakers: [...input.tieBreakers],
    pointsSystem: input.pointsSystem ?? { win: 3, draw: 1, loss: 0 },
    matchdays,
    createdAt,
  };

  saveWithActivity(repository, tournament, createActivityEvent(tournament, {
    action: "tournament-created",
    entityType: "tournament",
    summary: `Se creó la competición "${tournament.name}".`,
    after: { season: tournament.season ?? null, teams: tournament.teams.length },
  }, now));
  return tournament;
}
