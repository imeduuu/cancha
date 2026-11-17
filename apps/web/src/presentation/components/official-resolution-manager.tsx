import { useLibraryWrite } from "../library-write-context";
import { useSessionDraft } from "../session-drafts";
import { useState } from "react";
import type { Tournament, RulesVerificationStatus, MatchResult } from "@cancha/core/domain/entities/tournament";
import type { OfficialDecisionMatch, OfficialProgramme, OfficialResolutionContext, OfficialResolution } from "@cancha/core/domain/entities/official-resolution";
import type { TournamentRepository } from "@cancha/core/application/ports/tournament-repository";
import { getOfficialResolutionContexts, regularDivisionTournament, divisionZoneTournaments, hasCompleteDivisionLeague } from "@cancha/core/domain/services/second-division-progression";
import { currentResolution } from "@cancha/core/domain/services/official-resolution-core";
import { programmeOrder, programmeStandings } from "@cancha/core/domain/services/official-programme";
import { calculateStandings, getUnresolvedStandingsTieDetails } from "@cancha/core/domain/services/standings";
import { secondDivisionKind } from "@cancha/core/domain/services/second-division-rules";
import { recordOfficialResolution, revokeOfficialResolution, type RecordOfficialResolutionInput } from "@cancha/core/application/use-cases/record-official-resolution";
import { ConfirmationDialog } from "./confirmation-dialog";

const verificationLabels = { verified: "Verificado por el usuario", provisional: "Provisional", pending: "Pendiente de verificar" };
function resolved(tournament: Tournament, context: OfficialResolutionContext, item?: OfficialResolution): boolean {
  return item?.verification === "verified" && (context.scope === "argentina-relegation" ? Boolean(programmeOrder(tournament, context)) : true);
}
export function OfficialResolutionManager({ tournament, repository, onChange, onReviewResolution, draftScope, showHistory = true }: {
  tournament: Tournament; repository: TournamentRepository; onChange: (tournament: Tournament) => void;
  onReviewResolution?: (input: RecordOfficialResolutionInput) => void; draftScope?: string; showHistory?: boolean;
}) {
  const runWrite = useLibraryWrite();

  const [error, setError] = useState("");
  const [revoke, setRevoke] = useState<string>();
  const [reason, setReason] = useState("");
  const contexts = getOfficialResolutionContexts(tournament);
  const raw = { ...regularDivisionTournament(tournament), officialResolutions: undefined };
  const missing = secondDivisionKind(tournament) === "brasil" && hasCompleteDivisionLeague(tournament)
    ? getUnresolvedStandingsTieDetails(raw, calculateStandings(raw)).filter(detail => detail.criterion !== "configured-criteria") : [];
  const argentinaPending = secondDivisionKind(tournament) === "argentina" && hasCompleteDivisionLeague(tournament)
    ? divisionZoneTournaments(tournament).flatMap(zone => getUnresolvedStandingsTieDetails(zone, calculateStandings(zone))) : [];
  const names = (ids: readonly string[]) => ids.map(id => tournament.teams.find(team => team.id === id)?.name ?? id).join(", ");
  return <section aria-label="Resoluciones oficiales" className="official-resolution-manager">
    <h3>Sorteos y desempates oficiales</h3>
    <p>Registra solamente datos publicados. Una referencia oficial y la verificación manual son necesarias para resolver bloqueos; los registros provisionales no cambian las clasificaciones.</p>
    {contexts.length === 0 && <p>No hay sorteos ni desempates múltiples registrables en este momento. Las fases deben estar completas y los criterios previos resueltos.</p>}
    {missing.map((detail, index) => <p key={index} role="status">{detail.teams.map(team => team.teamName).join(", ")}: {detail.reason} No se puede sustituir este criterio por un sorteo.</p>)}
    {argentinaPending.map((detail, index) => <p key={`arg-${index}`} role="status">{detail.teams.map(team => team.teamName).join(", ")}: {detail.reason} Los empates de tabla siguen el art. 112; no se les aplica el sorteo del ordenamiento entre zonas.</p>)}
    {contexts.map(context => {
      const item = currentResolution(tournament, context);
      const complete = resolved(tournament, context, item);
      return <details key={`${context.scope}:${context.key}:${context.participantIds.join(",")}`} className="official-resolution-case">
        <summary>{context.title} · {complete ? "Resuelto" : item ? verificationLabels[item.verification] + (item.programme ? " · resolución deportiva pendiente" : "") : "Pendiente"}</summary>
        <p>Participantes: {names(context.participantIds)}.</p>
        {item && <p>Fuente registrada: <a href={item.source.url} target="_blank" rel="noreferrer">{item.source.reference}</a>. {verificationLabels[item.verification]}.</p>}
        {item?.programme?.format === "round-robin" && <table><caption>Tabla de partidos registrados del desempate</caption><thead><tr><th>Club</th><th>PJ</th><th>DG</th><th>GF</th><th>Pts</th></tr></thead><tbody>
          {programmeStandings(tournament, context.participantIds, item.programme).standings.map(row => <tr key={row.teamId}><td>{row.teamName}</td><td>{row.played}</td><td>{row.goalDifference}</td><td>{row.goalsFor}</td><td>{row.points}</td></tr>)}
        </tbody></table>}
        {complete && <p>Orden aplicado: {names(context.scope === "argentina-relegation" ? programmeOrder(tournament, context)! : item!.orderedTeamIds!)}.</p>}
        {(!onReviewResolution || !complete) && <ResolutionEditor key={`${draftScope ?? ""}:${context.dependencySnapshot}:${item?.id ?? "new"}`} tournament={tournament} context={context} current={item}
          onReview={onReviewResolution} draftScope={draftScope}
          onSave={input => { const next = recordOfficialResolution(tournament, input, repository); onChange(next); setError(""); }} />}
        {item && !onReviewResolution && <><label>Motivo para revocar<input value={revoke === item.id ? reason : ""} onChange={event => { setRevoke(item.id); setReason(event.target.value); }} /></label>
          <button type="button" disabled={revoke !== item.id || !reason.trim()} onClick={() => setRevoke(`confirm:${item.id}`)}>Revisar revocación</button></>}
      </details>;
    })}
    {showHistory && <details><summary>Historial de resoluciones ({tournament.officialResolutions?.length ?? 0})</summary>
      {(tournament.officialResolutions ?? []).map(item => <article key={item.id}>
        <h4>{item.key} · {item.invalidation ? "Invalidada" : item.supersededBy ? "Sustituida por una revisión" : verificationLabels[item.verification]}</h4>
        <p>{new Date(item.recordedAt).toLocaleString("es-CL", { timeZone: "America/Santiago" })} · {item.participantNames.map(team => team.name).join(", ")}</p>
        <p><a href={item.source.url} target="_blank" rel="noreferrer">{item.source.reference}</a></p>
        {item.invalidation && <p>{item.invalidation.at}: {item.invalidation.reason}</p>}
        {item.supersededBy && <p>Revisión sucesora: {item.supersededBy}.</p>}
        {item.orderedTeamIds && <p>Orden registrado: {item.orderedTeamIds.map(id => item.participantNames.find(team => team.teamId === id)?.name ?? id).join(", ")}.</p>}
        {item.programme && <><p>Formato publicado: {item.programme.description}. Partidos esperados: {item.programme.expectedMatches}.</p><ul>{item.programme.matches.map(match => <li key={match.id}>
          {item.participantNames.find(team => team.teamId === match.homeTeamId)?.name} – {item.participantNames.find(team => team.teamId === match.awayTeamId)?.name}: {match.result ? `${match.result.homeGoals}–${match.result.awayGoals}` : "Sin resultado"}
          {match.result?.extraTime && ` · Prórroga ${match.result.extraTime.homeGoals}–${match.result.extraTime.awayGoals}`}
          {match.result?.penalties && ` · Penales ${match.result.penalties.homeGoals}–${match.result.penalties.awayGoals}`}
          {match.resultSource && <> · <a href={match.resultSource.url} target="_blank" rel="noreferrer">{match.resultSource.reference}</a></>}
        </li>)}</ul>{item.programme.conclusion && <p>Conclusión AFA: <a href={item.programme.conclusion.source.url} target="_blank" rel="noreferrer">{item.programme.conclusion.source.reference}</a>. Orden: {item.programme.conclusion.orderedTeamIds.map(id => item.participantNames.find(team => team.teamId === id)?.name ?? id).join(", ")}.</p>}</>}
      </article>)}
    </details>}
    {error && <p role="alert">{error}</p>}
    <ConfirmationDialog open={Boolean(revoke?.startsWith("confirm:"))} title="Revocar resolución" description={reason}
      warning="Dejará de aplicarse y se revisarán sus cruces dependientes. Se conserva el registro histórico."
      confirmLabel="Revocar resolución" onCancel={() => setRevoke(undefined)} onConfirm={async () => {
        try { await runWrite(() => { onChange(revokeOfficialResolution(tournament, revoke!.slice(8), reason, repository)); setRevoke(undefined); setReason("");  }); }
        catch (error) { setError(error instanceof Error ? error.message : "No se pudo revocar."); setRevoke(undefined); }
      }} />
  </section>;
}

interface MatchDraft {
  id: string; home: string; away: string; date: string; venue: string; neutral: boolean;
  resolution: "" | "penalties" | "extra-time-then-penalties";
  homeGoals: string; awayGoals: string; extraHome: string; extraAway: string; penaltyHome: string; penaltyAway: string;
  sourceUrl: string; reference: string;
}
function draft(match?: OfficialDecisionMatch): MatchDraft {
  return { id: match?.id ?? crypto.randomUUID(), home: match?.homeTeamId ?? "", away: match?.awayTeamId ?? "",
    date: match?.date ?? "", venue: match?.venue ?? "", neutral: match?.neutral ?? true, resolution: match?.knockoutResolution ?? "",
    homeGoals: match?.result?.homeGoals.toString() ?? "", awayGoals: match?.result?.awayGoals.toString() ?? "",
    extraHome: match?.result?.extraTime?.homeGoals.toString() ?? "", extraAway: match?.result?.extraTime?.awayGoals.toString() ?? "",
    penaltyHome: match?.result?.penalties?.homeGoals.toString() ?? "", penaltyAway: match?.result?.penalties?.awayGoals.toString() ?? "",
    sourceUrl: match?.resultSource?.url ?? "", reference: match?.resultSource?.reference ?? "" };
}
function ResolutionEditor({ tournament, context, current, onSave, onReview, draftScope }: { tournament: Tournament; context: OfficialResolutionContext;
  current?: OfficialResolution; onSave: (input: RecordOfficialResolutionInput) => void; onReview?: (input: RecordOfficialResolutionInput) => void; draftScope?: string }) {
  const runWrite = useLibraryWrite();
  const version = JSON.stringify([context.dependencySnapshot, current]);
  function useDraft<T>(field: string, initial: T | (() => T)) {
    return useSessionDraft<T>(JSON.stringify(["resolution", ...(draftScope ? [draftScope] : []), tournament.id, context.key, field]), initial, version);
  }
  const [url, setUrl] = useDraft("url", current?.source.url ?? "");
  const [reference, setReference] = useDraft("reference", current?.source.reference ?? "");
  const [verification, setVerification] = useDraft<RulesVerificationStatus>("verification", current?.verification ?? "provisional");
  const [attested, setAttested] = useDraft("attested", false);
  const [order, setOrder] = useDraft<string[]>("order", [...(current?.orderedTeamIds ?? context.participantIds.map(() => ""))]);
  const [format, setFormat] = useDraft<"" | OfficialProgramme["format"]>("format", current?.programme?.format ?? "");
  const [description, setDescription] = useDraft("description", current?.programme?.description ?? "");
  const [expected, setExpected] = useDraft("expected", current?.programme?.expectedMatches.toString() ?? "");
  const [matches, setMatches] = useDraft<MatchDraft[]>("matches", current?.programme?.matches.map(draft) ?? []);
  const [conclusion, setConclusion] = useDraft("conclusion", Boolean(current?.programme?.conclusion));
  const [conclusionOrder, setConclusionOrder] = useDraft<string[]>("conclusionOrder", [...(current?.programme?.conclusion?.orderedTeamIds ?? context.participantIds.map(() => ""))]);
  const [conclusionUrl, setConclusionUrl] = useDraft("conclusionUrl", current?.programme?.conclusion?.source.url ?? "");
  const [conclusionRef, setConclusionRef] = useDraft("conclusionRef", current?.programme?.conclusion?.source.reference ?? "");
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);
  const options = <><option value="">Seleccionar club</option>{context.participantIds.map(id => <option key={id} value={id}>{tournament.teams.find(team => team.id === id)?.name}</option>)}</>;
  const number = (value: string) => { if (value.trim() === "" || !Number.isInteger(Number(value))) throw new Error("Completa ambos valores de cada marcador registrado."); return Number(value); };
  const submit = async () => {
    setReview(false);
    try {
      const programme = context.scope === "argentina-relegation" ? {
        format: format as OfficialProgramme["format"], description, expectedMatches: number(expected),
        matches: matches.map((match): OfficialDecisionMatch => {
          let result: MatchResult | undefined;
          if (match.homeGoals !== "" || match.awayGoals !== "") result = {
            homeGoals: number(match.homeGoals), awayGoals: number(match.awayGoals),
            ...(match.extraHome !== "" || match.extraAway !== "" ? { extraTime: { homeGoals: number(match.extraHome), awayGoals: number(match.extraAway) } } : {}),
            ...(match.penaltyHome !== "" || match.penaltyAway !== "" ? { penalties: { homeGoals: number(match.penaltyHome), awayGoals: number(match.penaltyAway) } } : {}),
          };
          return { id: match.id, homeTeamId: match.home, awayTeamId: match.away, neutral: format === "round-robin" ? true : match.neutral,
            ...(match.date ? { date: match.date } : {}), ...(match.venue ? { venue: match.venue } : {}),
            ...(match.resolution && format !== "round-robin" ? { knockoutResolution: match.resolution } : {}),
            ...(result ? { result, resultSource: { url: match.sourceUrl, reference: match.reference } } : {}),
          };
        }),
        ...(conclusion ? { conclusion: { orderedTeamIds: conclusionOrder, source: { url: conclusionUrl, reference: conclusionRef } } } : {}),
      } : undefined;
      const input = { context, verification, verifiedByUser: attested, source: { url, reference },
        ...(programme ? { programme } : { orderedTeamIds: order }) };
      if (onReview) onReview(input);
      else await runWrite(() => onSave(input));
      setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "No se pudo registrar la resolución."); }
  };
  const orderFields = (values: readonly string[], update: (ids: string[]) => void, prefix: string) => values.map((id, index) => <label key={index}>{prefix} · posición {index + 1}
    <select value={id} onChange={event => update(values.map((value, i) => i === index ? event.target.value : value))}>{options}</select></label>);
  return <div className="official-resolution-editor">
    <h4>{current ? "Registrar revisión" : "Registrar publicación oficial"}</h4>
    <label>URL oficial de la publicación<input type="url" value={url} onChange={e => setUrl(e.target.value)} /></label>
    <label>Referencia verificable (boletín, artículo o acta)<input value={reference} onChange={e => setReference(e.target.value)} /></label>
    {context.scope !== "argentina-relegation" ? <fieldset><legend>Orden publicado en el sorteo</legend>{orderFields(order, setOrder, "Sorteo")}</fieldset> : <>
      <label>Formato publicado por AFA<select value={format} onChange={e => setFormat(e.target.value as typeof format)}><option value="">Seleccionar según la publicación</option><option value="round-robin">Todos contra todos neutral (art. 111)</option><option value="afa-decision">Otro formato dispuesto expresamente por AFA</option></select></label>
      <label>Descripción y disposición AFA que respalda el formato<textarea value={description} onChange={e => setDescription(e.target.value)} /></label>
      <label>Cantidad total de partidos dispuesta<input type="number" min="1" max="1000" value={expected} onChange={e => setExpected(e.target.value)} /></label>
      <p>Agrega únicamente los cruces publicados. Los marcadores vacíos quedan pendientes. No se simulan estos partidos.</p>
      {matches.map((match, index) => {
        const edit = (patch: Partial<MatchDraft>) => setMatches(matches.map((m, i) => i === index ? { ...m, ...patch } : m));
        const score = (key: "homeGoals" | "awayGoals" | "extraHome" | "extraAway" | "penaltyHome" | "penaltyAway", label: string) => <label>{label}<input type="number" min="0" max="99" value={match[key]} onChange={e => edit({ [key]: e.target.value })} /></label>;
        return <fieldset key={match.id}><legend>Partido publicado {index + 1}</legend>
          <label>Local<select value={match.home} onChange={e => edit({ home: e.target.value })}>{options}</select></label>
          <label>Visitante<select value={match.away} onChange={e => edit({ away: e.target.value })}>{options}</select></label>
          <label>Fecha publicada<input type="date" value={match.date} onChange={e => edit({ date: e.target.value })} /></label>
          <label>Estadio publicado (opcional)<input value={match.venue} onChange={e => edit({ venue: e.target.value })} /></label>
          {format !== "round-robin" && <><label><input type="checkbox" checked={match.neutral} onChange={e => edit({ neutral: e.target.checked })} />Estadio neutral</label>
            <label>Definición publicada<select value={match.resolution} onChange={e => edit({ resolution: e.target.value as MatchDraft["resolution"] })}><option value="">Sin definición adicional</option><option value="penalties">Penales</option><option value="extra-time-then-penalties">Prórroga y penales</option></select></label></>}
          {score("homeGoals", "Goles local")}{score("awayGoals", "Goles visitante")}
          {format !== "round-robin" && match.resolution === "extra-time-then-penalties" && <>{score("extraHome", "Prórroga local")}{score("extraAway", "Prórroga visitante")}</>}
          {format !== "round-robin" && match.resolution && <>{score("penaltyHome", "Penales local")}{score("penaltyAway", "Penales visitante")}</>}
          <label>URL AFA del resultado<input type="url" value={match.sourceUrl} onChange={e => edit({ sourceUrl: e.target.value })} /></label>
          <label>Referencia del resultado<input value={match.reference} onChange={e => edit({ reference: e.target.value })} /></label>
          <button type="button" onClick={() => setMatches(matches.filter((_, i) => i !== index))}>Quitar partido de esta revisión</button>
        </fieldset>;
      })}
      <button type="button" onClick={() => setMatches([...matches, draft()])}>Agregar partido publicado</button>
      <label><input type="checkbox" checked={conclusion} onChange={e => setConclusion(e.target.checked)} />Registrar conclusión final publicada por AFA</label>
      {conclusion && <fieldset><legend>Conclusión deportiva AFA</legend>{orderFields(conclusionOrder, setConclusionOrder, "Conclusión")}
        <label>URL AFA de la conclusión<input type="url" value={conclusionUrl} onChange={e => setConclusionUrl(e.target.value)} /></label>
        <label>Referencia de la conclusión<input value={conclusionRef} onChange={e => setConclusionRef(e.target.value)} /></label></fieldset>}
    </>}
    <label>Estado de verificación<select value={verification} onChange={e => { setVerification(e.target.value as RulesVerificationStatus); setAttested(false); }}>
      <option value="pending">Pendiente de verificar</option><option value="provisional">Provisional</option><option value="verified">Verificado por el usuario</option></select></label>
    {verification === "verified" && <label><input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} />Contrasté los participantes, el resultado y el formato con las referencias oficiales indicadas</label>}
    <button type="button" disabled={!url || !reference || (verification === "verified" && !attested)} onClick={() => { if (onReview) void submit(); else setReview(true); }}>Revisar registro oficial</button>
    {error && <p role="alert">{error}</p>}
    <ConfirmationDialog open={review} title="Guardar resolución registrada" description={`${context.title}. Estado: ${verificationLabels[verification]}. Fuente: ${reference}.`}
      warning="La aplicación valida la estructura y las dependencias; la comprobación documental la realiza quien registra los datos. Las revisiones anteriores se conservan."
      confirmLabel="Guardar resolución" onConfirm={submit} onCancel={() => setReview(false)} />
  </div>;
}
