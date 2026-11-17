import { useLibraryWrite } from "../library-write-context";
import { useSessionDraft } from "../session-drafts";
import { OfficialResolutionManager } from "./official-resolution-manager";
import { useState } from "react";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import type { TournamentRepository } from "@cancha/core/application/ports/tournament-repository";
import { secondDivisionKind, NACIONAL_RULES_URL, SERIE_B_RULES_URL, LPF_RULES_URL } from "@cancha/core/domain/services/second-division-rules";
import { divisionZoneTournaments, getDivisionOutcome } from "@cancha/core/domain/services/second-division-progression";
import { getDivisionTransition } from "@cancha/core/domain/services/division-season-transition";
import { calculateStandings, getUnresolvedStandingsTieDetails } from "@cancha/core/domain/services/standings";
import { createLinkedDivisionSeasons } from "@cancha/core/application/use-cases/create-linked-division-seasons";
import { updateTeamAffiliation } from "@cancha/core/application/use-cases/update-team-affiliation";
import { StandingsTable } from "./standings-table";
import { ConfirmationDialog } from "./confirmation-dialog";

export function SecondDivisionPanel({ tournament, tournaments, repository, onChange, onCreated }: {
  tournament: Tournament; tournaments: readonly Tournament[]; repository: TournamentRepository;
  onChange: (tournament: Tournament) => void; onCreated: (created: readonly Tournament[]) => void;
}) {
  const runWrite = useLibraryWrite();

  const version = JSON.stringify([tournament.matchdays, tournament.officialResolutions]);
  function useDraft<T>(field: string, initial: T | (() => T)) {
    return useSessionDraft<T>(JSON.stringify(["transition", tournament.id, field]), initial, version);
  }
  const [upperId, setUpperId] = useDraft("upperId", "");
  const [incomingNames, setIncomingNames] = useDraft("incomingNames", "");
  const [sourceUrl, setSourceUrl] = useDraft("sourceUrl", "");
  const [clubId, setClubId] = useDraft("clubId", "");
  const [affiliation, setAffiliation] = useDraft<"direct" | "indirect">("affiliation", "direct");
  const [affiliationUrl, setAffiliationUrl] = useDraft("affiliationUrl", "");
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState(false);
  const kind = secondDivisionKind(tournament);
  if (!kind) return null;
  const outcome = getDivisionOutcome(tournament);
  const upperIdentity = kind === "argentina" ? "arg-liga-profesional" : "brasileirao-serie-a";
  const uppers = tournaments.filter(item => item.season === tournament.season
    && (item.competitionId ?? item.id.replace(/-2026$/, "")) === upperIdentity);
  const upper = uppers.find(item => item.id === upperId) ?? (uppers.length === 1 ? uppers[0] : undefined);
  const transition = upper ? getDivisionTransition(upper, tournament, tournaments) : undefined;
  const names = (ids: readonly string[], teams = tournament.teams) => ids.map(id => teams.find(team => team.id === id)?.name ?? id).join(", ") || "Pendiente";
  const incoming = incomingNames.split("\n").map(name => name.trim()).filter(Boolean);
  const proposedUpper = upper && transition ? [...upper.teams.filter(team => !transition.upperRelegated.includes(team.id)),
    ...tournament.teams.filter(team => transition.promoted.includes(team.id))].map(team => team.name) : [];
  const proposedLower = transition ? [...tournament.teams.filter(team => !transition.promoted.includes(team.id) && !transition.lowerRelegated.includes(team.id)),
    ...(upper?.teams.filter(team => transition.upperRelegated.includes(team.id)) ?? [])].map(team => team.name).concat(incoming) : [];
  const createSeasons = async () => {
    setConfirmation(false);
    if (!upper) return;
    try { await runWrite(() => {
      const created = createLinkedDivisionSeasons(upper, tournament,
        incoming.map((name, index) => ({ id: `incoming-${index}`, name })), sourceUrl, repository);
      setError(""); onCreated(created);
     }); } catch (error) { setError(error instanceof Error ? error.message : "No se pudieron crear las temporadas."); }
  };
  return <section className="second-division-panel" aria-label="Ascensos y descensos">
    {kind === "argentina" && divisionZoneTournaments(tournament).map(zone => {
      const standings = calculateStandings(zone);
      return <StandingsTable key={zone.zoneName} heading={`${zone.zoneName} · Fase regular`}
        standings={standings} unresolvedTies={getUnresolvedStandingsTieDetails(zone, standings)}
        tieBreakers={tournament.competitionRules?.tieBreakers ?? tournament.tieBreakers}
        competitionRules={tournament.competitionRules} pointsSystem={tournament.pointsSystem}
        placementRules={tournament.placementRules} placementTournament={zone}
        placementFixtures={zone.matchdays.flatMap(day => day.fixtures)}
        placementNote="Incluye interzonales. Los empates en puntos que determinan descenso requieren desempate; la posición mostrada no confirma el descenso." />;
    })}
    <div className="playoff-format-note">
      <h3>Ascensos y descensos · 2026</h3>
      <p>Ascendidos confirmados: {names(outcome.promoted)}.</p>
      <p>Descensos resueltos: {outcome.relegated.map(row => `${names([row.teamId])} → ${row.destination}`).join("; ") || "Pendientes"}.</p>
      {outcome.pending.length > 0 && <ul>{outcome.pending.map(message => <li key={message}>{message}</li>)}</ul>}
      <details><summary>Reglamento de competición</summary>
        <p>{tournament.competitionRules?.standingsNote}</p><p>{tournament.competitionRules?.placementsNote}</p>
        <a href={kind === "argentina" ? NACIONAL_RULES_URL : SERIE_B_RULES_URL} target="_blank" rel="noreferrer">Consultar reglamento oficial 2026</a>
        {kind === "argentina" && <p><a href={LPF_RULES_URL} target="_blank" rel="noreferrer">Reglamento de Primera División 2026</a>. El art. 26 remite al art. 93 del Estatuto AFA: un descenso por promedio de tres temporadas y otro por tabla anual, sin duplicar club. Los desempates requieren resolución deportiva.</p>}
      </details>
    </div>
    <OfficialResolutionManager tournament={tournament} repository={repository} onChange={onChange} />
    {kind === "argentina" && <details><summary>Registrar afiliación AFA de un club</summary>
      <p>Directa: destino Primera B. Indirecta: Federal A. Registra la fuente AFA que consultaste; no se deduce por ciudad ni nombre.</p>
      <label>Club<select value={clubId} onChange={event => setClubId(event.target.value)}><option value="">Seleccionar</option>
        {tournament.teams.map(team => <option key={team.id} value={team.id}>{team.name}{team.afaAffiliation ? " · registrada" : ""}</option>)}</select></label>
      <label>Afiliación<select value={affiliation} onChange={event => setAffiliation(event.target.value as "direct" | "indirect")}><option value="direct">Directa</option><option value="indirect">Indirecta</option></select></label>
      <label>Fuente AFA<input type="url" value={affiliationUrl} onChange={event => setAffiliationUrl(event.target.value)} /></label>
      <button type="button" disabled={!clubId || !affiliationUrl} onClick={async () => {
        try { await runWrite(() => { onChange(updateTeamAffiliation(tournament, clubId, affiliation, affiliationUrl, repository)); setError("");  }); }
        catch (error) { setError(error instanceof Error ? error.message : "No se pudo guardar la afiliación."); }
      }}>Guardar afiliación consultada</button>
    </details>}
    <details><summary>Conectar divisiones y planificar la próxima temporada</summary>
      <p>Se crean dos temporadas nuevas con los participantes actualizados. Los calendarios, zonas y reglamentos del año siguiente quedan pendientes de publicación y verificación.</p>
      <label>Primera División<select value={upper?.id ?? ""} onChange={event => setUpperId(event.target.value)}><option value="">Seleccionar torneo guardado</option>
        {uppers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {!upper && <p>Importa o selecciona la Primera División del mismo país y año.</p>}
      {transition && <><p>Ascienden a Primera: {names(transition.promoted)}. Bajan de Primera: {names(transition.upperRelegated, upper!.teams)}.</p>
        {transition.pending.length > 0 && <ul>{transition.pending.map(message => <li key={message}>{message}</li>)}</ul>}</>}
      <label>Ascendidos desde categorías inferiores (un club por línea)<textarea value={incomingNames} onChange={event => setIncomingNames(event.target.value)} /></label>
      <label>Fuente de esos ascensos<input type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} /></label>
      <button type="button" disabled={!transition || transition.pending.length > 0 || incoming.length !== transition.lowerRelegated.length || !sourceUrl}
        onClick={() => setConfirmation(true)}>Revisar nuevas temporadas</button>
    </details>
    {error && <p role="alert">{error}</p>}
    <ConfirmationDialog open={confirmation} title={`Planificar temporadas ${tournament.season! + 1}`}
      description={`Primera (${proposedUpper.length}): ${proposedUpper.join(", ")}. Segunda (${proposedLower.length}): ${proposedLower.join(", ")}.`}
      warning="Los participantes ingresados se registran como datos aportados por el usuario. Se conservan las temporadas anteriores; las nuevas quedan sin fixture oficial ni reglas verificadas."
      confirmLabel="Crear ambas temporadas" eyebrow="CAMBIO DE TEMPORADA" onConfirm={createSeasons} onCancel={() => setConfirmation(false)} />
  </section>;
}
