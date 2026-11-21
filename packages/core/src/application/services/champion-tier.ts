import type { Tournament } from "../../domain/entities/tournament";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import { hasLocalSeasonActivity } from "./competition-center";

/**
 * verified: annual rules verified and coverage accredited.
 * calculated: imported/provider data whose sporting outcome is complete but whose rules are pending.
 * simulated: local scenario (simulated, edited or copied); never an official result.
 */
export type ChampionTier = "verified" | "calculated" | "simulated";
export const championTierLabels: Readonly<Record<ChampionTier, string>> = {
  verified: "Reglamento verificado",
  calculated: "Calculado · reglamento pendiente",
  simulated: "Simulado · no oficial",
};
export const championTierTitles: Readonly<Record<ChampionTier, string>> = {
  verified: "Campeón",
  calculated: "Campeón calculado",
  simulated: "Campeón (simulado)",
};

/** Same "local" scenario used by provenance labels (sourceScenario). */
export function isLocalScenario(t: Tournament, activity: readonly ActivityEvent[]): boolean {
  return !!t.seasonPreparation || !!t.continentalPlans?.some(plan => plan.mode === "incorporated" || plan.requiresReview)
    || hasLocalSeasonActivity(t.id, activity);
}

export function unverifiedTier(t: Tournament, activity: readonly ActivityEvent[]): Exclude<ChampionTier, "verified"> {
  return isLocalScenario(t, activity) ? "simulated" : "calculated";
}
