import { useLibraryWrite } from "../library-write-context";
import {useState} from "react";
import type {Tournament,RulesVerificationStatus} from "../../domain/entities/tournament";
import type {NationalCupCriterion} from "../../domain/entities/national-cup-planning";
import type {NationalCupRegulationInput} from "../../application/use-cases/register-national-cup-regulation";
import {competitionIdentity} from "../../application/services/competition-center";
import type {SeasonPlanningActions} from "../../application/use-cases/plan-season";
import {useSessionDraft} from "../session-drafts";
import {ConfirmationDialog} from "./confirmation-dialog";
interface Props {source:Tournament;edition:number;tournaments:readonly Tournament[];onRegister:SeasonPlanningActions["onRegisterCupRegulation"];onRecorded:(id:string)=>void}
export function NationalCupRegulationEditor({source,edition,tournaments,onRegister,onRecorded}:Props){
  const runWrite = useLibraryWrite();

 const [form,setForm]=useSessionDraft(`national-cup-editor:${source.id}:${edition}`,{verification:"pending" as RulesVerificationStatus,url:"",note:"",expected:"",criteria:[] as NationalCupCriterion[],kind:"division" as NationalCupCriterion["kind"],origin:"",count:"",description:"",criterionUrl:"",criterionVerification:"pending" as RulesVerificationStatus,positions:"",teamIds:[] as string[]});
 const [review,setReview]=useState<NationalCupRegulationInput|null>(null),[error,setError]=useState("");
 const origin=tournaments.find(t=>t.id===form.origin);
 const change=(patch:Partial<typeof form>)=>{setForm(old=>({...old,...patch}));setReview(null);setError("");};
 const statuses=(value:RulesVerificationStatus,set:(v:RulesVerificationStatus)=>void,label:string)=><label>{label}<select value={value} onChange={e=>set(e.target.value as RulesVerificationStatus)}><option value="pending">Pendiente</option><option value="provisional">Provisional</option><option value="verified">Verificado manualmente por el usuario</option></select></label>;
 return <details><summary>Registrar reglamento de admisión para esta edición</summary><section aria-label="Registro de admisión de copa nacional">
  <p>Edición {edition || "sin seleccionar"}. Registra únicamente disposiciones documentadas. Una URL no verifica su contenido ni confirma participantes oficiales. Cada registro nuevo conserva los anteriores.</p>
  {statuses(form.verification,value=>change({verification:value}),"Verificación del reglamento de admisión")}
  <label>Fuente HTTPS del reglamento de admisión<input type="url" value={form.url} onChange={e=>change({url:e.target.value})}/></label>
  <label>Decisión documental de admisión<textarea value={form.note} onChange={e=>change({note:e.target.value})}/></label>
  <label>Cantidad total de participantes documentada<input type="number" min="1" value={form.expected} onChange={e=>change({expected:e.target.value})}/></label>
  <fieldset><legend>Agregar criterio documentado</legend>
   <label>Tipo de criterio de admisión<select value={form.kind} onChange={e=>change({kind:e.target.value as NationalCupCriterion["kind"],teamIds:[]})}><option value="division">Nómina de división expresamente prevista</option><option value="positions">Posiciones de tabla acreditadas</option><option value="champion">Campeón acreditado de otra competición</option><option value="explicit">Clubes registrados invitados o incorporados</option><option value="pending">Cupos pendientes</option></select></label>
   {form.kind!=="pending" && <label>Competición y temporada de procedencia<select value={form.origin} onChange={e=>change({origin:e.target.value,teamIds:[]})}><option value="">Selecciona un origen registrado</option>{tournaments.map(t=><option key={t.id} value={t.id}>{t.name} · {t.season ?? "sin año"} · {competitionIdentity(t)} · {t.id}</option>)}</select></label>}
   <label>Cupos de este criterio<input type="number" min="1" value={form.count} onChange={e=>change({count:e.target.value})}/></label>
   <label>Descripción documental del criterio<input value={form.description} onChange={e=>change({description:e.target.value})}/></label>
   <label>Fuente HTTPS del criterio<input type="url" value={form.criterionUrl} onChange={e=>change({criterionUrl:e.target.value})}/></label>
   {statuses(form.criterionVerification,value=>change({criterionVerification:value}),"Verificación del criterio de admisión")}
   {form.kind==="positions" && <label>Posiciones documentadas separadas por coma<input value={form.positions} onChange={e=>change({positions:e.target.value})}/></label>}
   {form.kind==="explicit" && <fieldset><legend>Clubes registrados expresamente documentados</legend>{origin?.teams.map(t=><label key={t.id} className="club-history-choice"><input type="checkbox" checked={form.teamIds.includes(t.id)} onChange={e=>change({teamIds:e.target.checked?[...form.teamIds,t.id]:form.teamIds.filter(id=>id!==t.id)})}/>{t.name} · ID {t.id}</label>)}</fieldset>}
   <button type="button" className="small-action" onClick={()=>{const criterion:NationalCupCriterion={id:crypto.randomUUID(),kind:form.kind,count:Number(form.count),description:form.description,verification:form.criterionVerification,...(form.criterionUrl?{sourceUrl:form.criterionUrl}:{}),...(form.kind!=="pending" && origin?{sourceTournamentId:origin.id,sourceCompetitionId:competitionIdentity(origin),sourceSeason:origin.season}:{}),...(form.kind==="explicit"?{teamIds:form.teamIds}:{}),...(form.kind==="positions"?{positions:form.positions.split(",").map(n=>Number(n.trim()))}:{})};change({criteria:[...form.criteria,criterion],count:"",description:"",positions:"",teamIds:[]});}}>Agregar criterio a borrador</button>
  </fieldset>
  <ul aria-label="Criterios de admisión en borrador">{form.criteria.map(c=><li key={c.id}>{c.description} · {c.kind} · {c.count} cupos · {c.verification} · {c.sourceTournamentId ?? "sin origen resuelto"} · {c.sourceSeason ?? "sin temporada"} · {c.sourceUrl ?? "sin fuente"}<button type="button" className="small-action" onClick={()=>change({criteria:form.criteria.filter(other=>other.id!==c.id)})}>Retirar criterio {c.description}</button></li>)}</ul>
  <button type="button" className="small-action" disabled={!onRegister || !edition} onClick={()=>setReview(JSON.parse(JSON.stringify({edition,verification:form.verification,...(form.url?{sourceUrl:form.url}:{}),note:form.note,expectedParticipants:Number(form.expected),criteria:form.criteria})) as NationalCupRegulationInput)}>Revisar registro de admisión</button>
  {error && <p role="alert">{error}</p>}
  <ConfirmationDialog open={!!review} title="Confirmar registro de admisión" eyebrow="DOCUMENTACIÓN MANUAL" description={`${review?.edition ?? ""} · ${review?.expectedParticipants ?? 0} participantes · ${review?.criteria.map(c=>c.description).join("; ") ?? ""} · ${review?.verification ?? ""}`}
   warning="Se guardará un registro documental, sin crear una edición ni modificar sus partidos. La verificación es manual; HTTPS no certifica el documento." confirmLabel="Confirmar registro documental" onCancel={()=>setReview(null)} onConfirm={async ()=>{try{ await runWrite(() => {if(!review || !onRegister)return;const saved=onRegister(source.id,review);onRecorded(saved.nationalCupPlanning!.regulations.at(-1)!.id);setReview(null);setError(""); }); }catch(e){setReview(null);setError(e instanceof Error?e.message:"No se pudo registrar.");}}}/>
 </section></details>;
}
