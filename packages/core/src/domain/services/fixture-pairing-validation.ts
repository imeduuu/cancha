import type { KnockoutStage, TournamentFormat } from "../entities/tournament";
import { normalizeTeamName } from "./team-name";

export interface PairingFixture {
  readonly id: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly homeTeamName?: string;
  readonly awayTeamName?: string;
}

export interface PairingMatchday {
  readonly number: number;
  readonly leg?: number;
  readonly phaseName?: string;
  readonly fixtures: readonly PairingFixture[];
}

export interface PairingValidationRules {
  readonly format?: TournamentFormat;
  readonly legs?: number;
  readonly knockoutStages?: readonly KnockoutStage[];
  readonly singleMeetingPhaseNames?: readonly string[];
}

interface PairingEntry {
  readonly fixture: PairingFixture;
  readonly matchday: PairingMatchday;
  readonly homeLabel: string;
  readonly awayLabel: string;
}

function normalized(value: string | undefined): string {
  return normalizeTeamName(value ?? "");
}

function getConfiguredStage(
  phaseName: string | undefined,
  stages: readonly KnockoutStage[],
): KnockoutStage | undefined {
  const phase = normalized(phaseName);
  return stages.find((stage) => {
    const name = normalized(stage.name);
    return phase === name || phase.startsWith(`${name} ·`);
  });
}

function getStageLeg(
  phaseName: string | undefined,
  matchday: PairingMatchday,
  stage: KnockoutStage,
): number | undefined {
  const phase = normalized(phaseName);
  if (phase.endsWith(" · ida")) return 1;
  if (phase.endsWith(" · vuelta")) return 2;
  if (stage.legs === 1) return 1;
  if (matchday.number === 1 || matchday.number === 2) return matchday.number;
  if (matchday.leg === 1 || matchday.leg === 2) return matchday.leg;
  return undefined;
}

/**
 * Detects repeated pairings in the scope defined by the competition format,
 * phase names and explicit knockout-stage leg configuration.
 */
export function validateFixturePairings(
  matchdays: readonly PairingMatchday[],
  rules: PairingValidationRules,
): string[] {
  const scoped = new Map<string, {
    readonly entries: PairingEntry[];
    readonly phaseName: string;
    readonly stage?: KnockoutStage;
    readonly strictSingleMeeting: boolean;
  }>();
  const issues: string[] = [];
  const strictPhases = new Set((rules.singleMeetingPhaseNames ?? []).map(normalized));

  for (const matchday of matchdays) {
    const stage = getConfiguredStage(matchday.phaseName, rules.knockoutStages ?? []);
    const phaseName = matchday.phaseName ?? "Fase sin nombre";
    const phaseKey = stage
      ? `stage:${normalized(stage.name)}`
      : `phase:${normalized(matchday.phaseName)}`;
    const strictSingleMeeting = strictPhases.has(normalized(matchday.phaseName));

    for (const fixture of matchday.fixtures) {
      const pairKey = [fixture.homeTeamId, fixture.awayTeamId].sort().join("|");
      const key = `${phaseKey}|${pairKey}`;
      const bucket = scoped.get(key) ?? {
        entries: [],
        phaseName,
        ...(stage ? { stage } : {}),
        strictSingleMeeting,
      };
      const entries = bucket.entries;
      entries.push({
        fixture,
        matchday,
        homeLabel: fixture.homeTeamName ?? fixture.homeTeamId,
        awayLabel: fixture.awayTeamName ?? fixture.awayTeamId,
      });
      scoped.set(key, bucket);
    }
  }

  for (const { entries, phaseName, stage, strictSingleMeeting } of scoped.values()) {
    if (entries.length < 2) continue;

    const first = entries[0];
    const pairLabel = `"${first.homeLabel}" y "${first.awayLabel}"`;
    const matchdaysText = [...new Set(entries.map(({ matchday }) => matchday.number))]
      .sort((a, b) => a - b)
      .join(", ");
    const phaseText = `Fase "${phaseName}", fechas ${matchdaysText}`;
    const legs = entries.map(({ matchday }) =>
      stage ? getStageLeg(matchday.phaseName, matchday, stage) : matchday.leg,
    );
    const sameHome = entries.slice(1).some(({ fixture }) =>
      fixture.homeTeamId === first.fixture.homeTeamId,
    );

    if (stage?.legs === 1 || strictSingleMeeting) {
      issues.push(`${phaseText}: el cruce entre ${pairLabel} aparece ${entries.length} veces; esta fase admite un solo partido por pareja.`);
      continue;
    }

    if (stage?.legs === 2) {
      if (entries.length > 2 || legs.some((leg) => leg === undefined)
        || new Set(legs).size !== entries.length || sameHome) {
        issues.push(`${phaseText}: el cruce entre ${pairLabel} no respeta la ida y vuelta configurada.`);
      }
      continue;
    }

    if (rules.format !== "staged") {
      const expectedLegs = Math.max(1, rules.legs ?? 1);
      if (entries.length > expectedLegs || sameHome) {
        issues.push(`${phaseText}: el cruce entre ${pairLabel} está repetido con una localía incompatible con ${expectedLegs} rueda(s).`);
      }
      continue;
    }

    // For staged phases without explicit leg metadata, allow one home-and-away
    // pair while rejecting repeated hosts and additional meetings.
    if (entries.length > 2 || sameHome) {
      issues.push(`${phaseText}: el cruce entre ${pairLabel} está repetido con la misma localía o más de dos veces.`);
    }
  }

  return issues;
}

