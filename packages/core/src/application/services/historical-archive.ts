import { championTierLabels } from "./club-honours";
import {associationSeasonSummary} from "./club-associations";
import type { Tournament } from "../../domain/entities/tournament";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { SportsUniverseLibrary } from "../../domain/entities/sports-universe";
import { tournamentsInUniverse, activityInUniverse } from "./sports-universes";
import { competitionIdentity, groupCompetitions, seasonOrigins, recordedSeasonMovements } from "./competition-center";
import { buildClubProfiles, clubOccurrenceKey } from "./club-history";
import { evaluateSeasonClosure } from "./season-closure";
import { sourceScenario, nationalContinentalProjection } from "./continental-projection";
import { compareTournamentSeasons } from "../../domain/services/tournament-history";

export interface ArchiveFilters {
  year?: string; country?: string; confederation?: string; competition?: string; category?: string;
  club?: string; type?: string; closure?: string; provenance?: string; search?: string;
}
export interface HistoricalMovement {
  key: string; tournamentId: string; teamId: string; club: string; origin: string; destination: string;
  mechanism: string; status: string; source: string; year?: number; clubKey?: string;
}
const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
const administrative = new Set(["association-recorded","club-affiliation-recorded","tournament-created", "tournament-duplicated", "calendar-programmed", "tournament-imported", "tournament-import-rejected", "tournament-renamed", "tournament-archived", "tournament-restored", "tournament-deleted", "library-restored", "source-incident-reviewed"]);

/** Read projection only. All domain decisions remain in the existing sporting services. */
export function projectHistoricalArchive(all: readonly Tournament[], allActivity: readonly ActivityEvent[], library: SportsUniverseLibrary, filters: ArchiveFilters = {}) {
  const tournaments = tournamentsInUniverse(all, library);
  const activity = activityInUniverse(allActivity, new Set(tournaments.map(t => t.id)), library.activeUniverseId, new Set(all.map(t => t.id)));
  const groups = groupCompetitions(tournaments), profiles = buildClubProfiles(tournaments);
  const profileByOccurrence = new Map(profiles.flatMap(profile => profile.occurrences.map(o => [o.key, profile.key] as const)));
  const rows = tournaments.map(t => {
    const group = groups.find(g => g.seasons.some(s => s.id === t.id))!;
    const closure = evaluateSeasonClosure(t, tournaments, activity, library.activeUniverseId);
    const type = group.category === "Continental" || t.continentalPlans?.length ? "Continental" : t.competitionType === "cup" ? group.territory === "Sin país registrado" ? "Tipo no registrado" : "Copa nacional" : t.competitionType === "league" || t.format === "round-robin" ? "Liga" : "Tipo no registrado";
    const qualification = closure.international ?? (t.placementRules?.libertadoresQualifyingPlaces ? nationalContinentalProjection(t,tournaments,activity) : undefined);
    const confederation = ["Argentina", "Brasil", "Chile", "CONMEBOL"].includes(group.territory) ? "CONMEBOL" : "Sin confederación registrada";
    const champion = closure.honours.awards.find(a => a.label === "Campeón");
    const runner = closure.honours.awards.find(a => a.label === "Subcampeón");
    const tier = champion?.tier ?? "verified";
    const tierSuffix = tier === "verified" ? "" : ` · ${championTierLabels[tier]}`;
    const titleStatus = champion ? (closure.confirmed ? "Campeón con cierre vigente" : "Campeón deportivo calculado") + tierSuffix
      : closure.overview.played ? "Resultado provisional o ganador no determinable" : "Campeón desconocido";
    const participation = t.teams.map(team => ({team, profileKey: profileByOccurrence.get(clubOccurrenceKey(t.id, team.id))!,
      scheduled: t.matchdays.some(day => day.fixtures.some(f => f.homeTeamId === team.id || f.awayTeamId === team.id))}));
    return {tournament: t, competition: group.id, competitionName: group.name, country: group.territory, category: group.category,
      confederation, type, closure, qualification, champion, runner, titleStatus, participation, provenance: sourceScenario(t, activity),
      associations:associationSeasonSummary(t,tournaments,activity,library.activeUniverseId),
      origins: seasonOrigins(t, activity).map(id => ({id, tournament: tournaments.find(source => source.id === id)}))};
  });
  const selected = rows.filter(row => {
    const t = row.tournament;
    return (!filters.year || (t.season === undefined ? "undated" : String(t.season)) === filters.year)
      && (!filters.country || row.country === filters.country) && (!filters.confederation || row.confederation === filters.confederation)
      && (!filters.competition || row.competition === filters.competition) && (!filters.category || row.category === filters.category)
      && (!filters.type || row.type === filters.type) && (!filters.closure || row.closure.state === filters.closure)
      && (!filters.provenance || row.provenance === filters.provenance)
      && (!filters.club || row.participation.some(p => p.profileKey === filters.club))
      && (!filters.search || fold([t.name, row.competitionName, ...t.teams.map(team => team.name)].join(" ")).includes(fold(filters.search.trim())));
  });
  const movements: HistoricalMovement[] = [];
  for (const row of rows) {
    const t = row.tournament, evaluation = row.closure;
    const append = (teamId: string, mechanism: string, destination: string, status: string) => movements.push({key:JSON.stringify([t.id,teamId,mechanism]),
      tournamentId:t.id,teamId,club:t.teams.find(team=>team.id===teamId)?.name ?? `Referencia no resuelta: ${teamId}`,
      origin:`${row.country} · ${row.category} · ${t.name}`,destination,mechanism,status,source:"Proyección deportiva actual de la temporada",year:t.season});
    for (const id of evaluation.division?.promoted ?? []) append(id,"Ascenso por resolución del formato existente","Categoría superior; destino concreto no vinculado",evaluation.division?.pending.length ? "Provisional" : "Calculado por el servicio deportivo");
    for (const relegated of evaluation.relegated) append(relegated.teamId,"Descenso según reglamento registrado",relegated.destination,evaluation.blockers.length ? "Provisional; requiere revisión" : "Calculado por el servicio deportivo");
    for (const relegated of evaluation.averages?.standings.filter(r=>r.relegation) ?? []) append(relegated.teamId,"Descenso por promedio (proyección separada)","División de destino no vinculada",relegated.status);
  }
  // The transition event supplies the mechanism and explicit source IDs. Presence alone never creates a movement.
  for (const target of tournaments) {
    const record = recordedSeasonMovements(target, activity);
    if (!record) continue;
    const event = [...activity].reverse().find(e=>e.action==="season-created" && e.after && typeof e.after==="object"
      && "tournamentIds" in e.after && Array.isArray(e.after.tournamentIds) && e.after.tournamentIds.includes(target.id));
    const before = event?.before && typeof event.before === "object" ? event.before as Record<string, unknown> : {};
    for (const [ids, sourceId, destinationId, mechanism] of [
      [record.promoted,before.lowerId,before.upperId,"Ascenso registrado"],
      [record.upperRelegated,before.upperId,before.lowerId,"Descenso registrado de división superior"],
      [record.lowerRelegated,before.lowerId,undefined,"Descenso registrado de división inferior"],
    ] as const) {
      const source = tournaments.find(t=>t.id===sourceId), destination = tournaments.find(t=>t.id===destinationId);
      if (destination && competitionIdentity(target)!==competitionIdentity(destination)) continue;
      if (!destination && target.id!==(event?.after as {tournamentIds?:string[]})?.tournamentIds?.[0]) continue;
      for (const id of ids) movements.push({key:JSON.stringify([event?.id,target.id,id,mechanism]),tournamentId:target.id,teamId:id,
        club:source?.teams.find(team=>team.id===id)?.name ?? `Referencia no resuelta: ${id}`,
        origin:source?.name ?? `Origen no resuelto: ${String(sourceId ?? "sin referencia")}`,
        destination:destination ? target.name : "Destino no registrado",mechanism,status:"Registrado; consultar fundamentos de la preparación",
        source:`Actividad ${event?.id} · ${record.at}${event?.imported ? " · importada" : ""}`,year:target.season,clubKey:source ? profileByOccurrence.get(clubOccurrenceKey(source.id,id)):undefined});
    }
  }
  const selectedIds = new Set(selected.map(row=>row.tournament.id));
  const filteredMovements = movements.filter(m=>selectedIds.has(m.tournamentId) && (!filters.club || m.clubKey===filters.club));
  const events = activity.filter(event => {
    if (selectedIds.has(event.tournamentId)) return true;
    // Events without a surviving season stay visible only in the unfiltered archive; their edition is never guessed from their date.
    return !rows.some(row=>row.tournament.id===event.tournamentId) && !Object.values(filters).some(Boolean);
  }).sort((a,b)=>(Date.parse(a.occurredAt)||0)-(Date.parse(b.occurredAt)||0) || a.id.localeCompare(b.id)).map(event=>({event,kind:administrative.has(event.action)?"Administrativo":"Deportivo o preparación",origin:tournaments.find(t=>t.id===event.tournamentId),
    year:event.season ?? tournaments.find(t=>t.id===event.tournamentId)?.season}));
  const years = [...new Set(selected.map(row=>row.tournament.season))].sort((a,b)=>(b ?? -Infinity)-(a ?? -Infinity));
  const yearbooks = years.map(year=>{
    const seasons = selected.filter(row=>row.tournament.season===year), ids = new Set(seasons.map(row=>row.tournament.id));
    const yearMovements=filteredMovements.filter(m=>ids.has(m.tournamentId));
    return {year,seasons,movements:yearMovements,events:events.filter(e=>ids.has(e.event.tournamentId)),
      counts:{competitions:seasons.length,completed:seasons.filter(r=>r.closure.overview.status==="Finalizado").length,
        inProgress:seasons.filter(r=>r.closure.overview.played>0 && r.closure.overview.played<r.closure.overview.total).length,
        pending:seasons.filter(r=>r.closure.overview.status!=="Finalizado" && !(r.closure.overview.played>0 && r.closure.overview.played<r.closure.overview.total)).length,
        pendingClosure:seasons.filter(r=>r.closure.canConfirm).length,confirmed:seasons.filter(r=>r.closure.confirmed).length,
        stale:seasons.filter(r=>r.closure.state==="Cierre desactualizado").length,champions:seasons.filter(r=>r.champion).length,
        movements:yearMovements.length,qualifications:seasons.reduce((n,r)=>n+(r.qualification?.entries.filter(e=>e.status==="confirmed").length ?? 0),0),
        participants:seasons.filter(r=>r.type==="Continental").reduce((n,r)=>n+r.participation.filter(p=>p.scheduled).length,0)}};
  });
  const evolution = groups.filter(g=>selected.some(r=>r.competition===g.id)).flatMap(group=>{
    const editions=selected.filter(r=>r.competition===group.id && r.tournament.season!==undefined).sort((a,b)=>a.tournament.season!-b.tournament.season!);
    return editions.slice(1).map((current,index)=>{
      const previous=editions[index], a=previous.tournament,b=current.tournament;
      const duplicate=editions.some(r=>r!==previous && r.tournament.season===a.season || r!==current && r.tournament.season===b.season);
      const comparison=compareTournamentSeasons(b,a);
      const compatible=!duplicate && comparison.compatible && previous.provenance===current.provenance;
      const before=new Set(previous.participation.map(p=>p.profileKey)),after=new Set(current.participation.map(p=>p.profileKey));
      return {competition:group.name,previous:previous.tournament,current:current.tournament,compatible,
        reason:duplicate?"Hay varias versiones de una misma edición; no se comparan automáticamente.":!compatible?(comparison.warning ?? "Las procedencias difieren; no se agregan estadísticas deportivas."):"Estructura registrada comparable. Las presencias no acreditan ascensos ni descensos.",
        appeared:duplicate?[]:current.participation.filter(p=>!before.has(p.profileKey)).map(p=>p.team.name),
        disappeared:duplicate?[]:previous.participation.filter(p=>!after.has(p.profileKey)).map(p=>p.team.name)};
    });
  });
  return {rows,selected,profiles,activity,yearbooks,movements:filteredMovements,events,evolution,universeName:library.universes.find(u=>u.id===library.activeUniverseId)?.name ?? "Biblioteca anterior · sin asignar"};
}
