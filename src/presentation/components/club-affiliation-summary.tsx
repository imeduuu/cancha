import {useContext} from "react";
import type {Tournament} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import {projectTournamentAffiliations,associationCatalog,associationAtRevision} from "../../application/services/club-associations";
import {ClubAssociationsAccess,ClubAssociationsNavigation} from "./club-associations-access";
export function ClubAffiliationSummary({tournament:t,teamId,tournaments,activity,universeId,manage=true}:{tournament:Tournament;teamId:string;tournaments:readonly Tournament[];activity:readonly ActivityEvent[];universeId?:string|null;manage?:boolean}){
  const navigation=useContext(ClubAssociationsNavigation),scope=universeId===undefined?navigation?.universeId ?? null:universeId;
  const row=projectTournamentAffiliations(t,tournaments,activity,scope).rows.find(r=>r.team.id===teamId);
  if(!row)return null;
  const catalog=associationCatalog(activity,scope);
  return <section aria-label={`Afiliación de ${row.team.name} en ${t.season ?? "temporada sin año"}`}><h5>Afiliación de esta aparición</h5>
    <p>{t.season ?? "Sin año"} · {t.name} · {row.state}. {row.reason}</p>
    <p>Asociación registrada: {row.association?.name ?? "Desconocida"}. País o territorio acreditado: {row.territory ?? "No registrado o sin verificar"}.</p>
    <p>Fuente de la afiliación: {row.record?.source?.url ?? "Sin fuente documental"} · {row.record?.source?.reference}</p>
    <p>La afiliación se limita a este participante y temporada. No se extiende a otras apariciones del perfil.</p>
    {!!row.history.length && <details><summary>Historial de afiliaciones de esta aparición ({row.history.length})</summary><ul>{row.history.map((record,i)=>{const association=associationAtRevision(catalog.find(a=>a.id===record.associationId)?.history ?? [],record.associationRevision);return <li key={`${record.revision}:${i}`}>Revisión {record.revision} · {record.season} · {association?.name ?? "Sin asociación determinada"} · {record.status==="known"?"Afiliación registrada":record.status==="ambiguous"?"Ambigua":"Desconocida"} · {record.mode==="local"?"Declaración local":record.verification==="verified"?"Verificada por el usuario":"Fuente pendiente"} · {record.source?.url} {record.source?.reference}</li>;})}</ul></details>}
    {manage && <ClubAssociationsAccess tournament={t} teamId={teamId}/>}
  </section>;
}
