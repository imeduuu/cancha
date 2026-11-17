import type {
  CompetitionRulesConfiguration,
  Tournament,
} from "../entities/tournament";
import { getCompletedStageWinners } from "./official-cup-progression";
import { isValidFixtureResult } from "./match-result-validation";
import { getUnresolvedStandingsTieGroups } from "./standings";
import type { TeamStanding } from "./standings";

export type QualificationStatus = "confirmed" | "provisional" | "pending";

export interface InternationalQualification {
  readonly originTournamentId?: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly destination: string;
  readonly status: QualificationStatus;
  readonly source: string;
}

export interface InternationalQualificationResult {
  readonly qualifications: readonly InternationalQualification[];
  readonly pendingReasons: readonly string[];
}

function getChampion(tournament: Tournament): string | undefined {
  const finalStage = [...(tournament.knockoutStages ?? [])].reverse().find((stage) =>
    stage.name.toLocaleLowerCase("es").endsWith("final"),
  );
  if (!finalStage) return undefined;
  const winners = getCompletedStageWinners(tournament.matchdays, finalStage);
  return winners?.length === 1 ? winners[0] : undefined;
}

function seasonOf(tournament: Tournament): number | undefined {
  if (tournament.season !== undefined
    && tournament.competitionRules?.season !== undefined
    && tournament.season !== tournament.competitionRules.season) return undefined;
  return tournament.season ?? tournament.competitionRules?.season;
}

export function calculateInternationalQualifications(
  standings: readonly TeamStanding[],
  league: Tournament,
  availableTournaments: readonly Tournament[],
  rules: CompetitionRulesConfiguration["internationalQualification"],
  placementVerification: CompetitionRulesConfiguration["verification"]["placements"],
): InternationalQualificationResult {
  if (!rules) return { qualifications: [], pendingReasons: [] };

  const pendingReasons: string[] = [];
  const leagueFixtures = league.matchdays.flatMap(({ fixtures }) => fixtures);
  const coverageKnownIncomplete = league.importCoverage === "partial" || league.importCoverage === "unknown";
  const standingsVerification = league.competitionRules?.verification.standings;
  const leagueComplete = !coverageKnownIncomplete && leagueFixtures.length > 0
    && league.matchdays.every((matchday) => matchday.fixtures.every((fixture) =>
      isValidFixtureResult(league, matchday, fixture),
    ));
  const ruleStatus: QualificationStatus = rules.verification === "verified"
    && placementVerification === "verified"
    && (standingsVerification === undefined || standingsVerification === "verified")
    ? "confirmed"
    : rules.verification === "pending" || placementVerification === "pending" || standingsVerification === "pending"
      ? "pending"
      : "provisional";
  const statusForCurrentTable: QualificationStatus = ruleStatus === "confirmed" && leagueComplete
    ? "confirmed"
    : ruleStatus === "pending"
      ? "pending"
      : "provisional";

  if (coverageKnownIncomplete) pendingReasons.push("La cobertura del calendario es parcial o no está acreditada como completa.");
  if (standingsVerification && standingsVerification !== "verified") pendingReasons.push("Los criterios de la tabla no están verificados.");
  if (!leagueComplete) {
    pendingReasons.push(leagueFixtures.length === 0
      ? "La liga todavía no tiene partidos suficientes para determinar plazas."
      : "La liga todavía tiene partidos sin resultado.");
  }
  if (ruleStatus !== "confirmed") {
    pendingReasons.push("La regla de clasificación internacional no está verificada.");
  }

  const qualifications: InternationalQualification[] = [];
  const assignedByDestination = new Map<string, Set<string>>();
  const assignedTeamIds = new Set<string>();
  const teamNames = new Map(standings.map(({ teamId, teamName }) => [teamId, teamName]));
  const assignedSlots = new Set<string>();
  const ambiguousSlots = new Map<string, { destination: string; teams: string[]; positions: number[] }>();
  const unresolvedTieGroups: {
    teamIds: Set<string>;
    teams: string[];
    positions: number[];
  }[] = [];
  for (const tiedTeams of getUnresolvedStandingsTieGroups(league, standings)) {
    const teamIds = new Set(tiedTeams.map(({ teamId }) => teamId));
    const positions = standings.flatMap(({ teamId }, index) =>
      teamIds.has(teamId) ? [index + 1] : [],
    );
    if (positions.length !== tiedTeams.length || positions.length < 2) continue;
    const tieGroup = {
      teamIds,
      teams: tiedTeams.map(({ teamName }) => teamName),
      positions,
    };
    unresolvedTieGroups.push(tieGroup);
    const firstPosition = Math.min(...positions);
    const lastPosition = Math.max(...positions);
    const slotsByDestination = new Map<string, Set<number>>();
    for (const slot of rules.slots) {
      if (slot.position < firstPosition || slot.position > lastPosition) continue;
      const destinationSlots = slotsByDestination.get(slot.destination) ?? new Set<number>();
      destinationSlots.add(slot.position);
      slotsByDestination.set(slot.destination, destinationSlots);
    }
    for (const [destination, destinationSlots] of slotsByDestination) {
      if (destinationSlots.size >= tiedTeams.length) continue;
      const ambiguity = {
        destination,
        ...tieGroup,
      };
      for (const slot of rules.slots) {
        if (slot.destination !== destination || !destinationSlots.has(slot.position)) continue;
        ambiguousSlots.set(`${slot.destination}:${slot.position}`, ambiguity);
      }
    }
  }
  for (const ambiguity of new Set(ambiguousSlots.values())) {
    pendingReasons.push(
      `Un empate irresuelto entre ${ambiguity.teams.join(", ")} afecta el cupo de ${ambiguity.destination} en las posiciones ${ambiguity.positions.join(", ")}.`,
    );
  }

  for (const cupRule of rules.cupChampions ?? []) {
    const cup = availableTournaments.find(({ id }) => id === cupRule.sourceTournamentId);
    if (!cup) {
      pendingReasons.push(`No está disponible la copa ${cupRule.sourceTournamentId}.`);
      continue;
    }
    const leagueSeason = seasonOf(league);
    const cupSeason = seasonOf(cup);
    if (leagueSeason === undefined || cupSeason === undefined) {
      pendingReasons.push(
        `No se puede verificar la temporada de la copa ${cup.name} o de la liga ${league.name}; su cupo queda pendiente.`,
      );
      continue;
    }
    if (cupSeason !== leagueSeason) {
      pendingReasons.push(
        `La copa ${cup.name} corresponde a la temporada ${cupSeason} y la liga ${league.name} a la temporada ${leagueSeason}; su cupo queda pendiente.`,
      );
      continue;
    }
    const champion = getChampion(cup);
    if (!champion) {
      pendingReasons.push(
        cup
          ? `Falta resolver el campeón de ${cup.name}.`
          : `No está disponible la copa ${cupRule.sourceTournamentId}.`,
      );
      continue;
    }
    const knownName = teamNames.get(champion)
      ?? availableTournaments.flatMap(({ teams }) => teams).find(({ id }) => id === champion)?.name;
    const assigned = assignedByDestination.get(cupRule.destination) ?? new Set<string>();
    if (assignedTeamIds.has(champion)) {
      pendingReasons.push(
        `El mismo equipo fue campeón de más de una copa configurada; falta una regla para resolver sus cupos.`,
      );
      continue;
    }
    assigned.add(champion);
    assignedTeamIds.add(champion);
    assignedByDestination.set(cupRule.destination, assigned);
    qualifications.push({
      originTournamentId: cup.id,
      teamId: champion,
      teamName: knownName ?? champion,
      destination: cupRule.destination,
      status: ruleStatus,
      source: cup.name,
    });
    if (rules.reallocation !== "next-eligible-position") {
      const matchingSlot = rules.slots.find((slot) =>
        slot.destination === cupRule.destination
        && standings[slot.position - 1]?.teamId === champion,
      );
      if (matchingSlot) {
        const key = `${matchingSlot.destination}:${matchingSlot.position}`;
        if (!ambiguousSlots.has(key)) assignedSlots.add(key);
      }
    }
  }

  const unresolvedCupDestinations = new Set<string>();
  for (const cupRule of rules.cupChampions ?? []) {
    const cup = availableTournaments.find(({ id }) => id === cupRule.sourceTournamentId);
    const leagueSeason = seasonOf(league);
    const cupSeason = cup && seasonOf(cup);
    if (!cup || leagueSeason === undefined || cupSeason === undefined
      || cupSeason !== leagueSeason || !getChampion(cup)) {
      unresolvedCupDestinations.add(cupRule.destination);
    }
  }

  const configuredSlots = [...rules.slots].sort((first, second) =>
    first.position - second.position,
  );
  const nextPositionByDestination = new Map<string, number>();
  for (const slot of configuredSlots) {
    const key = `${slot.destination}:${slot.position}`;
    if (ambiguousSlots.has(key)) continue;
    if (assignedSlots.has(key)) continue;
    const assigned = assignedByDestination.get(slot.destination) ?? new Set<string>();
    let standingIndex = slot.position - 1;
    if (rules.reallocation === "next-eligible-position") {
      standingIndex = Math.max(
        standingIndex,
        nextPositionByDestination.get(slot.destination) ?? standingIndex,
      );
      while (
        standingIndex < standings.length
        && assignedTeamIds.has(standings[standingIndex].teamId)
      ) {
        standingIndex += 1;
      }
    }
    const standing = standings[standingIndex];
    if (!standing) {
      pendingReasons.push(`No hay suficientes posiciones para completar el cupo de ${slot.destination}.`);
      continue;
    }
    const unresolvedGroup = unresolvedTieGroups.find((group) => group.teamIds.has(standing.teamId));
    if (unresolvedGroup) {
      const firstPosition = Math.min(...unresolvedGroup.positions);
      const lastPosition = Math.max(...unresolvedGroup.positions);
      const destinationSlots = new Set(rules.slots
        .filter((candidate) => candidate.destination === slot.destination
          && candidate.position >= firstPosition
          && candidate.position <= lastPosition)
        .map(({ position }) => position));
      if (destinationSlots.size < unresolvedGroup.teamIds.size) {
        pendingReasons.push(
          `Un empate irresuelto entre ${unresolvedGroup.teams.join(", ")} afecta el cupo de ${slot.destination} en las posiciones ${unresolvedGroup.positions.join(", ")}.`,
        );
        continue;
      }
    }
    if (assignedTeamIds.has(standing.teamId)) {
      pendingReasons.push(
        `${standing.teamName} ya tiene otro cupo internacional y no hay corrimiento configurado.`,
      );
      continue;
    }
    assigned.add(standing.teamId);
    assignedTeamIds.add(standing.teamId);
    assignedByDestination.set(slot.destination, assigned);
    qualifications.push({
      originTournamentId: league.id,
      teamId: standing.teamId,
      teamName: standing.teamName,
      destination: slot.destination,
      status: unresolvedCupDestinations.has(slot.destination) ? "pending" : statusForCurrentTable,
      source: `Posición ${standingIndex + 1} de liga`,
    });
    if (rules.reallocation === "next-eligible-position") {
      nextPositionByDestination.set(slot.destination, standingIndex + 1);
    }
  }

  if (unresolvedCupDestinations.size > 0) {
    pendingReasons.push("Los cupos sujetos a campeones de copa no se confirman hasta resolver todas las copas configuradas.");
    for (let index = 0; index < qualifications.length; index += 1) {
      if ((rules.cupChampions ?? []).some(({ destination }) =>
        destination === qualifications[index].destination,
      )) {
        qualifications[index] = { ...qualifications[index], status: "pending" };
      }
    }
  }

  return { qualifications, pendingReasons: [...new Set(pendingReasons)] };
}
