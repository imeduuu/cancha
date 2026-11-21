import { useMemo } from "react";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import {
  championTierLabels,
  championTierTitles,
  seasonHonours,
  type ChampionTier,
  type Honour,
} from "@cancha/core/application/services/club-honours";

const tierNotes: Readonly<Record<ChampionTier, string>> = {
  verified: "Calculado con el reglamento anual verificado. No sustituye la certificación de la organización.",
  calculated: "Resultado deportivo de los datos importados; el reglamento de la temporada sigue pendiente de verificar.",
  simulated: "Escenario local, simulado o editado. No es un resultado oficial.",
};

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]!.toLocaleUpperCase("es")).join("");
}

function titleOf(award: Honour, tier: ChampionTier): string {
  if (award.label === "Campeón") return championTierTitles[tier];
  return tier === "simulated" ? `${award.label} (simulado)` : tier === "calculated" ? `${award.label} · calculado` : award.label;
}

/** Shown once a league, a final or an Argentine half final is decided; never hides its accreditation tier. */
export function ChampionCards({ tournament, activity = [], showRunnerUp = true }: {
  tournament: Tournament; activity?: readonly ActivityEvent[];
  /** Off where the runner-up is already listed next to the card (season closure). */
  showRunnerUp?: boolean;
}) {
  const honours = useMemo(() => seasonHonours(tournament, activity), [tournament, activity]);
  const champions = honours.awards.filter(award => award.label === "Campeón" || award.label.startsWith("Campeón del "));
  if (!champions.length) return null;
  const runnerUp = showRunnerUp ? honours.awards.find(award => award.label === "Subcampeón") : undefined;
  const name = (teamId: string) => tournament.teams.find(team => team.id === teamId)?.name ?? "Equipo desconocido";
  return <div className="champion-cards">
    {champions.map(award => {
      const tier = award.tier ?? honours.tier ?? "verified", club = name(award.teamId);
      return <section key={`${award.label}-${award.teamId}`} className={`champion-card champion-card-${tier}`}
        aria-label={`${titleOf(award, tier)}: ${club}`}>
        <span className="champion-card-emblem" aria-hidden="true">{initials(club)}</span>
        <div className="champion-card-body">
          <p className="eyebrow">{tournament.name} · {tournament.season ?? "Sin año"}</p>
          <h3 className="champion-card-title">{titleOf(award, tier)}</h3>
          <p className="champion-card-club">{club}</p>
          {award.label === "Campeón" && runnerUp && <p className="champion-card-meta">Subcampeón: {name(runnerUp.teamId)}</p>}
          <p className="champion-card-note">{tierNotes[tier]}</p>
        </div>
        <span className={`champion-card-badge champion-card-badge-${tier}`}>{championTierLabels[tier]}</span>
      </section>;
    })}
  </div>;
}
