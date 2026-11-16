import {isSupportedAssociationRestriction} from "../../domain/entities/draw-configuration";
import {projectTournamentAffiliations} from "../../application/services/club-associations";
import {useRef,useState} from "react";
import type {Tournament} from "../../domain/entities/tournament";
import type {TournamentRepository} from "../../application/ports/tournament-repository";
import type {DrawConfiguration,DrawRestriction} from "../../domain/entities/draw-configuration";
import {isStageDrawRecord} from "../../domain/entities/stage-draw";
import {emptyDrawConfiguration,latestDrawConfiguration,validateDrawConfiguration} from "../../application/services/draw-configuration";
import {groupStageKey,inspectDrawPreparation} from "../../application/services/draw-and-bracket";
import {reviewDrawConfiguration,confirmDrawConfiguration,type DrawConfigurationReview} from "../../application/use-cases/configure-stage-draw";
import {useLibraryWrite} from "../library-write-context";

interface Props {tournament:Tournament;repository:TournamentRepository;universeId:string|null;getUniverseId:()=>string|null;onChanged:(t:Tournament)=>void}
export function DrawConfigurationEditor({tournament:t,repository,universeId,getUniverseId,onChanged}:Props){
  const runWrite=useLibraryWrite(),all=repository.findAll(),activity=repository.findActivity?.() ?? [];
  const saved=latestDrawConfiguration(t.id,groupStageKey,universeId,activity),view=inspectDrawPreparation(t,all,activity,universeId);
  const [draft,setDraft]=useState<DrawConfiguration|null>(null),[review,setReview]=useState<DrawConfigurationReview|null>(null),[checked,setChecked]=useState(false),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const pending=useRef(false),preview=useRef<HTMLHeadingElement>(null);
  const c=draft ?? (saved?.deleted?undefined:saved),groupStage=view.stages.find(s=>s.key===groupStageKey);
  const usedConfiguration=!draft && groupStage?.current && isStageDrawRecord(groupStage.latest?.after)
    && groupStage.latest.after.configurationRevision===c?.revision;
  const validation=c?validateDrawConfiguration(usedConfiguration?{...c,foundation:view.foundation}:c,t,all,activity,universeId):undefined;
  const protectedStage=!!view.stages.find(s=>s.key===groupStageKey)?.latest || t.matchdays.some(d=>d.fixtures.length) || !!t.archived;
  const name=(id:string)=>t.teams.find(team=>team.id===id)?.name ?? `Identidad inexistente: ${id}`;
  const describe=(r:DrawRestriction)=>{
    switch(r.type){
      case "group-size":return `Grupo ${r.group}: mínimo ${r.min}, máximo ${r.max}.`;
      case "pot-distribution":return `${c?.pots.find(p=>p.id===r.potId)?.name ?? "Bombo inexistente"}: ${r.perGroup} participante(s) por grupo.`;
      case "incompatible":return `Separar en grupos distintos: ${r.teamIds.map(name).join(", ")}.`;
      case "fixed-position":return `${name(r.teamId)}: grupo ${r.group}, posición explícita ${r.position}.`;
      case "association":return isSupportedAssociationRestriction(r)?`Máximo ${r.maxPerGroup} participante(s) de la misma asociación por grupo.`:`Condición antigua no ejecutable: ${r.description}.`;
      case "unsupported":return `No soportada: ${r.description}.`;
    }
  };
  const update=(patch:Partial<DrawConfiguration>)=>{if(draft){setDraft({...draft,...patch});setReview(null);setMessage("");}};
  const addRule=(type:DrawRestriction["type"])=>{
    if(!draft)return;const id=crypto.randomUUID(),group=view.groups[0]?.name ?? "",teamId=t.teams[0]?.id ?? "";
    const rule:DrawRestriction=type==="group-size"?{id,type,group,min:0,max:view.groups[0]?.teamIds.length ?? 0}:type==="pot-distribution"?{id,type,potId:draft.pots[0]?.id ?? "",perGroup:1}:type==="incompatible"?{id,type,teamIds:[]}:type==="fixed-position"?{id,type,group,teamId,position:1}:type==="association"?{id,type,schemaVersion:1,maxPerGroup:1,description:"Máximo explícito de participantes de una misma asociación por grupo"}:{id,type:"unsupported",description:"Condición pendiente de representar"};
    update({restrictions:[...draft.restrictions,rule]});
  };
  async function confirm(){if(!review || pending.current)return;pending.current=true;setBusy(true);try{const next=await runWrite(()=>confirmDrawConfiguration(review,repository,getUniverseId(),true));setReview(null);setDraft(null);onChanged(next);setMessage("Configuración registrada. Se conservaron grupos, encuentros, resultados e historial anterior.");}catch(e){setReview(null);setMessage(e instanceof Error?e.message:"No se pudo guardar.");}finally{pending.current=false;setBusy(false);}}
  function inspect(deleted=false){if(!draft)return;try{setReview(reviewDrawConfiguration({...draft,...(deleted?{deleted:true}:{})},repository,checked));setMessage("");setTimeout(()=>preview.current?.focus(),0);}catch(e){setMessage(e instanceof Error?e.message:"No se pudo revisar.");}}
  return <section aria-label="Bombos y restricciones"><h3>Bombos y restricciones</h3>
    <p>{saved && !saved.deleted?`Configuración registrada · revisión ${saved.revision}`:"Sin configuración registrada"}. {t.name} · {t.season} · Grupos registrados.</p>
    {usedConfiguration && <p>Configuración utilizada por la distribución confirmada vigente.</p>}
    <p>Grupos existentes: {view.groups.map(g=>`${g.name}: ${g.teamIds.length} plazas`).join("; ") || "No registrados"}.</p>
    <p>Las fuentes y cabezas de serie son declaraciones explícitas del usuario. No certifican reglas oficiales ni habilitan el sorteo aleatorio.</p>
    {validation && <div role="status"><p>Estado: {validation.state} · {c?.mode==="documented"?({pending:"Pendiente",provisional:"Provisional",verified:"Verificada por el usuario"})[c.verification]:"Escenario local"}.</p><p>Bombos completos: {c?.pots.filter(p=>p.teamIds.length===p.capacity).length} · incompletos: {c?.pots.filter(p=>p.teamIds.length!==p.capacity).length}.</p><ul>{[...validation.errors,...validation.incomplete,...validation.pending,...validation.unsupported].map((issue,i)=><li key={i}>{issue}</li>)}</ul>{validation.state==="Válida" && <p>{validation.warning}</p>}</div>}
    {c && <p>Restricciones estructuralmente válidas: {validation?.state==="Válida"?c.restrictions.length:0} · pendientes de completar o verificar: {validation?.state!=="Válida"?c.restrictions.length:0}.</p>}
    {c && !draft && <><ul>{c.pots.map(p=><li key={p.id}>{p.name}: {p.teamIds.map(name).join(", ")} ({p.teamIds.length}/{p.capacity})</li>)}</ul><p>Cabezas de serie: {c.seeding?.teamIds.map(name).join(", ") || "No registradas"}. {c.seeding?.basis}</p><p>Restricciones registradas: {c.restrictions.length}. Fuente: {c.source?.url} {c.source?.reference}</p><ul>{c.restrictions.map(r=><li key={r.id}>{describe(r)}</li>)}</ul></>}
    {protectedStage && <p>La etapa tiene actividad deportiva o un sorteo registrado; su configuración está protegida.</p>}
    {!draft && <button type="button" disabled={protectedStage || !view.groups.length} onClick={()=>{const base=emptyDrawConfiguration(t,universeId,all,activity);setDraft(saved && !saved.deleted?{...saved,...base,pots:saved.pots,restrictions:saved.restrictions,seeding:saved.seeding,mode:saved.mode,verification:saved.verification,source:saved.source}:base);setChecked(false);setMessage("");}}>{saved && !saved.deleted?"Revisar configuración de bombos":"Configurar bombos y restricciones"}</button>}
    {draft && <><fieldset disabled={busy || !!review || protectedStage}><legend>Editor de bombos</legend>
      <button type="button" onClick={()=>update({pots:[...draft.pots,{id:crypto.randomUUID(),name:`Bombo ${draft.pots.length+1}`,capacity:1,teamIds:[]}]})}>Crear bombo</button>
      {draft.pots.map(p=><div key={p.id}><label>Nombre del bombo<input value={p.name} onChange={e=>update({pots:draft.pots.map(old=>old.id===p.id?{...old,name:e.target.value}:old)})}/></label><label>Capacidad de {p.name}<input type="number" min={1} value={p.capacity} onChange={e=>update({pots:draft.pots.map(old=>old.id===p.id?{...old,capacity:Number(e.target.value)}:old)})}/></label><p>{p.teamIds.length}/{p.capacity} asignados</p><button type="button" onClick={()=>update({pots:draft.pots.filter(old=>old.id!==p.id)})}>Eliminar {p.name}</button></div>)}
      {t.teams.map(team=><label key={team.id}>Bombo de {team.name}<select value={draft.pots.find(p=>p.teamIds.includes(team.id))?.id ?? ""} onChange={e=>update({pots:draft.pots.map(p=>({...p,teamIds:[...p.teamIds.filter(id=>id!==team.id),...(p.id===e.target.value?[team.id]:[])]}))})}><option value="">Sin asignar</option>{draft.pots.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>)}
      <p>Sin asignación: {t.teams.filter(team=>!draft.pots.some(p=>p.teamIds.includes(team.id))).map(team=>team.name).join(", ") || "Ninguno"}.</p>
      <label><input type="checkbox" checked={!!draft.seeding} onChange={e=>update({seeding:e.target.checked?{basis:"",teamIds:[]}:undefined})}/>El formato registrado contempla cabezas de serie</label>
      {draft.seeding && <><label>Condición explícita de siembra y referencia<input value={draft.seeding.basis} onChange={e=>update({seeding:{...draft.seeding!,basis:e.target.value}})}/></label>{t.teams.map(team=><label key={team.id}><input type="checkbox" checked={draft.seeding!.teamIds.includes(team.id)} onChange={e=>update({seeding:{...draft.seeding!,teamIds:e.target.checked?[...draft.seeding!.teamIds,team.id]:draft.seeding!.teamIds.filter(id=>id!==team.id)}})}/>Cabeza de serie: {team.name}</label>)}</>}
      <label>Procedencia<select value={draft.mode} onChange={e=>{const mode=e.target.value as DrawConfiguration["mode"];update({mode,...(mode==="local"?{source:undefined,verification:"pending" as const}:{})});}}><option value="local">Escenario local</option><option value="documented">Configuración documental</option></select></label>
      {draft.mode==="documented" && <><label>URL HTTPS de las restricciones<input type="url" value={draft.source?.url ?? ""} onChange={e=>update({source:{reference:draft.source?.reference ?? "",url:e.target.value}})}/></label><label>Referencia de las restricciones<input value={draft.source?.reference ?? ""} onChange={e=>update({source:{url:draft.source?.url ?? "",reference:e.target.value}})}/></label><label>Estado documental de los bombos<select value={draft.verification} onChange={e=>update({verification:e.target.value as DrawConfiguration["verification"]})}><option value="pending">Pendiente</option><option value="provisional">Provisional</option><option value="verified">Verificada por el usuario</option></select></label><label><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>Contrasté esta configuración con la fuente; es una declaración personal.</label></>}
      <h4>Restricciones explícitas</h4>
      {draft.restrictions.some(isSupportedAssociationRestriction) && <ul>{projectTournamentAffiliations(t,all,activity,universeId).rows.map(row=><li key={row.team.id}>{row.team.name}: {row.association?.name ?? "Asociación desconocida"} · {row.state}.</li>)}</ul>}
      <div className="draw-actions">{([["group-size","Límites de grupo"],["pot-distribution","Cuota por bombo"],["incompatible","Participantes incompatibles"],["fixed-position","Posición fija"],["unsupported","Condición no soportada"]] as const).map(([type,label])=><button type="button" key={type} onClick={()=>addRule(type)}>Añadir {label}</button>)}</div>
      <button type="button" onClick={()=>addRule("association")}>Añadir máximo por asociación</button><p>Modalidad explícita, desactivada por defecto. Requiere afiliaciones y asociaciones documentales verificadas para todos los participantes; una afiliación desconocida bloquea su uso definitivo.</p>
      {draft.restrictions.map(r=>{const change=(patch:object)=>update({restrictions:draft.restrictions.map(old=>old.id===r.id?{...old,...patch} as DrawRestriction:old)});return <fieldset key={r.id}><legend>{r.type}</legend>
        {(r.type==="group-size" || r.type==="fixed-position") && <label>Grupo de la restricción<select value={r.group} onChange={e=>change({group:e.target.value})}>{view.groups.map(g=><option key={g.name}>{g.name}</option>)}</select></label>}
        {r.type==="group-size" && <><label>Mínimo<input type="number" min={0} value={r.min} onChange={e=>change({min:Number(e.target.value)})}/></label><label>Máximo<input type="number" min={0} value={r.max} onChange={e=>change({max:Number(e.target.value)})}/></label></>}
        {r.type==="pot-distribution" && <><label>Bombo de la restricción<select value={r.potId} onChange={e=>change({potId:e.target.value})}><option value="">Selecciona un bombo</option>{draft.pots.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Participantes por grupo<input type="number" min={1} value={r.perGroup} onChange={e=>change({perGroup:Number(e.target.value)})}/></label></>}
        {r.type==="incompatible" && t.teams.map(team=><label key={team.id}><input type="checkbox" checked={r.teamIds.includes(team.id)} onChange={e=>change({teamIds:e.target.checked?[...r.teamIds,team.id]:r.teamIds.filter(id=>id!==team.id)})}/>Separar {team.name}</label>)}
        {r.type==="fixed-position" && <><label>Participante con plaza fija<select value={r.teamId} onChange={e=>change({teamId:e.target.value})}>{t.teams.map(team=><option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label>Posición explícita<input type="number" min={1} value={r.position} onChange={e=>change({position:Number(e.target.value)})}/></label></>}
        {isSupportedAssociationRestriction(r) && <label>Máximo por asociación y grupo<input type="number" min={1} value={r.maxPerGroup} onChange={e=>change({maxPerGroup:Number(e.target.value)})}/></label>}
        {(r.type==="unsupported" || r.type==="association") && <label>Condición pendiente<input value={r.description} onChange={e=>change({description:e.target.value})}/></label>}
        <button type="button" onClick={()=>update({restrictions:draft.restrictions.filter(old=>old.id!==r.id)})}>Eliminar restricción</button>
      </fieldset>;})}
      <button type="button" onClick={()=>inspect()}>Revisar bombos y restricciones</button>
      {saved && !saved.deleted && <button type="button" onClick={()=>inspect(true)}>Revisar eliminación de configuración</button>}
    </fieldset>
    {review && <section aria-label="Vista previa de bombos"><h4 ref={preview} tabIndex={-1}>{review.configuration.deleted?"Retirar configuración":"Configuración revisada"} · {review.validation.state}</h4><p>{t.name} · {t.competitionId} · {t.season} · {view.stages.find(s=>s.key===review.configuration.stage)?.name} · Universo {universeId ?? "principal"} · revisión {draft.revision}</p><p>Participantes: {review.configuration.participantIds.map(name).join(", ")}</p><ul>{review.configuration.pots.map(p=><li key={p.id}>{p.name} ({p.teamIds.length}/{p.capacity}): {p.teamIds.map(name).join(", ")}</li>)}</ul><p>Cabezas de serie: {review.configuration.seeding?.teamIds.map(name).join(", ") || "Ninguna"}. {review.configuration.seeding?.basis}</p><p>Fuente: {review.configuration.source?.url ?? "Escenario local"} · {review.configuration.source?.reference} · {review.configuration.mode==="documented"?({pending:"Pendiente",provisional:"Provisional",verified:"Verificada por el usuario"})[review.configuration.verification]:""}</p><ul>{review.configuration.restrictions.map(r=><li key={r.id}>{describe(r)}</li>)}</ul><p>{review.validation.state==="Válida"?review.validation.warning:"La configuración conserva condiciones pendientes; no habilita una distribución definitiva."}</p><button type="button" disabled={busy} onClick={()=>void confirm()}>Confirmar bombos y restricciones</button><button type="button" disabled={busy} onClick={()=>setReview(null)}>Volver al editor de bombos</button></section>}
    <button type="button" disabled={busy} onClick={()=>{setDraft(null);setReview(null);}}>Cerrar editor de bombos</button></>}
    {message && <p role="status">{message}</p>}
    <details><summary>Historial de configuraciones</summary><ul>{activity.filter(e=>e.tournamentId===t.id && e.action==="draw-configuration-recorded").map(e=><li key={e.id}>{e.occurredAt} · {e.summary}</li>)}</ul></details>
  </section>;
}
