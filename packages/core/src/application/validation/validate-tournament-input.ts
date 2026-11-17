import type { CreateTournamentInput } from "../use-cases/create-tournament";
import { cleanTeamName, normalizeTeamName } from "../../domain/services/team-name";
import { tieBreakerOptions } from "../../domain/value-objects/tie-breaker";
import {
  MAX_TEAM_NAME_LENGTH,
  MAX_TOURNAMENT_LEGS,
  MAX_TOURNAMENT_NAME_LENGTH,
} from "../../domain/value-objects/tournament-limits";

export {
  MAX_TEAM_NAME_LENGTH,
  MAX_TOURNAMENT_LEGS,
  MAX_TOURNAMENT_NAME_LENGTH,
};

export interface TournamentInputErrors {
  name?: string;
  teamNames: Array<string | undefined>;
  teamCount?: string;
  legs?: string;
  tieBreakers?: string;
  pointsSystem?: string;
}

export function validateTournamentInput(
  input: CreateTournamentInput,
): TournamentInputErrors {
  const errors: TournamentInputErrors = {
    teamNames: input.teamNames.map(() => undefined),
  };
  const name = input.name.trim();

  if (!name) {
    errors.name = "Escribe el nombre del campeonato.";
  } else if (name.length > MAX_TOURNAMENT_NAME_LENGTH) {
    errors.name = `El nombre del campeonato no puede superar los ${MAX_TOURNAMENT_NAME_LENGTH} caracteres.`;
  }

  const normalizedNames = new Map<string, number[]>();
  let validTeamCount = 0;

  input.teamNames.forEach((teamName, index) => {
    const cleanName = cleanTeamName(teamName);

    if (!cleanName) {
      errors.teamNames[index] = "Escribe el nombre de este equipo.";
      return;
    }

    validTeamCount += 1;
    if (cleanName.length > MAX_TEAM_NAME_LENGTH) {
      errors.teamNames[index] = `El nombre no puede superar los ${MAX_TEAM_NAME_LENGTH} caracteres.`;
    }

    const normalizedName = normalizeTeamName(cleanName);
    const matchingIndexes = normalizedNames.get(normalizedName) ?? [];
    matchingIndexes.push(index);
    normalizedNames.set(normalizedName, matchingIndexes);
  });

  for (const matchingIndexes of normalizedNames.values()) {
    if (matchingIndexes.length > 1) {
      for (const index of matchingIndexes) {
        errors.teamNames[index] = "Ya existe un equipo con este nombre.";
      }
    }
  }

  if (input.teamNames.length < 2 && validTeamCount === input.teamNames.length) {
    errors.teamCount = "Agrega al menos 2 equipos con nombre.";
  }

  if (!Number.isSafeInteger(input.legs) || input.legs < 1 || input.legs > MAX_TOURNAMENT_LEGS) {
    errors.legs = `Elige entre 1 y ${MAX_TOURNAMENT_LEGS} ruedas completas.`;
  }

  if (input.tieBreakers.length === 0) {
    errors.tieBreakers = "Agrega al menos un criterio de desempate.";
  } else if (input.tieBreakers.some((tieBreaker) =>
    !tieBreakerOptions.some((option) => option.value === tieBreaker),
  )) {
    errors.tieBreakers = "Hay un criterio de desempate no válido.";
  } else if (new Set(input.tieBreakers).size !== input.tieBreakers.length) {
    errors.tieBreakers = "No puedes repetir criterios de desempate.";
  }

  if (
    input.pointsSystem
    && ![input.pointsSystem.win, input.pointsSystem.draw, input.pointsSystem.loss]
      .every((points) => Number.isSafeInteger(points) && points >= 0)
  ) {
    errors.pointsSystem = "Los puntos por resultado deben ser enteros no negativos.";
  }

  return errors;
}

export function getFirstTournamentInputError(
  errors: TournamentInputErrors,
): string | undefined {
  return errors.name
    ?? errors.teamNames.find((error) => error !== undefined)
    ?? errors.teamCount
    ?? errors.legs
    ?? errors.tieBreakers
    ?? errors.pointsSystem;
}
