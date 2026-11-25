import { useLibraryWrite } from "../library-write-context";
import { useEffect, useState } from "react";
import type { MatchRegulations, RulesVerificationStatus, Tournament } from "@cancha/core/domain/entities/tournament";
import { getMatchRegulationConflict } from "@cancha/core/domain/services/match-regulations";

interface MatchRegulationsEditorProps {
  tournament: Tournament;
  onSave: (tournament: Tournament) => void;
}

interface RegulationForm {
  verification: RulesVerificationStatus;
  sourceUrl: string;
  notes: string;
  requiredStarters: string;
  maxSubstitutes: string;
  maxSubstitutions: string;
  maxWindows: string;
  regulationMinutes: string;
  halfMinutes: string;
  extraTimeMinutes: string;
  addedTimeAllowed: "" | "yes" | "no";
  extraTimeAllowed: "" | "yes" | "no";
  penaltyShootoutAllowed: "" | "yes" | "no";
  yellowCardsForSuspension: string;
  redCardSuspensionMatches: string;
  activeRegistrationRequired: "" | "yes" | "no";
  minimumAge: string;
  maximumAge: string;
}

function regulationForm(tournament: Tournament): RegulationForm {
  const regulations = tournament.matchRegulations;
  const yesNo = (value: boolean | undefined): "" | "yes" | "no" =>
    value === undefined ? "" : value ? "yes" : "no";
  return {
    verification: regulations?.verification ?? "pending",
    sourceUrl: regulations?.sourceUrl ?? "",
    notes: regulations?.notes ?? "",
    requiredStarters: regulations?.lineup?.requiredStarters?.toString() ?? "",
    maxSubstitutes: regulations?.lineup?.maxSubstitutes?.toString() ?? "",
    maxSubstitutions: regulations?.substitutions?.maxCount?.toString() ?? "",
    maxWindows: regulations?.substitutions?.maxWindows?.toString() ?? "",
    regulationMinutes: regulations?.timing?.regulationMinutes?.toString() ?? "",
    halfMinutes: regulations?.timing?.halfMinutes?.toString() ?? "",
    extraTimeMinutes: regulations?.timing?.extraTimeMinutes?.toString() ?? "",
    addedTimeAllowed: yesNo(regulations?.timing?.addedTimeAllowed),
    extraTimeAllowed: yesNo(regulations?.timing?.extraTimeAllowed),
    penaltyShootoutAllowed: yesNo(regulations?.timing?.penaltyShootoutAllowed),
    yellowCardsForSuspension: regulations?.cards?.yellowCardsForSuspension?.toString() ?? "",
    redCardSuspensionMatches: regulations?.cards?.redCardSuspensionMatches?.toString() ?? "",
    activeRegistrationRequired: yesNo(regulations?.eligibility?.activeRegistrationRequired),
    minimumAge: regulations?.eligibility?.minimumAge?.toString() ?? "",
    maximumAge: regulations?.eligibility?.maximumAge?.toString() ?? "",
  };
}

export function MatchRegulationsEditor({ tournament, onSave }: MatchRegulationsEditorProps) {
  const runWrite = useLibraryWrite();

  const [form, setForm] = useState(() => regulationForm(tournament));
  const [error, setError] = useState("");
  const season = tournament.season ?? tournament.competitionRules?.season;

  useEffect(() => {
    setForm(regulationForm(tournament));
    setError("");
  }, [tournament]);

  function update<Key extends keyof RegulationForm>(key: Key, value: RegulationForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (season === undefined) {
      setError("El torneo no tiene una temporada identificada; no se puede asociar un reglamento sin inventarla.");
      return;
    }
    const regulation: MatchRegulations = {
      schemaVersion: 1,
      season,
      verification: form.verification,
      ...(form.sourceUrl.trim() ? { sourceUrl: form.sourceUrl.trim() } : {}),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      ...section("lineup", {
        requiredStarters: form.requiredStarters,
        maxSubstitutes: form.maxSubstitutes,
      }),
      ...section("substitutions", {
        maxCount: form.maxSubstitutions,
        maxWindows: form.maxWindows,
      }),
      ...section("timing", {
        regulationMinutes: form.regulationMinutes,
        halfMinutes: form.halfMinutes,
        extraTimeMinutes: form.extraTimeMinutes,
        addedTimeAllowed: form.addedTimeAllowed,
        extraTimeAllowed: form.extraTimeAllowed,
        penaltyShootoutAllowed: form.penaltyShootoutAllowed,
      }),
      ...section("cards", {
        yellowCardsForSuspension: form.yellowCardsForSuspension,
        redCardSuspensionMatches: form.redCardSuspensionMatches,
      }),
      ...section("eligibility", {
        activeRegistrationRequired: form.activeRegistrationRequired,
        minimumAge: form.minimumAge,
        maximumAge: form.maximumAge,
      }),
    };

    const updated: Tournament = { ...tournament, matchRegulations: regulation };
    const existingDetails = tournament.matchdays.some(({ fixtures }) => fixtures.some((fixture) =>
      fixture.result !== undefined
      || fixture.lineups !== undefined
      || (fixture.substitutions?.length ?? 0) > 0
      || (fixture.events?.length ?? 0) > 0));
    const validationRulesChanged = JSON.stringify(getValidationRules(tournament.matchRegulations))
      !== JSON.stringify(getValidationRules(regulation));
    if (existingDetails && validationRulesChanged && !window.confirm(
      "Este cambio puede afectar la validación de partidos existentes. Se conservarán todas las alineaciones, sustituciones y eventos. ¿Continuar?",
    )) return;
    try { await runWrite(() => {
      onSave(updated);
      setError("");
     }); } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el reglamento.");
    }
  }

  const conflict = getMatchRegulationConflict(tournament);
  const hasAnyRule = tournament.matchRegulations !== undefined;

  return (
    <details id="match-regulations-editor" className="match-regulations-editor">
      <summary>Reglamento deportivo · {tournament.matchRegulations?.verification ?? "sin configurar"}</summary>
      {season === undefined
        ? <p className="muted">Se necesita una temporada identificada para asociar un reglamento.</p>
        : <p className="muted">Temporada {season}. Los campos vacíos permanecen sin configurar y no se aplican.</p>}
      {conflict && <p className="history-warning" role="alert">{conflict}</p>}
      <div className="regulations-form">
        <label><span>Verificación</span>
          <select aria-label="Estado de verificación del reglamento" value={form.verification}
            onChange={(event) => update("verification", event.target.value as RulesVerificationStatus)}>
            <option value="pending">Pendiente</option><option value="provisional">Provisional</option>
            <option value="verified">Verificado</option>
          </select>
        </label>
        <TextField label="Titulares requeridos" value={form.requiredStarters}
          onChange={(value) => update("requiredStarters", value)} min={1} max={30} />
        <TextField label="Máximo de suplentes" value={form.maxSubstitutes}
          onChange={(value) => update("maxSubstitutes", value)} min={0} max={30} />
        <TextField label="Máximo de sustituciones" value={form.maxSubstitutions}
          onChange={(value) => update("maxSubstitutions", value)} min={0} max={30} />
        <TextField label="Máximo de ventanas" value={form.maxWindows}
          onChange={(value) => update("maxWindows", value)} min={0} max={30} />
        <TextField label="Duración reglamentaria (min)" value={form.regulationMinutes}
          onChange={(value) => update("regulationMinutes", value)} min={1} max={180} />
        <TextField label="Duración por tiempo (min)" value={form.halfMinutes}
          onChange={(value) => update("halfMinutes", value)} min={1} max={90} />
        <TextField label="Duración prórroga (min)" value={form.extraTimeMinutes}
          onChange={(value) => update("extraTimeMinutes", value)} min={0} max={60} />
        <BooleanField label="Tiempo añadido permitido" value={form.addedTimeAllowed}
          onChange={(value) => update("addedTimeAllowed", value)} />
        <BooleanField label="Prórroga permitida" value={form.extraTimeAllowed}
          onChange={(value) => update("extraTimeAllowed", value)} />
        <BooleanField label="Definición por penales" value={form.penaltyShootoutAllowed}
          onChange={(value) => update("penaltyShootoutAllowed", value)} />
        <TextField label="Amarillas para suspensión" value={form.yellowCardsForSuspension}
          onChange={(value) => update("yellowCardsForSuspension", value)} min={1} max={30} />
        <TextField label="Partidos de suspensión por roja" value={form.redCardSuspensionMatches}
          onChange={(value) => update("redCardSuspensionMatches", value)} min={0} max={30} />
        <BooleanField label="Exige inscripción activa" value={form.activeRegistrationRequired}
          onChange={(value) => update("activeRegistrationRequired", value)} />
        <TextField label="Edad mínima" value={form.minimumAge}
          onChange={(value) => update("minimumAge", value)} min={0} max={100} />
        <TextField label="Edad máxima" value={form.maximumAge}
          onChange={(value) => update("maximumAge", value)} min={0} max={100} />
        <label className="regulations-wide-field"><span>Fuente (URL)</span>
          <input aria-label="Fuente del reglamento" value={form.sourceUrl}
            onChange={(event) => update("sourceUrl", event.target.value)} />
        </label>
        <label className="regulations-wide-field"><span>Observaciones</span>
          <textarea aria-label="Observaciones del reglamento" value={form.notes}
            onChange={(event) => update("notes", event.target.value)} rows={2} />
        </label>
      </div>
      <p className="muted">
        {hasAnyRule
          ? "Los campos no configurados no se interpretan como cero. Las infracciones se advierten y los datos se conservan."
          : "Sin reglamento se mantiene el comportamiento actual; solo se aplican las validaciones estructurales del simulador."}
      </p>
      {error && <p className="error-message" role="alert">{error}</p>}
      <button type="button" className="small-action" disabled={season === undefined} onClick={save}>
        Guardar reglamento
      </button>
    </details>
  );
}

function getValidationRules(regulations: MatchRegulations | undefined) {
  if (!regulations) return undefined;
  return {
    verification: regulations.verification,
    lineup: regulations.lineup,
    substitutions: regulations.substitutions,
    timing: regulations.timing,
    cards: regulations.cards,
    eligibility: regulations.eligibility,
  };
}

function section(
  name: "lineup" | "substitutions" | "timing" | "cards" | "eligibility",
  fields: Record<string, string>,
): Pick<MatchRegulations, typeof name> | Record<string, never> {
  const parsed: Record<string, number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === "") continue;
    parsed[key] = value === "yes" ? true : value === "no" ? false : Number(value);
  }
  return Object.keys(parsed).length > 0 ? { [name]: parsed } : {};
}

function TextField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
}) {
  return (
    <label><span>{label}</span><input aria-label={label} type="number" min={min} max={max}
      step="1" value={value} onChange={(event) => onChange(event.target.value)} /></label>
  );
}

function BooleanField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: "" | "yes" | "no";
  onChange: (value: "" | "yes" | "no") => void;
}) {
  return (
    <label><span>{label}</span><select aria-label={label} value={value}
      onChange={(event) => onChange(event.target.value as "" | "yes" | "no")}>
      <option value="">Sin configurar</option><option value="yes">Sí</option><option value="no">No</option>
    </select></label>
  );
}
