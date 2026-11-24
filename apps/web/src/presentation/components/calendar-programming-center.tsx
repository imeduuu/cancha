import { useMemo, useState } from "react";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import {
  getCalendarProgrammingBlockers,
  previewGeneratedCalendar,
  previewManualCalendar,
  type CalendarProgrammingProposal,
  type ManualMatchdayInput,
} from "@cancha/core/application/use-cases/program-season-calendar";
import { validateTournamentIntegrity } from "@cancha/core/domain/services/tournament-integrity";
import { userFacingLabels } from "@cancha/core/application/services/user-facing-labels";

interface Props {
  readonly tournaments: readonly Tournament[];
  readonly universeId: string | null;
  readonly initialTournamentId?: string;
  readonly onConfirm: (proposal: CalendarProgrammingProposal, tournament: Tournament) => Tournament | Promise<Tournament>;
  readonly onOpenCalendar?: (tournament: Tournament) => void;
  readonly onBack?: () => void;
}

interface ManualFixtureDraft {
  readonly number: string;
  readonly leg: string;
  readonly phaseName: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
}

const emptyFixture = (): ManualFixtureDraft => ({
  number: "1",
  leg: "1",
  phaseName: "",
  homeTeamId: "",
  awayTeamId: "",
});

export function CalendarProgrammingCenter({
  tournaments,
  universeId,
  initialTournamentId,
  onConfirm,
  onOpenCalendar,
  onBack,
}: Props) {
  const [selectedId, setSelectedId] = useState(initialTournamentId ?? tournaments[0]?.id ?? "");
  const tournament = tournaments.find(({ id }) => id === selectedId);
  const [legs, setLegs] = useState("1");
  const [manualDraft, setManualDraft] = useState<ManualFixtureDraft[]>([emptyFixture()]);
  const [proposal, setProposal] = useState<CalendarProgrammingProposal>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState<Tournament>();
  const [saving, setSaving] = useState(false);
  const blockers = useMemo(
    () => tournament ? getCalendarProgrammingBlockers(tournament, tournaments) : [],
    [tournament, tournaments],
  );
  const integrityWarnings = useMemo(
    () => tournament ? validateTournamentIntegrity(tournament) : [],
    [tournament],
  );
  const fixtureCount = tournament?.matchdays.reduce((count, day) => count + day.fixtures.length, 0) ?? 0;
  const playedCount = tournament?.matchdays.reduce((count, day) =>
    count + day.fixtures.filter((fixture) => fixture.result).length, 0) ?? 0;
  const isStale = Boolean(proposal && tournament && proposal.before !== JSON.stringify(tournament));

  function resetProposal() {
    setProposal(undefined);
    setConfirmed(undefined);
    setError("");
    setMessage("");
  }

  function createGeneratedPreview() {
    if (!tournament) return;
    try {
      setProposal(previewGeneratedCalendar(tournament, universeId, Number(legs), undefined, tournaments));
      setError("");
      setMessage("");
    } catch (reason) {
      setProposal(undefined);
      setError(reason instanceof Error ? reason.message : "No se pudo generar la propuesta.");
    }
  }

  function createManualPreview() {
    if (!tournament) return;
    try {
      const groups = new Map<string, ManualMatchdayInput>();
      for (const fixture of manualDraft) {
        const number = Number(fixture.number);
        const leg = Number(fixture.leg);
        const key = `${leg}|${fixture.phaseName.trim()}|${number}`;
        const day = groups.get(key) ?? {
          number,
          leg,
          ...(fixture.phaseName.trim() ? { phaseName: fixture.phaseName.trim() } : {}),
          fixtures: [],
        };
        groups.set(key, {
          ...day,
          fixtures: [...day.fixtures, {
            id: "",
            homeTeamId: fixture.homeTeamId,
            awayTeamId: fixture.awayTeamId,
          }],
        });
      }
      setProposal(previewManualCalendar(tournament, universeId, [...groups.values()], undefined, tournaments));
      setError("");
      setMessage("");
    } catch (reason) {
      setProposal(undefined);
      setError(reason instanceof Error ? reason.message : "No se pudo revisar la programación manual.");
    }
  }

  async function confirm() {
    if (!proposal || !tournament || isStale) return;
    setSaving(true);
    try {
      const saved = await onConfirm(proposal, tournament);
      setProposal(undefined);
      setConfirmed(saved);
      setMessage("Calendario guardado. La simulación y el registro de resultados siguen siendo manuales.");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo confirmar la programación.");
    } finally {
      setSaving(false);
    }
  }

  function updateManual(index: number, patch: Partial<ManualFixtureDraft>) {
    setManualDraft((current) => current.map((fixture, itemIndex) =>
      itemIndex === index ? { ...fixture, ...patch } : fixture));
    resetProposal();
  }

  const proposedDays = proposal?.proposed.matchdays ?? [];
  const proposedFixtureCount = proposedDays.reduce((count, day) => count + day.fixtures.length, 0);
  const automaticGenerationBlocker = tournament?.competitionType === "cup"
    ? "Las copas requieren reglas de admisión y etapas específicas."
    : tournament?.teams.some((team) => team.groupName)
      ? "El generador general de todos contra todos no conserva los grupos existentes."
      : undefined;

  return (
    <section className="calendar-programming-center" aria-label="Centro de programación de calendarios">
      <header className="match-calendar-heading">
        <div>
          <span className="eyebrow">PROGRAMACIÓN LOCAL · UNIVERSO ACTIVO</span>
          <h3>Centro de programación de calendarios</h3>
          <p>Consultar y generar vistas previas no modifica temporadas. La simulación de partidos permanece exclusivamente manual.</p>
        </div>
        {onBack && <button className="small-action" type="button" onClick={onBack}>Volver</button>}
      </header>

      <label>Temporada del universo activo
        <select value={selectedId} onChange={(event) => {
          setSelectedId(event.target.value);
          setLegs("1");
          setManualDraft([emptyFixture()]);
          setProposal(undefined);
          setConfirmed(undefined);
          setMessage("");
          setError("");
        }}>
          <option value="">Selecciona una temporada</option>
          {tournaments.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.season ?? "sin año"} · {item.id}</option>)}
        </select>
      </label>

      {!tournament ? <p role="status">No hay una temporada disponible en el universo activo.</p> : <>
        <dl className="calendar-programming-summary">
          <div><dt>Participantes</dt><dd>{tournament.teams.length}</dd></div>
          <div><dt>Formato registrado</dt><dd>{userFacingLabels.competitionFormat(tournament.format)}</dd></div>
          <div><dt>Reglamento</dt><dd>{tournament.competitionRules?.verification.standings ?? "Pendiente"} · {tournament.competitionRules?.verification.placements ?? "Pendiente"}</dd></div>
          <div><dt>Etapas configuradas</dt><dd>{tournament.knockoutStages?.map(({ name }) => name).join(", ") || "No registradas"}</dd></div>
          <div><dt>Jornadas / fases</dt><dd>{tournament.matchdays.length}</dd></div>
          <div><dt>Partidos actuales</dt><dd>{fixtureCount} · {playedCount} disputados</dd></div>
          <div><dt>Estado de programación</dt><dd>{fixtureCount === 0
            ? "Sin calendario"
            : integrityWarnings.length > 0
              ? "Calendario con advertencias"
              : playedCount === fixtureCount
                ? "Todos con resultado"
                : "Partidos registrados y pendientes"}</dd></div>
          <div><dt>Procedencia</dt><dd>{provenanceLabel(tournament.calendarProvenance, tournament.sourceUrl)}</dd></div>
        </dl>

        {blockers.length > 0 && <div role="status"><strong>Advertencias y bloqueos</strong><ul>{blockers.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        {integrityWarnings.length > 0 && <div role="alert"><strong>Advertencias de integridad</strong><ul>{integrityWarnings.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul></div>}
        {fixtureCount > 0 && <p role="status">
          El calendario existente se conserva. {playedCount > 0
            ? "Hay resultados registrados: se bloquean los reemplazos y solo pueden agregarse encuentros compatibles."
            : "No hay resultados disputados; tampoco se reemplazará el calendario existente."}
        </p>}

        <section aria-label="Generar propuesta local">
          <h4>Generar propuesta local</h4>
          <p>Únicamente se reutiliza el generador de todos contra todos existente. Confirmarlo registrará ese formato como local; no es una declaración oficial. No se crean formatos por grupos ni etapas oficiales.</p>
          {automaticGenerationBlocker && <p role="status">{automaticGenerationBlocker} La generación automática está bloqueada.</p>}
          <label>Ruedas propuestas
            <input type="number" min="1" max="20" value={legs} onChange={(event) => {
              setLegs(event.target.value);
              resetProposal();
            }}/>
          </label>
          <button type="button" className="small-action" disabled={blockers.length > 0 || Boolean(automaticGenerationBlocker)} onClick={createGeneratedPreview}>
            Generar vista previa local
          </button>
        </section>

        <section aria-label="Registrar partidos manualmente">
          <h4>Programación manual</h4>
          <p>Agrega jornadas sin sustituir el calendario actual. La validación rechaza clubes desconocidos, descansos duplicados y cruces incompatibles.</p>
          {manualDraft.map((fixture, index) => <fieldset key={index}>
            <legend>Encuentro {index + 1}</legend>
            <label>Jornada<input type="number" min="1" value={fixture.number} onChange={(event) => updateManual(index, { number: event.target.value })}/></label>
            <label>Rueda/fase<input type="number" min="1" max={tournament.legs} value={fixture.leg} onChange={(event) => updateManual(index, { leg: event.target.value })}/></label>
            {tournament.format === "staged" && <label>Etapa registrada
              <select value={fixture.phaseName} onChange={(event) => updateManual(index, { phaseName: event.target.value })}>
                <option value="">Selecciona una etapa</option>
                {(tournament.knockoutStages ?? []).flatMap((stage) => stage.legs === 2
                  ? [`${stage.name} · Ida`, `${stage.name} · Vuelta`]
                  : [stage.name]).map((phase) => <option key={phase} value={phase}>{phase}</option>)}
              </select>
            </label>}
            <label>Local<select value={fixture.homeTeamId} onChange={(event) => updateManual(index, { homeTeamId: event.target.value })}><option value="">Selecciona</option>{tournament.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
            <label>Visitante<select value={fixture.awayTeamId} onChange={(event) => updateManual(index, { awayTeamId: event.target.value })}><option value="">Selecciona</option>{tournament.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
          </fieldset>)}
          <button type="button" className="small-action" onClick={() => {
            setManualDraft((current) => [...current, emptyFixture()]);
            resetProposal();
          }}>Agregar encuentro a la propuesta</button>
          <button type="button" className="small-action" disabled={blockers.length > 0} onClick={createManualPreview}>
            Revisar propuesta manual
          </button>
        </section>

        {proposal && <section aria-label="Vista previa del calendario propuesto">
          <h4>Vista previa · {proposal.kind === "local-generated" ? "generación local" : "registro manual"}</h4>
          <p>{proposal.proposed.format} · {proposal.proposed.legs} ruedas · {proposal.proposed.matchdays.length} jornadas · {proposedFixtureCount} partidos</p>
          <ul>{proposal.proposed.matchdays.slice(-proposedDays.length).map((day, index) => <li key={`${day.leg}-${day.phaseName ?? ""}-${day.number}-${index}`}>
            {day.phaseName ? `${day.phaseName} · ` : ""}Jornada {day.number} · rueda {day.leg}
            <ul>{day.fixtures.map((fixture) => <li key={fixture.id}>
              {teamName(tournament, fixture.homeTeamId)} (local) vs. {teamName(tournament, fixture.awayTeamId)} (visitante)
            </li>)}
            {proposal.kind === "local-generated" && restTeams(tournament, day.fixtures).map((name) => <li key={name}>{name}: descanso</li>)}</ul>
          </li>)}</ul>
          <ul>{proposal.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          {isStale && <p role="alert">La temporada cambió desde la vista previa. Genera otra antes de confirmar.</p>}
          <button type="button" className="small-action" disabled={isStale || saving} onClick={() => void confirm()}>{saving ? "Guardando…" : "Confirmar y guardar calendario"}</button>
        </section>}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {confirmed && onOpenCalendar && <button type="button" className="small-action" onClick={() => onOpenCalendar(confirmed)}>Abrir calendario</button>}
      </>}
    </section>
  );
}

function teamName(tournament: Tournament, id: string): string {
  return tournament.teams.find((team) => team.id === id)?.name ?? `Club inexistente (${id})`;
}

function restTeams(tournament: Tournament, fixtures: readonly { readonly homeTeamId: string; readonly awayTeamId: string }[]): string[] {
  const playing = new Set(fixtures.flatMap(({ homeTeamId, awayTeamId }) => [homeTeamId, awayTeamId]));
  return tournament.teams.filter(({ id }) => !playing.has(id)).map(({ name }) => name);
}

function provenanceLabel(value: Tournament["calendarProvenance"], sourceUrl?: string): string {
  if (value === "local-generated") return "Local generado por el usuario";
  if (value === "manual") return "Local registrado manualmente";
  if (value === "official-import" || sourceUrl) return "Importado de fuente oficial";
  return "Sin calendario";
}
