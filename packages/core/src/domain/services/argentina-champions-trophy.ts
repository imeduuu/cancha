import type { Tournament } from "../entities/tournament";
import { getArgentinaHalfChampions } from "./argentina-half-champions";

const trophyId = "afa-trofeo-de-campeones-2026";

/** Builds the LPF 2026 single-match Champions Trophy once the Clausura final is resolved. */
export function createArgentinaChampionsTrophy(source: Tournament, createdAt = source.createdAt): Tournament | undefined {
  if (source.id !== "arg-liga-profesional-2026") return undefined;
  const champions = getArgentinaHalfChampions(source);
  if (!champions.Apertura || !champions.Clausura) return undefined;

  let homeTeamId = champions.Apertura;
  let awayTeamId = champions.Clausura;
  let rulesNote = "Campeones del Apertura y del Clausura (arts. 20–23, Reglamento LPF 2026).";
  if (homeTeamId === awayTeamId) {
    const runnerUp = (half: "Apertura" | "Clausura") => {
      const final = source.matchdays.find(day => day.phaseName === `Torneo ${half} · Final`);
      const fixture = final?.fixtures.length === 1 ? final.fixtures[0] : undefined;
      if (!fixture || ![fixture.homeTeamId, fixture.awayTeamId].includes(homeTeamId)) return undefined;
      return fixture.homeTeamId === homeTeamId ? fixture.awayTeamId : fixture.homeTeamId;
    };
    const aperturaRunnerUp = runnerUp("Apertura");
    const clausuraRunnerUp = runnerUp("Clausura");
    if (!aperturaRunnerUp || !clausuraRunnerUp) return undefined;
    homeTeamId = aperturaRunnerUp;
    awayTeamId = clausuraRunnerUp;
    if (homeTeamId === awayTeamId) return undefined;
    rulesNote = "Desempate entre subcampeones del Apertura y del Clausura porque un club ganó ambos torneos (arts. 20–23, Reglamento LPF 2026).";
  }
  const teams = [homeTeamId, awayTeamId].map(id => source.teams.find(team => team.id === id)).filter((team): team is NonNullable<typeof team> => !!team);
  if (teams.length !== 2) return undefined;
  return {
    id: trophyId,
    competitionId: "afa-trofeo-de-campeones",
    name: "Trofeo de Campeones de la LPF",
    season: 2026,
    teams,
    legs: 1,
    tieBreakers: [],
    matchdays: [{ number: 1, leg: 1, phaseName: "Final", fixtures: [{
      id: `${trophyId}-final`, homeTeamId, awayTeamId,
      knockoutResolution: "extra-time-then-penalties",
    }] }],
    createdAt,
    format: "staged",
    competitionType: "cup",
    knockoutStages: [{ name: "Final", legs: 1 }],
    rulesNote,
    competitionRules: { season: 2026, verification: { standings: "verified", placements: "verified" }, standingsNote: rulesNote, placementsNote: rulesNote },
    seasonPreparation: { schemaVersion: 1, sourceTournamentIds: [source.id], plannedParticipants: [homeTeamId, awayTeamId], calendarReviews: [] },
  };
}

export const argentinaChampionsTrophyId = trophyId;
