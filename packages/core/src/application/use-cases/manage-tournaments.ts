import { DomainError } from "../../domain/domain-error.js";
import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";

export type DuplicateResultsMode = "copy" | "reset";

function createUniqueId(repository: TournamentRepository, baseId: string): string {
  const existingIds = new Set(repository.findAll().map(({ id }) => id));
  let id = baseId;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return id;
}

export function renameTournament(
  tournament: Tournament,
  requestedName: string,
  repository: TournamentRepository,
): Tournament {
  const name = requestedName.trim();
  if (!name) throw new DomainError("Escribe el nombre del campeonato.");
  if (name.length > 80) throw new DomainError("El nombre del campeonato no puede superar los 80 caracteres.");

  const renamed = { ...tournament, name };
  if (name === tournament.name) return tournament;
  saveWithActivity(repository, renamed, createActivityEvent(tournament, {
    action: "tournament-renamed",
    entityType: "tournament",
    summary: `Se renombró "${tournament.name}" como "${name}".`,
    before: { name: tournament.name },
    after: { name },
  }));
  return renamed;
}

export function duplicateTournament(
  tournament: Tournament,
  mode: DuplicateResultsMode,
  repository: TournamentRepository,
  now: () => Date = () => new Date(),
): Tournament {
  if (mode !== "copy" && mode !== "reset") {
    throw new DomainError("Elige si la copia conserva o reinicia los resultados.");
  }
  const timestamp = now().toISOString();
  const id = createUniqueId(repository, `copy-${tournament.id}-${Date.parse(timestamp)}`);
  const name = `${tournament.name.slice(0, 72)} (copia)`;
  const duplicate: Tournament = {
    ...tournament,
    id,
    ...(tournament.competitionId ? { competitionId: id } : {}),
    name,
    createdAt: timestamp,
    ...(tournament.continentalPlans ? { continentalPlans: tournament.continentalPlans.map(plan => ({ ...JSON.parse(JSON.stringify(plan)), id: crypto.randomUUID(), requiresReview: true })) } : {}),
    ...(tournament.officialResolutions ? { officialResolutions: tournament.officialResolutions.map(record => ({
      ...JSON.parse(JSON.stringify(record)), invalidation: record.invalidation ?? {
        at: timestamp, reason: "Copia de torneo: resolución conservada como antecedente, pendiente de revisión.",
      },
    })) } : {}),
    teams: tournament.teams.map((team) => ({ ...team })),
    tieBreakers: [...tournament.tieBreakers],
    ...(tournament.pointsSystem
      ? { pointsSystem: { ...tournament.pointsSystem } }
      : {}),
    ...(tournament.competitionRules
      ? {
        competitionRules: {
          ...tournament.competitionRules,
          ...(tournament.competitionRules.points
            ? { points: { ...tournament.competitionRules.points } }
            : {}),
          ...(tournament.competitionRules.tieBreakers
            ? { tieBreakers: [...tournament.competitionRules.tieBreakers] }
            : {}),
          verification: { ...tournament.competitionRules.verification },
          ...(tournament.competitionRules.sourceUrls
            ? { sourceUrls: [...tournament.competitionRules.sourceUrls] }
            : {}),
          ...(tournament.competitionRules.conditionalPlacements
            ? {
              conditionalPlacements: tournament.competitionRules.conditionalPlacements.map(
                (condition) => ({ ...condition }),
              ),
            }
            : {}),
          ...(tournament.competitionRules.internationalQualification
            ? {
              internationalQualification: {
                ...tournament.competitionRules.internationalQualification,
                slots: tournament.competitionRules.internationalQualification.slots
                  .map((slot) => ({ ...slot })),
                ...(tournament.competitionRules.internationalQualification.cupChampions
                  ? {
                    cupChampions: tournament.competitionRules.internationalQualification.cupChampions
                      .map((champion) => ({ ...champion })),
                  }
                  : {}),
              },
            }
            : {}),
          ...(tournament.competitionRules.relegationAverage
            ? {
              relegationAverage: {
                ...tournament.competitionRules.relegationAverage,
                seasons: [...tournament.competitionRules.relegationAverage.seasons],
                ...(tournament.competitionRules.relegationAverage.tieBreakers
                  ? { tieBreakers: [...tournament.competitionRules.relegationAverage.tieBreakers] }
                  : {}),
              },
            }
            : {}),
        },
      }
      : {}),
    ...(tournament.knockoutStages
      ? { knockoutStages: tournament.knockoutStages.map((stage) => ({ ...stage })) }
      : {}),
    ...(tournament.placementRules
      ? {
        placementRules: {
          ...tournament.placementRules,
          ...(tournament.placementRules.libertadoresPlaces
            ? { libertadoresPlaces: { ...tournament.placementRules.libertadoresPlaces } }
            : {}),
          ...(tournament.placementRules.libertadoresQualifyingPlaces
            ? { libertadoresQualifyingPlaces: { ...tournament.placementRules.libertadoresQualifyingPlaces } }
            : {}),
          ...(tournament.placementRules.sudamericanaPlaces
            ? { sudamericanaPlaces: { ...tournament.placementRules.sudamericanaPlaces } }
            : {}),
          ...(tournament.placementRules.playoffPlaces
            ? { playoffPlaces: { ...tournament.placementRules.playoffPlaces } }
            : {}),
          ...(tournament.placementRules.relegationPlayoffPlaces
            ? { relegationPlayoffPlaces: { ...tournament.placementRules.relegationPlayoffPlaces } }
            : {}),
        },
      }
      : {}),
    matchdays: tournament.matchdays.map((matchday) => ({
      ...matchday,
      fixtures: matchday.fixtures.map(({
        result,
        goalScorers,
        lineups,
        substitutions,
        events,
        eventsCoverage,
        schedule,
        operationalState,
        ...fixture
      }) => ({
        ...fixture,
        ...(schedule ? { schedule: { ...schedule } } : {}),
        ...(mode === "copy" && result
          ? {
            result: {
              ...result,
              ...(result.extraTime ? { extraTime: { ...result.extraTime } } : {}),
              ...(result.penalties ? { penalties: { ...result.penalties } } : {}),
            },
          }
          : {}),
        ...(mode === "copy" && goalScorers
          ? { goalScorers: goalScorers.map((scorer) => ({ ...scorer })) }
          : {}),
        ...(mode === "copy" && lineups
          ? {
            lineups: {
              home: {
                ...lineups.home,
                starters: [...lineups.home.starters],
                substitutes: [...lineups.home.substitutes],
              },
              away: {
                ...lineups.away,
                starters: [...lineups.away.starters],
                substitutes: [...lineups.away.substitutes],
              },
            },
          }
          : {}),
        ...(mode === "copy" && substitutions
          ? { substitutions: substitutions.map((substitution) => ({ ...substitution })) }
          : {}),
        ...(mode === "copy" && events
          ? { events: events.map((event) => ({ ...event })) }
          : {}),
        ...(mode === "copy" && eventsCoverage !== undefined ? { eventsCoverage } : {}),
        ...(mode === "copy" && operationalState
          ? { operationalState: { ...operationalState } }
          : {}),
      })),
    })),
  };
  saveWithActivity(repository, duplicate, createActivityEvent(duplicate, {
    action: "tournament-duplicated",
    entityType: "tournament",
    summary: `Se duplicó "${tournament.name}" como "${duplicate.name}".`,
    before: { sourceTournamentId: tournament.id, resultsMode: mode },
    after: { tournamentId: duplicate.id, resultsMode: mode },
  }, now));
  return duplicate;
}
