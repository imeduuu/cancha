import {useEffect,useRef,useState} from "react";
import type {Tournament} from "../../domain/entities/tournament";
import type {TournamentRepository} from "../../application/ports/tournament-repository";
import {generateLocalGroups,inspectLocalGroupGeneration,reviewGeneratedLocalGroups,type LocalGroupProposal} from "../../application/use-cases/generate-local-groups";
import {groupDistributionIdentity,type GroupSearchResult} from "../../application/services/constraint-group-generator";
import type {StageDrawReview} from "../../application/use-cases/prepare-stage-draw";

interface Props {tournament:Tournament;stage:string;universeId:string|null;universeName:string;getUniverseId:()=>string|null;repository:TournamentRepository;disabled:boolean;onReview:(review:StageDrawReview)=>void}
export function LocalGroupGenerator(props:Props){
  const [seed,setSeed]=useState("cancha-1"),[result,setResult]=useState<GroupSearchResult|null>(null),[proposal,setProposal]=useState<LocalGroupProposal|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const active=useRef<AbortController|null>(null),serial=useRef(0),attempt=useRef(0),heading=useRef<HTMLHeadingElement>(null);
  const request={tournamentId:props.tournament.id,stage:props.stage,universeId:props.universeId,seed};
  const view=inspectLocalGroupGeneration(request,props.repository),configuration=view.configuration;
  const library=JSON.stringify([props.repository.findAll(),props.repository.findActivity?.() ?? [],props.universeId]);
  useEffect(()=>()=>{serial.current++;active.current?.abort();},[]);
  // No search is started here. A change only invalidates in-memory work.
  useEffect(()=>{serial.current++;active.current?.abort();active.current=null;setBusy(false);setProposal(null);setResult(null);setMessage("");},[library]);
  useEffect(()=>{if(props.disabled){serial.current++;active.current?.abort();active.current=null;setBusy(false);}},[props.disabled]);
  const name=(id:string)=>props.tournament.teams.find(team=>team.id===id)?.name ?? id;
  async function search(kind:"check"|"generate"|"another"){
    if(active.current || props.disabled)return;
    let chosenSeed=seed;
    if(kind==="another"){attempt.current++;chosenSeed=`${seed.slice(0,100)}:${attempt.current}`;setSeed(chosenSeed);}
    const previous=proposal,controller=new AbortController(),run=++serial.current;
    active.current=controller;setBusy(true);setMessage("");
    try{
      const outcome=await generateLocalGroups({...request,seed:chosenSeed},props.repository,{signal:controller.signal});
      if(run!==serial.current || props.getUniverseId()!==props.universeId)return;
      setResult(outcome);
      if(kind!=="check" && outcome.proposal){
        const ordinal=!!configuration?.restrictions.some(r=>r.type==="fixed-position");
        if(previous && groupDistributionIdentity(previous.groups,ordinal)===groupDistributionIdentity(outcome.proposal.groups,ordinal))setMessage("El resultado coincide con la propuesta anterior. No se ha demostrado que existan otras distribuciones; se conserva la propuesta anterior y su semilla.");
        else {setProposal(outcome.proposal);setTimeout(()=>heading.current?.focus(),0);}
      }
    }catch(e){if(run===serial.current)setMessage(e instanceof Error?e.message:"No se pudo completar la búsqueda.");}
    finally{if(run===serial.current){active.current=null;setBusy(false);}}
  }
  return <section aria-label="Generación local de grupos"><h4>Generación local asistida</h4>
    <p>{props.tournament.name} · {props.tournament.season} · {props.universeName} · Grupos registrados.</p>
    <p>Utiliza exclusivamente los bombos y restricciones registrados. No es un sorteo oficial y no garantiza probabilidades uniformes.</p>
    <p>Participantes: {configuration?.participantIds.length ?? 0} · bombos: {configuration?.pots.length ?? 0} · restricciones: {configuration?.restrictions.length ?? 0} · cabezas de serie explícitas: {configuration?.seeding?.teamIds.length ?? 0} · revisión: {configuration?.revision ?? "sin registrar"}.</p>
    <p>Estado documental: {configuration?.mode==="documented"?({verified:"Verificada por el usuario",pending:"Pendiente",provisional:"Provisional"})[configuration.verification]:"Escenario local"}.</p>
    {view.reasons.length>0 && <ul>{view.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>}
    {view.resourceLimit && <p>{view.resourceLimit} La viabilidad queda sin determinar.</p>}
    <label>Semilla de generación local<input value={seed} maxLength={128} disabled={busy || props.disabled} onChange={e=>setSeed(e.target.value)}/></label>
    <div className="draw-actions"><button type="button" disabled={busy || props.disabled || !!view.reasons.length} onClick={()=>void search("check")}>Comprobar viabilidad</button><button type="button" disabled={busy || props.disabled || !!view.reasons.length} onClick={()=>void search("generate")}>Generar distribución local</button>{proposal && <button type="button" disabled={busy || props.disabled || !!view.reasons.length} onClick={()=>void search("another")}>Generar otra propuesta</button>}{busy && <button type="button" onClick={()=>active.current?.abort()}>Cancelar búsqueda</button>}</div>
    {busy && <p role="status">Búsqueda en curso; puedes cancelarla. No se está escribiendo en la biblioteca.</p>}
    {result && <div role="status"><p>Viabilidad: {result.state}</p><ul>{result.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul><p>{result.stats.nodes} nodos · {result.stats.checks} comprobaciones · {result.stats.elapsedMs.toFixed(1)} ms.</p></div>}
    {message && <p role="status">{message}</p>}
    {proposal && <section aria-label="Propuesta local de grupos"><h4 ref={heading} tabIndex={-1}>Distribución local propuesta</h4><p>Semilla utilizada: {proposal.seed}. Configuración: revisión {proposal.configurationRevision}.</p>
      <div className="draw-stage-grid">{proposal.groups.map(g=><article key={g.name}><h5>Grupo {g.name} · {g.teamIds.length}/{view.groups.find(old=>old.name===g.name)?.teamIds.length} plazas</h5><ol>{g.teamIds.map(id=><li key={id}>{name(id)} · {configuration?.pots.find(p=>p.teamIds.includes(id))?.name ?? "Sin bombo"}</li>)}</ol><p>Capacidad y restricciones explícitas comprobadas: límites, cuotas, incompatibilidades y posiciones fijas registradas. No se añaden condiciones a las cabezas de serie.</p></article>)}</div>
      <p>La posición de cada participante es el orden explícito de esta propuesta. Confirmar solo registra la distribución; después podrás revisar sus encuentros por separado.</p>
      <button type="button" disabled={busy || props.disabled || !!view.reasons.length} onClick={()=>{try{props.onReview(reviewGeneratedLocalGroups(proposal,props.repository,props.getUniverseId()));}catch(e){setMessage(e instanceof Error?e.message:"La propuesta dejó de ser válida.");}}}>Revisar distribución</button>
      <button type="button" disabled={busy || props.disabled} onClick={()=>{setProposal(null);setMessage("");}}>Descartar propuesta local</button>
    </section>}
  </section>;
}
