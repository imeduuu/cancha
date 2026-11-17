import { useLibraryWrite } from "../library-write-context";
import { useSessionDraft, useClearSessionDrafts } from "../session-drafts";
import { useState, type FormEvent } from "react";
import { createTournament } from "@cancha/core/application/use-cases/create-tournament";
import type { PointsSystem, Tournament } from "@cancha/core/domain/entities/tournament";
import {
  configurableTieBreakerOptions,
  type TieBreaker,
} from "@cancha/core/domain/value-objects/tie-breaker";
import type { TournamentRepository } from "@cancha/core/application/ports/tournament-repository";
import {
  MAX_TEAM_NAME_LENGTH,
  MAX_TOURNAMENT_LEGS,
  MAX_TOURNAMENT_NAME_LENGTH,
  getFirstTournamentInputError,
  validateTournamentInput,
} from "@cancha/core/application/validation/validate-tournament-input";

interface SetupTournamentFormProps {
  repository: TournamentRepository;
  onCreated: (tournament: Tournament) => void;
  draftScope?: string;
}

const initialTeams = ["Colo-Colo", "Universidad de Chile", "Universidad Católica", "Cobreloa"];

export function SetupTournamentForm({
  repository,
  onCreated,
  draftScope = "setup",
}: SetupTournamentFormProps) {
  const runWrite = useLibraryWrite();

  const clearDrafts = useClearSessionDrafts();
  const [name, setName] = useSessionDraft(`${draftScope}:name`, "Campeonato Nacional");
  const [teamNames, setTeamNames] = useSessionDraft(`${draftScope}:teams`, initialTeams);
  const [legs, setLegs] = useSessionDraft(`${draftScope}:legs`, 2);
  const [tieBreakers, setTieBreakers] = useSessionDraft<TieBreaker[]>(`${draftScope}:criteria`, [
    "goalDifference",
    "goalsFor",
    "wins",
  ]);
  const [pointsSystem, setPointsSystem] = useSessionDraft<PointsSystem>(`${draftScope}:points`, {
    win: 3,
    draw: 1,
    loss: 0,
  });
  const [error, setError] = useState("");
  const validationErrors = validateTournamentInput({
    name,
    teamNames,
    legs,
    tieBreakers,
    pointsSystem,
  });
  const firstValidationError = getFirstTournamentInputError(validationErrors);

  function updateTeam(index: number, value: string) {
    setTeamNames((current) => current.map((team, teamIndex) =>
      teamIndex === index ? value : team,
    ));
  }

  function updateTieBreaker(index: number, value: TieBreaker) {
    setTieBreakers((current) => current.map((tieBreaker, tieBreakerIndex) =>
      tieBreakerIndex === index ? value : tieBreaker,
    ));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    try { await runWrite(() => {
      const tournament = createTournament(
        { name, teamNames, legs, tieBreakers, pointsSystem },
        repository,
      );
      clearDrafts(`${draftScope}:`);
      onCreated(tournament);
     }); } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo crear el campeonato.");
    }
  }

  return (
    <form className="setup-form" onSubmit={handleSubmit}>
      <label className="field">
        <span>Nombre del campeonato</span>
        <input
          value={name}
          maxLength={MAX_TOURNAMENT_NAME_LENGTH}
          aria-invalid={Boolean(validationErrors.name)}
          aria-describedby={validationErrors.name ? "tournament-name-error" : undefined}
          onChange={(event) => setName(event.target.value)}
          required
        />
        {validationErrors.name && (
          <span className="field-error" id="tournament-name-error" role="alert">
            {validationErrors.name}
          </span>
        )}
      </label>

      <div className="section-heading">
        <div>
          <span className="eyebrow">01 / PARTICIPANTES</span>
          <h2>Equipos</h2>
        </div>
        <button
          className="text-button"
          type="button"
          onClick={() => setTeamNames((current) => [...current, ""])}
        >
          + Agregar equipo
        </button>
      </div>
      <div className="team-list">
        {teamNames.map((team, index) => (
          <div className="team-row" key={index}>
            <span className="team-number">{String(index + 1).padStart(2, "0")}</span>
            <input
              aria-label={`Equipo ${index + 1}`}
              placeholder="Nombre del equipo"
              value={team}
              maxLength={MAX_TEAM_NAME_LENGTH}
              aria-invalid={Boolean(validationErrors.teamNames[index])}
              aria-describedby={validationErrors.teamNames[index] ? `team-${index}-error` : undefined}
              onChange={(event) => updateTeam(index, event.target.value)}
            />
            <button
              className="remove-button"
              type="button"
              aria-label={`Quitar equipo ${index + 1}`}
              disabled={teamNames.length <= 2}
              onClick={() => setTeamNames((current) => current.filter((_, teamIndex) => teamIndex !== index))}
            >
              ×
            </button>
            {validationErrors.teamNames[index] && (
              <span className="team-error" id={`team-${index}-error`} role="alert">
                {validationErrors.teamNames[index]}
              </span>
            )}
          </div>
        ))}
      </div>
      {validationErrors.teamCount && (
        <p className="field-error" role="alert">{validationErrors.teamCount}</p>
      )}

      <div className="section-heading rules-heading">
        <div>
          <span className="eyebrow">02 / REGLAS</span>
          <h2>Formato del torneo</h2>
        </div>
      </div>
      <label className="field">
        <span>Ruedas (veces que se enfrentan entre sí)</span>
        <input
          type="number"
          min="1"
          max={MAX_TOURNAMENT_LEGS}
          step="1"
          value={legs}
          aria-invalid={Boolean(validationErrors.legs)}
          aria-describedby={validationErrors.legs ? "legs-error" : undefined}
          onChange={(event) => setLegs(Number(event.target.value))}
          required
        />
        {validationErrors.legs && (
          <span className="field-error" id="legs-error" role="alert">
            {validationErrors.legs}
          </span>
        )}
      </label>
      <div className="tie-breakers">
        <div className="tie-breaker-title">
          <span>Orden de desempate</span>
          <span className="muted">Después de los puntos</span>
        </div>
        <fieldset className="points-system">
          <legend>Puntos por resultado</legend>
          {([
            ["win", "Victoria"],
            ["draw", "Empate"],
            ["loss", "Derrota"],
          ] as const).map(([key, label]) => (
            <label className="points-system-field" key={key}>
              <span>{label}</span>
              <input
                type="number"
                min="0"
                step="1"
                value={pointsSystem[key]}
                onChange={(event) => setPointsSystem((current) => ({
                  ...current,
                  [key]: Number(event.target.value),
                }))}
                aria-label={`Puntos por ${label.toLocaleLowerCase("es")}`}
              />
            </label>
          ))}
          {validationErrors.pointsSystem && (
            <p className="field-error" role="alert">{validationErrors.pointsSystem}</p>
          )}
        </fieldset>
        {tieBreakers.map((tieBreaker, index) => (
          <label className="tie-breaker-row" key={index}>
            <span className="tie-breaker-number">{index + 1}</span>
            <select
              aria-label={`Criterio de desempate ${index + 1}`}
              value={tieBreaker}
              onChange={(event) => updateTieBreaker(index, event.target.value as TieBreaker)}
            >
              {configurableTieBreakerOptions.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={tieBreakers.some((selected, selectedIndex) =>
                    selected === option.value && selectedIndex !== index,
                  )}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        {validationErrors.tieBreakers && (
          <p className="field-error" role="alert">{validationErrors.tieBreakers}</p>
        )}
        <button
          className="text-button add-rule"
          type="button"
          disabled={tieBreakers.length >= configurableTieBreakerOptions.length}
          onClick={() => {
            const nextOption = configurableTieBreakerOptions.find((option) =>
              !tieBreakers.includes(option.value),
            );
            if (nextOption) {
              setTieBreakers((current) => [...current, nextOption.value]);
            }
          }}
        >
          + Agregar criterio
        </button>
      </div>

      {error && <p className="error-message" role="alert">{error}</p>}
      <button className="primary-button" type="submit" disabled={Boolean(firstValidationError)}>
        Crear campeonato <span aria-hidden="true">↗</span>
      </button>
    </form>
  );
}
