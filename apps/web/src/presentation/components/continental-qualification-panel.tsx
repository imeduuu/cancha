import { useLibraryWrite } from "../library-write-context";
import { useMemo, useState } from "react";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import type { ContinentalCup } from "@cancha/core/domain/entities/continental-plan";
import type { ContinentalPreparationInput, ContinentalReview } from "@cancha/core/application/use-cases/prepare-continental-edition";
import { continentalProjection, continentalPlanState, continentalRosterDifferences, entryKey } from "@cancha/core/application/services/continental-projection";
import { competitionIdentity } from "@cancha/core/application/services/competition-center";
import { useSessionDraft } from "../session-drafts";
import { ConfirmationDialog } from "./confirmation-dialog";
export interface ContinentalPanelProps {
  tournament: Tournament;
  tournaments: readonly Tournament[];
  activity: readonly ActivityEvent[];
  onOpen: (t: Tournament) => void;
  onReview?: (input: ContinentalPreparationInput) => ContinentalReview;
  onConfirm?: (review: ContinentalReview) => Tournament;
}
const statusLabel = { confirmed: "Confirmado por reglas verificadas", provisional: "Provisional", pending: "Cupo pendiente" };
const scenarioLabel = { local: "Escenario simulado o editado localmente", provider: "Proveedor · sin certificación oficial", unknown: "Procedencia no acreditada" };
export function ContinentalQualificationPanel({ tournament:t, tournaments, activity, onOpen, onReview, onConfirm }: ContinentalPanelProps) {
  const runWrite = useLibraryWrite();

  const identity = competitionIdentity(t);
  const continental = ["conmebol-libertadores","conmebol-sudamericana"].includes(identity);
  const last = t.continentalPlans?.[t.continentalPlans.length - 1];
  const referringLeagues = tournaments.filter(source => source.id !== t.id && source.season === t.season
    && source.competitionRules?.internationalQualification?.cupChampions?.some(cup => cup.sourceTournamentId === t.id));
  const [form,setForm] = useSessionDraft(JSON.stringify(["continental-form",t.id]), () => ({
    cup: (continental ? identity.replace("conmebol-","") : "libertadores") as ContinentalCup,
    qualifyingSeason: String(last?.qualifyingSeason ?? (!continental ? t.season ?? "" : "")),
    edition: continental ? String(t.season ?? "") : "", sourceIds: continental ? [...(last?.sourceTournamentIds ?? [])] : [t.id,...referringLeagues.map(source => source.id)],
    selectedKeys: [] as string[], sourceUrl:"", note:"",
  }));
  const [review,setReview] = useState<ContinentalReview | null>(null);
  const [error,setError] = useState(""); const [message,setMessage] = useState("");
  const projection = useMemo(() => continentalProjection(form.sourceIds,Number(form.qualifyingSeason),form.cup,tournaments,activity),
    [form.sourceIds,form.qualifyingSeason,form.cup,tournaments,activity]);
  const selectedEntries = projection.entries.filter(e => form.selectedKeys.includes(entryKey(e)));
  const targets = tournaments.filter(cup => competitionIdentity(cup) === `conmebol-${form.cup}` && cup.season === Number(form.edition));
  const target = continental ? t : targets.length === 1 ? targets[0] : undefined;
  function change(patch: Partial<typeof form>) { setForm(old => ({...old,...patch})); setError(""); setMessage(""); }
  function startReview() {
    try {
      if (!onReview) throw new Error("No está disponible el guardado de revisiones.");
      if (targets.length > 1 && !continental) throw new Error("Hay varias ediciones guardadas. Abre la copa concreta para registrar su revisión.");
      setReview(onReview({cup:form.cup,qualifyingSeason:Number(form.qualifyingSeason),edition:Number(form.edition),sourceIds:form.sourceIds,
        selectedKeys:form.selectedKeys,sourceUrl:form.sourceUrl,note:form.note,...(target ? {targetId:target.id}: {})})); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo revisar la proyección."); }
  }
  return <section className="continental-qualification" aria-label={`Clasificación internacional de ${t.name}`}>
    <p>Los estados describen el cálculo deportivo; no certifican cupos oficiales. Elegir una edición es una decisión documental expresa, no una regla anual automática.</p>
    {!continental && referringLeagues.map(source => <p key={source.id}>Cupo registrado en el reglamento de: <button className="small-action" type="button" onClick={() => onOpen(source)}>{source.name}</button></p>)}
    {!continental && tournaments.flatMap(cup => (cup.continentalPlans ?? []).filter(p => p.sourceTournamentIds.includes(t.id)).map(plan =>
      <p key={`${cup.id}-${plan.id}`}>Edición vinculada: <button className="small-action" type="button" onClick={() => onOpen(cup)}>{cup.name}</button> · {continentalPlanState(plan,tournaments,activity)}</p>))}
    {continental && !t.continentalPlans?.length && <p>No hay procedencia nacional registrada para estos participantes. Las coincidencias nominales no acreditan una clasificación.</p>}
    {t.continentalPlans?.map(plan => {
      const differences=continentalRosterDifferences(plan.entries,t);
      return <details key={plan.id}><summary>Procedencia registrada · {plan.qualifyingSeason} → {plan.edition} · {plan.at}</summary>
        <p>{continentalPlanState(plan,tournaments,activity)} · {plan.mode === "incorporated" ? "Participantes incorporados expresamente en escenario local" : "Revisión documental; nómina conservada"}</p>
        {plan.pendingReasons?.map(reason => <p key={reason}>Pendiente al registrar: {reason}</p>)}
        <p>Referencia: {plan.sourceUrl}</p><p>Decisión: {plan.note}</p>
        {plan.entries.map(e => <p key={entryKey(e)}>{e.teamName} · Cálculo de {e.sourceTournamentName} · Estado al registrar: {statusLabel[e.status]} · {scenarioLabel[e.scenario]} · origen {e.sourceSeason}: {tournaments.find(s => s.id === e.originTournamentId)
          ? <button className="small-action" type="button" onClick={() => onOpen(tournaments.find(s => s.id === e.originTournamentId)!)}>{tournaments.find(s => s.id === e.originTournamentId)!.name}</button> : `${e.originTournamentName} (no disponible: ${e.originTournamentId})`}</p>)}
        <p>Previstos ausentes de la nómina actual: {differences.missing.join(", ") || "ninguno"}</p><p>Participantes actuales fuera de esta selección parcial: {differences.added.join(", ") || "ninguno"}</p>
      </details>;
    })}
    <div className="competition-controls">
      <label>Copa de destino<select disabled={continental} value={form.cup} onChange={e => change({cup:e.target.value as ContinentalCup,selectedKeys:[]})}>
        <option value="libertadores">Copa Libertadores</option><option value="sudamericana">Copa Sudamericana</option>
      </select></label>
      <label>Temporada nacional de origen<input type="number" min="1" value={form.qualifyingSeason} onChange={e => change({qualifyingSeason:e.target.value,selectedKeys:[]})}/></label>
      <label>Edición continental propuesta<input type="number" min="1" readOnly={continental} value={form.edition} onChange={e => change({edition:e.target.value})}/></label>
    </div>
    <fieldset><legend>Competiciones nacionales de origen</legend>{tournaments.filter(s => !competitionIdentity(s).startsWith("conmebol-")).map(source =>
      <label className="continental-choice" key={source.id}><input type="checkbox" checked={form.sourceIds.includes(source.id)} onChange={e => change({sourceIds:e.target.checked ? [...form.sourceIds,source.id] : form.sourceIds.filter(id => id !== source.id),selectedKeys:[]})}/>{source.name} · {source.season ?? "sin año"} · {source.id}</label>)}</fieldset>
    <fieldset><legend>Clasificados calculados para la selección</legend>{!projection.entries.length && <p>No hay equipos elegibles calculados para esta selección. Los cupos sin resolver no se completan automáticamente.</p>}
      {projection.entries.map(entry => <label className="continental-choice" key={entryKey(entry)}><input type="checkbox"
        disabled={entry.status === "pending" || projection.conflicts.includes(entryKey(entry))} checked={form.selectedKeys.includes(entryKey(entry))}
        onChange={e => change({selectedKeys:e.target.checked ? [...form.selectedKeys,entryKey(entry)] : form.selectedKeys.filter(key => key !== entryKey(entry))})}/>
        {entry.teamName} · {statusLabel[entry.status]} · {scenarioLabel[entry.scenario]} · {entry.destination} · {entry.originTournamentName} ({entry.sourceSeason}) · cálculo de {entry.sourceTournamentName}
        {projection.conflicts.includes(entryKey(entry)) && " · Conflicto de identidad o cupo"}</label>)}
    </fieldset>
    {projection.reasons.length > 0 && <details><summary>Cupos pendientes, dependencias y advertencias ({projection.reasons.length})</summary><ul>{projection.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></details>}
    {targets.map(cup => { const differences=continentalRosterDifferences(selectedEntries,cup); return <div key={cup.id}>
      <p>Edición guardada: {cup.name}. Se registrará una revisión documental sin cambiar su nómina ni sus partidos.</p>
      <p>Previstos sin coincidencia nominal: {differences.missing.join(", ") || "ninguno"}</p>
      <p>Publicados o guardados fuera de esta selección parcial: {differences.added.join(", ") || "ninguno"}</p>
      <p>Coincidencias nominales por revisar (no prueban identidad): {differences.nominal.join(", ") || "ninguna"}</p>
    </div>; })}
    <label className="continental-document">Referencia documental HTTPS<input type="url" value={form.sourceUrl} onChange={e => change({sourceUrl:e.target.value})}/></label>
    <label className="continental-document">Decisión y relación entre temporadas<textarea value={form.note} onChange={e => change({note:e.target.value})}/></label>
    <button className="small-action" type="button" disabled={!onReview || !onConfirm} onClick={startReview}>Revisar vinculación continental</button>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <ConfirmationDialog open={!!review} title={review?.target ? "Registrar revisión continental" : "Preparar edición continental"}
      eyebrow="PLANIFICACIÓN LOCAL" description={`${review?.entries.length ?? 0} equipo(s) seleccionados para ${form.cup} ${form.edition}, desde ${form.qualifyingSeason}. Referencia: ${form.sourceUrl}. Decisión: ${form.note}`}
      warning={review?.target ? "Se conservan todos los participantes, calendarios, plantillas y resultados existentes." : "Esta planificación puede incluir clasificados provisionales o simulados. No crea grupos, partidos ni reglas oficiales."}
      confirmLabel="Confirmar planificación" onCancel={() => setReview(null)} onConfirm={async () => {
        try { await runWrite(() => { if (!review || !onConfirm) return; const saved=onConfirm(review); setReview(null); change({selectedKeys:[]}); setMessage(`Se guardó la vinculación de ${saved.name}.`);  }); }
        catch(e) { setReview(null);setError(e instanceof Error ? e.message : "No se pudo guardar la vinculación."); }
      }}/>
  </section>;
}
