import type { Matchday, Tournament } from "../entities/tournament";

const continentalCupNames: Readonly<Record<string, string>> = {
  libertadores: "Copa Libertadores",
  sudamericana: "Copa Sudamericana",
};

/**
 * Checks the two-leg group schedule used by the continental cups.
 * Other staged competitions may use a different group format and are ignored.
 */
export function validateContinentalGroupSchedule(
  tournament: Tournament,
  matchdays: readonly Matchday[],
): string[] {
  const cupName = Object.entries(continentalCupNames).find(([key]) =>
    new RegExp(`^conmebol-${key}-\\d{4}$`).test(tournament.id),
  )?.[1];
  if (!cupName) return [];

  const groupTeams = tournament.teams.filter((team) => team.groupName);
  const teamsByGroup = new Map<string, typeof groupTeams>();
  for (const team of groupTeams) {
    if (!team.groupName) continue;
    const group = teamsByGroup.get(team.groupName) ?? [];
    group.push(team);
    teamsByGroup.set(team.groupName, group);
  }
  if (groupTeams.length !== 32 || teamsByGroup.size !== 8
    || [...teamsByGroup.values()].some((group) => group.length !== 4)) return [];

  const groupPhaseMatchdays = matchdays.filter((matchday) =>
    matchday.phaseName?.toLocaleLowerCase("es")
      .startsWith(`${cupName} · fase de grupos`.toLocaleLowerCase("es")),
  );
  if (groupPhaseMatchdays.length === 0) return [];

  const issues: string[] = [];
  for (const [groupName, teams] of teamsByGroup) {
    for (let firstIndex = 0; firstIndex < teams.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < teams.length; secondIndex += 1) {
        const first = teams[firstIndex];
        const second = teams[secondIndex];
        const meetings = groupPhaseMatchdays.flatMap((matchday) => matchday.fixtures)
          .filter((fixture) =>
            (fixture.homeTeamId === first.id && fixture.awayTeamId === second.id)
            || (fixture.homeTeamId === second.id && fixture.awayTeamId === first.id),
          );
        if (meetings.length !== 2) {
          issues.push(
            `Fase ${cupName} · Fase de grupos, grupo ${groupName}: el cruce entre "${first.name}" y "${second.name}" aparece ${meetings.length} veces; debe aparecer 2 veces.`,
          );
        } else if (meetings[0].homeTeamId === meetings[1].homeTeamId) {
          issues.push(
            `Fase ${cupName} · Fase de grupos, grupo ${groupName}: "${first.name}" y "${second.name}" juegan ambos partidos con el mismo equipo como local.`,
          );
        }
      }
    }
  }
  return issues;
}
