import { vi } from "vitest";
import type { Tournament } from "../domain/entities/tournament";
import type { OfficialProgramme } from "../domain/entities/official-resolution";
import { divisionFixture } from "../domain/services/second-division-test-fixtures";
import { advanceSecondDivision } from "../domain/services/second-division-progression";

export const afa = { url: "https://www.afa.com.ar/boletines", reference: "Acta AFA sintética para pruebas" };
export const cbf = { url: "https://www.cbf.com.br/", reference: "Acta CBF sintética para pruebas" };
export function memoryRepository(initial: Tournament) {
  let saved = initial;
  const save = vi.fn((next: Tournament) => { saved = next; });
  return { save, saveWithActivity: vi.fn((next: Tournament, _event: unknown) => save(next)), findAll: () => [saved] };
}
export function seedTie(): Tournament {
  const source = divisionFixture("argentina");
  return advanceSecondDivision({ ...source, matchdays: source.matchdays.map(day => day.number >= 35
    ? { ...day, fixtures: day.fixtures.map(f => ({ ...f, result: { homeGoals: 0, awayGoals: 0 } })) } : day) });
}
export function multipleTie(): Tournament {
  const source = divisionFixture("argentina");
  const ids = ["t15", "t16", "t17"];
  return advanceSecondDivision({ ...source, matchdays: source.matchdays.map(day => ({ ...day, fixtures: day.fixtures.map(f => {
    if (!ids.includes(f.homeTeamId) || !ids.includes(f.awayTeamId)) return f;
    const home = Number(f.homeTeamId.slice(1)), away = Number(f.awayTeamId.slice(1));
    const homeWins = (home === 15 && away === 16) || (home === 16 && away === 17) || (home === 17 && away === 15);
    return { ...f, result: homeWins ? { homeGoals: 1, awayGoals: 0 } : { homeGoals: 0, awayGoals: 1 } };
  }) })) });
}
export function programme(): OfficialProgramme {
  return { format: "round-robin", description: "Programa neutral publicado por AFA (datos sintéticos)", expectedMatches: 3,
    matches: [["t17", "t16"], ["t17", "t15"], ["t16", "t15"]].map(([homeTeamId, awayTeamId], index) => ({
      id: `official-${index}`, homeTeamId, awayTeamId, neutral: true, date: "2026-10-31", venue: "Estadio registrado",
      result: { homeGoals: 1, awayGoals: 0 }, resultSource: afa,
    })) };
}
