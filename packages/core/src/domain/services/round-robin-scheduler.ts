import type { Fixture, Matchday } from "../entities/tournament";
import type { Team } from "../entities/team";
import { MAX_TOURNAMENT_LEGS } from "../value-objects/tournament-limits";

export function generateRoundRobinSchedule(
  teams: readonly Team[],
  legs: number,
): Matchday[] {
  if (teams.length < 2) {
    throw new Error("El campeonato necesita al menos 2 equipos.");
  }

  if (!Number.isSafeInteger(legs) || legs < 1 || legs > MAX_TOURNAMENT_LEGS) {
    throw new Error(`El número de ruedas debe ser un entero entre 1 y ${MAX_TOURNAMENT_LEGS}.`);
  }

  if (teams.some((team) => !team.id.trim() || !team.name.trim())) {
    throw new Error("Cada equipo debe tener un identificador y un nombre.");
  }

  if (new Set(teams.map((team) => team.id)).size !== teams.length) {
    throw new Error("Los identificadores de los equipos deben ser únicos.");
  }

  const normalizedNames = teams.map((team) => team.name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("es"));
  if (new Set(normalizedNames).size !== teams.length) {
    throw new Error("Los nombres de los equipos deben ser únicos.");
  }

  const rotation: Array<Team | null> = [...teams];
  if (rotation.length % 2 !== 0) {
    rotation.push(null);
  }

  const roundsPerLeg = rotation.length - 1;
  const matchdays: Matchday[] = [];

  for (let leg = 1; leg <= legs; leg += 1) {
    for (let roundIndex = 0; roundIndex < roundsPerLeg; roundIndex += 1) {
      const fixtures: Fixture[] = [];

      for (let pairIndex = 0; pairIndex < rotation.length / 2; pairIndex += 1) {
        const first = rotation[pairIndex];
        const second = rotation[rotation.length - 1 - pairIndex];
        if (!first || !second) {
          continue;
        }

        const firstIsHome = (roundIndex + pairIndex + leg) % 2 === 0;
        const homeTeam = firstIsHome ? first : second;
        const awayTeam = firstIsHome ? second : first;

        fixtures.push({
          id: `${leg}-${roundIndex + 1}-${homeTeam.id}-${awayTeam.id}`,
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
        });
      }

      matchdays.push({
        number: (leg - 1) * roundsPerLeg + roundIndex + 1,
        leg,
        fixtures,
      });

      const last = rotation.pop();
      if (last === undefined) {
        throw new Error("No se pudo generar la rotación del calendario.");
      }
      rotation.splice(1, 0, last);
    }
  }

  return matchdays;
}
