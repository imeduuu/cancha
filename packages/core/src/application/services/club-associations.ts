import type {Tournament} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import {isAssociationRecord,isClubAffiliationRecord,type AssociationRecord,type ClubAffiliationRecord} from "../../domain/entities/club-affiliation";
import {buildClubProfiles,clubOccurrenceKey} from "./club-history";
import {canonical} from "../../domain/services/continental-plan";
import {isValidPlayedFixture} from "../../domain/services/tournament-statistics";

function currentRevision<T extends {revision:number}>(records:T[]){
  const revision=Math.max(0,...records.map(r=>r.revision));
  const current=[...new Map(records.filter(r=>r.revision===revision).map(r=>[canonical(r),r])).values()];
  return {revision,current:current[0],ambiguous:current.length>1,conflicts:current};
}
export function associationCatalog(activity:readonly ActivityEvent[],universeId:string|null){
  const records=activity.filter(e=>e.action==="association-recorded" && isAssociationRecord(e.after) && e.after.universeId===universeId).map(e=>e.after as AssociationRecord);
  return [...new Set(records.map(r=>r.association.id))].map(id=>{const history=records.filter(r=>r.association.id===id);return {id,history,...currentRevision(history)};});
}
export function affiliationHistory(tournamentId:string,teamId:string,activity:readonly ActivityEvent[],universeId:string|null){
  return activity.filter(e=>e.action==="club-affiliation-recorded" && isClubAffiliationRecord(e.after)
    && e.after.universeId===universeId && e.after.tournamentId===tournamentId && e.after.teamId===teamId).map(e=>e.after as ClubAffiliationRecord);
}
export function associationAtRevision(history:readonly AssociationRecord[],revision:number|undefined){
  const versions=[...new Map(history.filter(r=>r.revision===revision).map(r=>[canonical(r),r.association])).values()];
  return versions.length===1?versions[0]:undefined;
}
export type AffiliationState="Desconocida"|"Ambigua"|"Fuente pendiente"|"Declaración local"|"Verificada por el usuario"|"Desactualizada";
export function projectTournamentAffiliations(t:Tournament,all:readonly Tournament[],activity:readonly ActivityEvent[],universeId:string|null){
  const catalog=associationCatalog(activity,universeId),profiles=buildClubProfiles(all);
  const warnings=new Set(profiles.filter(p=>p.warning).flatMap(p=>p.occurrences.map(o=>o.key)));
  const rows=t.teams.map(team=>{
    const history=affiliationHistory(t.id,team.id,activity,universeId),latest=currentRevision(history),record=latest.current;
    const entry=catalog.find(a=>a.id===record?.associationId);
    const historical=entry?.history.filter(a=>a.revision===record?.associationRevision);
    const historicalAmbiguous=new Set(historical?.map(r=>canonical(r))).size>1;
    const association=associationAtRevision(entry?.history ?? [],record?.associationRevision);
    let state:AffiliationState="Desconocida",reason="No hay una afiliación acreditada para esta aparición y temporada.";
    if(latest.ambiguous || historicalAmbiguous || warnings.has(clubOccurrenceKey(t.id,team.id)) || record?.status==="ambiguous" || entry?.ambiguous){state="Ambigua";reason="La identidad o afiliación presenta registros ambiguos; no se combinan automáticamente.";}
    else if(record && (record.season!==t.season || record.competitionId!==t.competitionId || record.identityToken!==(team.averageIdentity?.trim() || undefined))){state="Desactualizada";reason="Cambió la temporada, competición o evidencia de identidad de la aparición.";}
    else if(record?.status==="known"){
      if(!entry || !association || entry.revision!==record.associationRevision){state="Desactualizada";reason="La asociación no existe o tiene una revisión posterior; revisa expresamente la afiliación.";}
      else if(record.mode==="local" || association.mode==="local"){state="Declaración local";reason="La declaración local se conserva para consulta; no acredita la modalidad documental por asociación.";}
      else if(record.verification!=="verified" || association.verification!=="verified"){state="Fuente pendiente";reason="La fuente de la afiliación o asociación está pendiente de contraste documental.";}
      else {state="Verificada por el usuario";reason="Afiliación documental de esta aparición, contrastada por el usuario; no certificada independientemente.";}
    }
    const scheduled=t.matchdays.some(d=>d.fixtures.some(f=>f.homeTeamId===team.id || f.awayTeamId===team.id));
    const played=t.matchdays.some(d=>d.fixtures.some(f=>(f.homeTeamId===team.id || f.awayTeamId===team.id) && isValidPlayedFixture(t,d,f)));
    return {team,record,history,association,currentAssociation:entry?.current?.association,state,reason,ready:state==="Verificada por el usuario",scheduled,played,
      territory:association?.territory?.verification==="verified"?association.territory.name:undefined};
  });
  const fingerprint=canonical({universeId,tournamentId:t.id,competitionId:t.competitionId,season:t.season,
    participants:rows.map(row=>({teamId:row.team.id,identityToken:row.team.averageIdentity?.trim(),state:row.state,
      affiliations:currentRevision(row.history).conflicts,
      association:catalog.find(a=>a.id===row.record?.associationId)?.conflicts ?? []})).sort((a,b)=>a.teamId<b.teamId?-1:a.teamId>b.teamId?1:0)});
  return {rows,catalog,fingerprint,ready:rows.every(r=>r.ready),associationIds:Object.fromEntries(rows.filter(r=>r.ready).map(r=>[r.team.id,r.record!.associationId!]))};
}
export function associationSeasonSummary(t:Tournament,all:readonly Tournament[],activity:readonly ActivityEvent[],universeId:string|null){
  const projection=projectTournamentAffiliations(t,all,activity,universeId);
  const associations=[...new Set(projection.rows.flatMap(r=>r.record?.status==="known" && r.association?[r.association.id]:[]))].map(id=>{
    const rows=projection.rows.filter(r=>r.record?.associationId===id && r.record.status==="known" && !!r.association),association=rows[0].association!;
    return {association,registered:rows.length,scheduled:rows.filter(r=>r.scheduled).length,played:rows.filter(r=>r.played).length,verified:rows.filter(r=>r.ready).length};
  });
  return {associations,unknown:projection.rows.filter(r=>!r.record || r.record.status==="unknown" || !r.association).length,pending:projection.rows.filter(r=>!r.ready).length,rows:projection.rows};
}
