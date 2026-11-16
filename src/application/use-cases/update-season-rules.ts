import type { Tournament, PointsSystem, RulesVerificationStatus } from "../../domain/entities/tournament";
import type { TieBreaker } from "../../domain/value-objects/tie-breaker";
import { configurableTieBreakerOptions } from "../../domain/value-objects/tie-breaker";
import { seasonCompetition } from "../../domain/services/season-preparation";
import type { TournamentRepository } from "../ports/tournament-repository";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";

export interface SeasonRulesInput {
  readonly season: number;
  readonly standings: RulesVerificationStatus;
  readonly placements: RulesVerificationStatus;
  readonly points: PointsSystem;
  readonly tieBreakers: readonly TieBreaker[];
  readonly sourceUrls: readonly string[];
  readonly standingsNote: string;
  readonly placementsNote: string;
}
export function updateSeasonRules(t: Tournament, input: SeasonRulesInput, repository: TournamentRepository): Tournament {
  if (!seasonCompetition(t) || !t.season || t.season <= 2026 || input.season !== t.season)
    throw new Error("Esta edición solo admite el reglamento del año futuro seleccionado; 2026 se conserva.");
  if (JSON.stringify(repository.findAll().find(item => item.id === t.id)) !== JSON.stringify(t))
    throw new Error("La temporada cambió; revisa el reglamento nuevamente.");
  if (![input.standings, input.placements].every(s => ["pending", "provisional", "verified"].includes(s)))
    throw new Error("Estado de verificación inválido.");
  if (Object.values(input.points).length !== 3 || ![input.points.win,input.points.draw,input.points.loss].every(n => Number.isSafeInteger(n) && n >= 0))
    throw new Error("Registra puntos enteros no negativos para victoria, empate y derrota.");
  if (new Set(input.tieBreakers).size !== input.tieBreakers.length || input.tieBreakers.some(key => !configurableTieBreakerOptions.some(o => o.value === key)))
    throw new Error("Criterios de desempate inválidos.");
  const country = seasonCompetition(t)!.startsWith("arg-") ? "argentina" : "brasil";
  const validUrl = (value: string) => { try { const url = new URL(value); return url.protocol === "https:" && (country === "argentina"
    ? /(^|\.)(afa\.com\.ar|ligaprofesional\.ar)$/.test(url.hostname) : /(^|\.)cbf\.com\.br$/.test(url.hostname)); } catch { return false; } };
  if (input.sourceUrls.some(url => !validUrl(url)) || ((input.standings !== "pending" || input.placements !== "pending") && !input.sourceUrls.length))
    throw new Error("Registra referencias HTTPS del organismo AFA/LPF o CBF correspondiente.");
  if ((input.standings !== "pending" && !input.standingsNote.trim()) || (input.placements !== "pending" && !input.placementsNote.trim()))
    throw new Error("Describe las disposiciones y su referencia documental para cada apartado revisado.");
  const next: Tournament = { ...t, pointsSystem: { ...input.points }, tieBreakers: [...input.tieBreakers],
    competitionRules: { ...t.competitionRules, season: input.season, points: { ...input.points }, tieBreakers: [...input.tieBreakers],
      sourceUrls: [...input.sourceUrls], verification: { standings: input.standings, placements: input.placements },
      standingsNote: input.standingsNote.trim(), placementsNote: input.placementsNote.trim() } };
  saveWithActivity(repository, next, createActivityEvent(next, { action: "regulations-updated", entityType: "season",
    summary: `Se revisó el reglamento documentado de ${t.season}. Verificación manual del usuario.`,
    before: t.competitionRules, after: next.competitionRules }));
  return next;
}
