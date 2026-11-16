import {SportsDecisionsAccess} from "./sports-decisions-access";
import {DrawCenterAccess} from "./draw-center-access";
import { SeasonClosureAccess } from "./season-closure-access";
import { SeasonSimulationAccess } from "./season-simulation-access";
import {useState} from "react";
import type {PlanningCenterProps} from "./season-planning-center";
import {SeasonPlanningAccess} from "./season-planning-access";
import {ContinentalQualificationAccess} from "./continental-qualification-access";
import {ActivityHistory} from "./activity-history";
import {projectSeasonProgression,progressionStages} from "../../application/services/season-progression";
import {useSessionDraft} from "../session-drafts";

export function SeasonProgressionPanel(props:PlanningCenterProps){
 const {tournaments,activity,onOpen,onCalendar,onAlerts}=props;
 const contextKey=props.contextKey ?? "season-progression";
 const [ids,setIds]=useSessionDraft(`${contextKey}:selection`,[] as string[]);
 const [history,setHistory]=useState(false);
 const view=projectSeasonProgression(ids,tournaments,activity);
 const name=(id:string)=>tournaments.find(t=>t.id===id)?.name ?? `No disponible: ${id}`;
 return <details className="season-progression"><summary>Asistente de progresión de temporadas</summary>
  <section aria-label="Progresión encadenada de temporadas">
   <p>Selecciona temporadas concretas. Cada competición avanza por separado. Disponible indica acceso a revisión; las verificaciones y confirmaciones deportivas se mantienen en cada flujo.</p>
   <fieldset><legend>Temporadas incluidas en la progresión</legend>{tournaments.map(t=><label key={t.id} className="club-history-choice"><input type="checkbox" checked={ids.includes(t.id)} onChange={e=>setIds(e.target.checked?[...ids,t.id]:ids.filter(id=>id!==t.id))}/>{t.name} · {t.season ?? "sin año"} · {t.id}</label>)}</fieldset>
   {!ids.length && <p>Selecciona al menos una temporada para consultar sus pendientes.</p>}
   {view.missingIds.map(id=><p key={id} role="status">Temporada seleccionada no disponible: {id}</p>)}
   <details><summary>Dependencias explícitas ({view.dependencies.length})</summary>
    {!view.dependencies.length && <p>Sin relaciones registradas. La selección conjunta no vincula divisiones ni ediciones.</p>}
    <ul>{view.dependencies.map((d,i)=><li key={i}>{name(d.sourceId)} → {name(d.targetId)}: {d.reason}</li>)}</ul>
   </details>
   {view.rows.map(row=><article key={row.tournament.id} aria-label={`Progresión: ${row.tournament.name}`}>
    <SeasonSimulationAccess tournament={row.tournament} /><SeasonClosureAccess tournament={row.tournament} /><DrawCenterAccess tournament={row.tournament} /><SportsDecisionsAccess tournament={row.tournament} /><h4>{row.tournament.name} · {row.overview.status}</h4>
    <p>{row.overview.provenance} · Partidos válidos: {row.overview.played}/{row.overview.total}</p>
    <ol>{progressionStages.map((label,i)=><li key={label}><strong>{label}</strong>: {row.stages[i]} · {i===6 ? (row.successors.length ? row.successors.map(next=><button key={next.id} type="button" className="small-action" onClick={()=>onOpen(next)}>Continuar: {next.name}</button>) : <span>Prepara una edición y revisa su calendario y reglamento.</span>) : <button type="button" className="small-action" onClick={()=>i===0?onCalendar(row.tournament):i<3?onAlerts(row.tournament):onOpen(row.tournament)}>{i===0?"Abrir calendario":i<3?"Revisar tablas y resoluciones":i===5?"Abrir importadores y reglamentos":"Abrir temporada y preparación"}</button>}</li>)}</ol>
    {row.reasons.length>0 && <ul>{row.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>}
    <p>Para simular expresamente, abre el calendario y elige el alcance en el simulador existente. Sin calendario suficiente, importa los datos antes de continuar.</p>
    <button type="button" className="small-action" onClick={()=>onCalendar(row.tournament)}>Ir a simulación en calendario</button>
    <ContinentalQualificationAccess tournament={row.tournament} tournaments={tournaments} activity={activity} onOpen={onOpen} onReview={props.onReviewContinental} onConfirm={props.onConfirmContinental}/>
    {row.successors.map(next=><p key={next.id}>Temporada creada con origen registrado: <button type="button" onClick={()=>onOpen(next)}>{next.name} · {next.season ?? "sin año"}</button></p>)}
   </article>)}
   {ids.length>0 && <><p>Revisa participantes, movimientos y destino en el Centro de planificación. Allí se eligen las divisiones y reglamentos explícitamente antes de confirmar cada creación.</p><SeasonPlanningAccess {...props} contextKey={`${contextKey}:planning`}/></>}
   <button type="button" className="small-action" onClick={()=>setHistory(!history)}>Consultar actividad de las temporadas seleccionadas</button>
   {history && <ActivityHistory events={view.events} tournaments={tournaments} onClose={()=>setHistory(false)} onOpenTournament={onOpen} onOpenMatch={t=>onCalendar(t)}/>}
   <p>El historial muestra operaciones registradas, sin atribuirlas al asistente. Los respaldos antiguos pueden no contener relaciones ni actividad.</p>
  </section>
 </details>;
}
