import type { Tournament, Matchday } from "../domain/entities/tournament";
import { generateRoundRobinSchedule } from "../domain/services/round-robin-scheduler";
import { divisionFixture } from "../domain/services/second-division-test-fixtures";

/** Synthetic clubs/results; existing 2026 stage formats, never live provider assertions. */
export function brazilUpper(): Tournament {
  const lower = divisionFixture("brasil");
  return { ...lower, id: "brasileirao-serie-a-2026", competitionId: "brasileirao-serie-a", name: "Série A de prueba", competitionRules: undefined,
    teams: lower.teams.map(t => ({ ...t, id: `u-${t.id}`, name: `Upper ${t.name}` })),
    matchdays: lower.matchdays.map(d => ({ ...d, phaseName: "Brasileirão Série A", fixtures: d.fixtures.map(f => ({ ...f,
      id: `u-${f.id}`, homeTeamId: `u-${f.homeTeamId}`, awayTeamId: `u-${f.awayTeamId}` })) })) };
}
export function nationalCup(country: "argentina" | "brasil"): Tournament {
  const title = country === "argentina" ? "Copa Argentina" : "Copa do Brasil";
  const id = country === "argentina" ? "afa-copa-argentina-2026" : "cbf-copa-do-brasil-2026";
  const teams = Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, name: `Copa Club ${i}` }));
  const twoLegs = country === "brasil";
  return { id, name: `${title} de prueba`, season: 2026, teams, format: "staged", competitionType: "cup", legs: twoLegs ? 2 : 1,
    tieBreakers: [], createdAt: "2026-01-01T00:00:00Z",
    knockoutStages: [{ name: `${title} · Semifinales`, legs: twoLegs ? 2 : 1 }, { name: `${title} · Final`, legs: 1 }],
    matchdays: [{ number: 1, leg: 1, phaseName: `${title} · Semifinales${twoLegs ? " · Ida" : ""}`,
      fixtures: [0, 2].map(i => ({ id: `semi-${i}-1`, homeTeamId: `c${i}`, awayTeamId: `c${i + 1}`,
        ...(!twoLegs ? { knockoutResolution: "penalties" as const } : {}) })) },
      ...(twoLegs ? [{ number: 1, leg: 2, phaseName: `${title} · Semifinales · Vuelta`, fixtures: [0, 2].map(i => ({
        id: `semi-${i}-2`, homeTeamId: `c${i + 1}`, awayTeamId: `c${i}`, knockoutResolution: "aggregate-then-penalties" as const })) }] : [])] };
}
export function continentalCup(kind: "libertadores" | "sudamericana"): Tournament {
  const title = kind === "libertadores" ? "Copa Libertadores" : "Copa Sudamericana";
  const teams = Array.from({ length: 32 }, (_, i) => ({ id: `${kind}-${i}`, name: `${kind} Club ${i}`, groupName: `Grupo ${Math.floor(i / 4)}` }));
  const schedules = Array.from({ length: 8 }, (_, group) => generateRoundRobinSchedule(teams.slice(group * 4, group * 4 + 4), 2));
  const groupDays: Matchday[] = schedules[0].map((day, i) => ({ ...day, leg: 1, phaseName: `${title} · Fase de grupos`,
    fixtures: schedules.flatMap(s => s[i].fixtures).map(f => ({ ...f, result: Number(f.homeTeamId.split("-").slice(-1)[0]) < Number(f.awayTeamId.split("-").slice(-1)[0])
      ? { homeGoals: 2, awayGoals: 0 } : { homeGoals: 0, awayGoals: 2 } })) }));
  const names = [...(kind === "sudamericana" ? ["Playoff de octavos"] : []), "Octavos de final", "Cuartos de final", "Semifinales", "Final"];
  const knockoutStages = names.map(name => ({ name: `${title} · ${name}`, legs: name === "Final" ? 1 as const : 2 as const,
    ...(name === "Playoff de octavos" ? { advanceWinners: false } : {}) }));
  return { id: `conmebol-${kind}-2026`, name: `${title} 2026`, season: 2026, teams, format: "staged", competitionType: "cup", legs: 2 * names.length,
    tieBreakers: ["goalDifference", "goalsFor"], createdAt: "2026-01-01T00:00:00Z", knockoutStages,
    matchdays: [...groupDays, ...knockoutStages.flatMap((stage, i) => stage.legs === 1
      ? [{ number: 1, leg: 2 + 2 * i, phaseName: stage.name, fixtures: [] }]
      : [{ number: 1, leg: 2 + 2 * i, phaseName: `${stage.name} · Ida`, fixtures: [] },
         { number: 1, leg: 3 + 2 * i, phaseName: `${stage.name} · Vuelta`, fixtures: [] }])] };
}

export function argentinaUpper(): Tournament {
  const teams = Array.from({ length: 30 }, (_, i) => ({ id: `u${i}`, name: `Upper Club ${i}` }));
  const regular = generateRoundRobinSchedule(teams, 2).slice(0, 32).map((day, i) => ({ ...day,
    phaseName: `Torneo ${i < 16 ? "Apertura" : "Clausura"} · Fase regular`,
    fixtures: day.fixtures.map(f => ({ ...f, result: Number(f.homeTeamId.slice(1)) < Number(f.awayTeamId.slice(1))
      ? { homeGoals: 2, awayGoals: 0 } : { homeGoals: 0, awayGoals: 2 } })) }));
  return { id: "arg-liga-profesional-2026", competitionId: "arg-liga-profesional", name: "LPF de prueba", season: 2026, format: "staged",
    teams, legs: 2, tieBreakers: ["goalDifference"], createdAt: "2026-01-01T00:00:00Z", matchdays: [...regular,
      ...["Apertura", "Clausura"].map((half, i) => ({ number: 33 + i, leg: 2, phaseName: `Torneo ${half} · Final`,
        fixtures: [{ id: `final-${half}`, homeTeamId: "u0", awayTeamId: "u1", result: { homeGoals: 1, awayGoals: 0 } }] }))] };
}
