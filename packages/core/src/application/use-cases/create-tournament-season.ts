import {projectNationalCup,type NationalCupSelection} from "../services/national-cup-planning";
import type {NationalCupReview} from "../../domain/entities/national-cup-planning";
import type { Tournament } from "../../domain/entities/tournament";
import { validateTournamentIntegrity } from "../../domain/services/tournament-integrity";
import { canStartNewSeason } from "../../domain/services/tournament-history";
import { copyTournamentSquad } from "../../domain/services/player-roster";
import { createPendingRegulationsForSeason } from "../../domain/services/match-regulations";
import type { TournamentRepository } from "../ports/tournament-repository";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";

export function createTournamentSeason(
  source: Tournament,
  season: number,
  repository: TournamentRepository,
  createId: () => string = () => crypto.randomUUID(),
  now: () => Date = () => new Date(),
  includeSquad = false,
  planningOnly = false,
  nationalCup?: NationalCupSelection,
): Tournament {
  const cup = nationalCup ? projectNationalCup(source,season,nationalCup,repository.findAll(),repository.findActivity?.() ?? []) : undefined;
  if (cup && (!planningOnly || !cup.canPrepare || !cup.regulation)) throw new Error(cup.blockers.join(" ") || "Revisa la planificación documental de copa.");
  if (cup && JSON.stringify(repository.findAll().find(t=>t.id===source.id))!==JSON.stringify(source)) throw new Error("La copa cambió; revisa sus dependencias.");
  if (!cup && !canStartNewSeason(source)) {
    throw new Error(
      "Esta competición usa fases, grupos o un formato que requiere revisar la configuración antes de iniciar otra temporada.",
    );
  }
  if (!Number.isSafeInteger(season) || season < 1) {
    throw new Error("Ingresa un año de temporada entero y válido.");
  }
  if (!cup && season === source.season) {
    throw new Error("La nueva temporada debe ser distinta de la temporada de origen.");
  }

  const existingTournaments = repository.findAll();
  if (!cup && existingTournaments.some((tournament) =>
    tournament.competitionId === source.competitionId && tournament.season === season)) {
    throw new Error(`Ya existe una temporada ${season} guardada para esta competición.`);
  }
  const existingIds = new Set(existingTournaments.map(({ id }) => id));
  const id = createUniqueId(createId, existingIds);
  const matchdays = planningOnly ? [] : source.matchdays.map((matchday) => ({
    ...matchday,
    fixtures: matchday.fixtures.map((fixture) => ({
      id: createUniqueId(createId, existingIds),
      homeTeamId: fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
    })),
  }));
  const pointsSystem = source.pointsSystem
    ?? source.competitionRules?.points
    ?? { win: 3, draw: 1, loss: 0 };
  const competitionRules = source.competitionRules
    ? {
      season,
      points: { ...pointsSystem },
      tieBreakers: [...(source.competitionRules.tieBreakers ?? source.tieBreakers)],
      verification: { standings: "pending" as const, placements: "pending" as const },
      standingsNote: "Reglamento de esta temporada pendiente de verificar.",
      placementsNote: "Ascensos, descensos y cupos de esta temporada pendientes de verificar.",
    }
    : undefined;
  const baseNext: Tournament = {
    id,
    competitionId: source.competitionId,
    name: `${source.name.replace(/\s+\d{4}$/, "")} ${season}`,
    teams: source.teams.map((team) => ({ ...team })),
    legs: source.legs,
    tieBreakers: [...source.tieBreakers],
    pointsSystem: { ...pointsSystem },
    matchdays,
    createdAt: now().toISOString(),
    season,
    format: "round-robin",
    competitionType: source.competitionType,
    ...(competitionRules ? { competitionRules } : {}),
    ...(source.lineupRules ? { lineupRules: { ...source.lineupRules } } : {}),
    ...(source.matchRegulations
      ? { matchRegulations: createPendingRegulationsForSeason(source.matchRegulations, season) }
      : {}),
    archived: false,
  };
  // Optional roster-only mode used by the planning centre. Legacy callers retain their existing local schedule flow.
  let prepared: Tournament = planningOnly ? {...baseNext,legs:1,tieBreakers:[],pointsSystem:undefined,format:"staged",matchdays:[],
    lineupRules:undefined,matchRegulations:undefined,importCoverage:"unknown",
    seasonPreparation:{schemaVersion:1,sourceTournamentIds:[source.id],plannedParticipants:source.teams.map(team=>team.name),calendarReviews:[]},
    rulesNote:"Planificación local de nómina aportada expresamente. Calendario, formato y reglamento futuros pendientes; no acredita participantes oficiales.",
    competitionRules:{season,verification:{standings:"pending",placements:"pending"},standingsNote:"Reglamento y formato futuros pendientes.",placementsNote:"Participantes propuestos por el usuario, sin confirmar continuidad oficial."},
  } : baseNext;
  if(cup){
    const document:NationalCupReview={id:createUniqueId(createId,existingIds),at:now().toISOString(),mode:cup.target?"review":"incorporated",
      regulationTournamentId:source.id,regulation:cup.regulation!,dependencies:cup.snapshots,participants:cup.entries};
    const nationalCupPlanning={schemaVersion:1 as const,regulations:cup.target?.nationalCupPlanning?.regulations ?? [],reviews:[...(cup.target?.nationalCupPlanning?.reviews ?? []),document]};
    prepared=cup.target?{...cup.target,nationalCupPlanning}:{...prepared,competitionId:cup.regulation!.competitionId,competitionType:"cup",teams:cup.entries.map(e=>{
      const team=existingTournaments.find(t=>t.id===e.sourceTournamentId)!.teams.find(t=>t.id===e.teamId)!;
      return {id:team.id,name:team.name,...(team.averageIdentity?{averageIdentity:team.averageIdentity}:{})};
    }),nationalCupPlanning,seasonPreparation:{schemaVersion:1,sourceTournamentIds:cup.dependencies,plannedParticipants:cup.entries.map(e=>e.teamName),calendarReviews:[]},
      rulesNote:"Planificación local de copa nacional por reglamento de admisión registrado. Calendario, fases y reglamento de juego pendientes; no certifica participantes oficiales."};
  }
  const next = includeSquad && !cup ? copyTournamentSquad(source, prepared) : prepared;
  const issues = validateTournamentIntegrity(next);
  if (issues.length > 0) {
    throw new Error(`No se pudo crear la temporada ${season}: ${issues[0]}`);
  }
  saveWithActivity(repository, next, createActivityEvent(next, {
    action: cup?.target ? "regulations-updated" : "season-created",
    entityType: "season",
    summary: cup?.target ? "Se registró una revisión documental de copa nacional sin reemplazar participantes ni partidos." : `Se creó la temporada ${season} de "${next.name}".`,
    before: { sourceTournamentId: source.id, season: source.season },
    after: { tournamentId: next.id, season, ...(cup?{nationalCupReview:next.nationalCupPlanning?.reviews.at(-1)}:{}) },
  }, now));
  return next;
}

function createUniqueId(createId: () => string, usedIds: Set<string>): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = createId();
    if (id.trim() && !usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
  }
  throw new Error("No se pudo generar un identificador único para la nueva temporada.");
}
