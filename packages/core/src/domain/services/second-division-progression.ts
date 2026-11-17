import { hasUnverifiedCompetitionRules } from "./competition-rules";
import type { Fixture, Matchday, Tournament } from "../entities/tournament";
import { calculateStandings, getUnresolvedStandingsTieGroups, getBrazilianOfficialDrawContexts, type TeamStanding } from "./standings";
import { reconcileFixtureParticipants } from "./knockout-fixture-reconciliation";
import { isValidKnockoutResult, isValidFixtureResult } from "./match-result-validation";
import { secondDivisionKind, REGULAR_PHASE } from "./second-division-rules";

import type { OfficialResolutionContext } from "../entities/official-resolution";
import { makeResolutionContext, verifiedDrawOrder, multipleRelegationContext } from "./official-resolution-core";
import { programmeOrder } from "./official-programme";

export interface DivisionOutcome {
  readonly promoted: readonly string[];
  readonly relegated: readonly { teamId: string; destination: string }[];
  readonly pending: readonly string[];
  readonly complete: boolean;
}

export function regularDivisionTournament(tournament: Tournament): Tournament {
  return { ...tournament, matchdays: tournament.matchdays.filter(day => day.phaseName === REGULAR_PHASE) };
}

export function divisionZoneTournaments(tournament: Tournament): Tournament[] {
  const regular = regularDivisionTournament(tournament);
  return secondDivisionKind(tournament) === "argentina"
    ? ["Zona A", "Zona B"].map(groupName => ({
      ...regular, zoneName: groupName, teams: regular.teams.filter(team => team.groupName === groupName),
    })) : [regular];
}

/** Completeness is checked from pairings, never from the provider's coverage flag alone. */
export function hasCompleteDivisionLeague(tournament: Tournament): boolean {
  const kind = secondDivisionKind(tournament);
  if (!kind || tournament.teams.length !== (kind === "argentina" ? 36 : 20)) return false;
  const teams = new Map(tournament.teams.map(team => [team.id, team]));
  if (kind === "argentina" && ["Zona A", "Zona B"].some(zone =>
    tournament.teams.filter(team => team.groupName === zone).length !== 18)) return false;
  const regular = regularDivisionTournament(tournament);
  const directed = new Set<string>();
  const played = new Map<string, number>();
  const interzonal = new Map<string, number>();
  for (const day of regular.matchdays) {
    for (const fixture of day.fixtures) {
      const home = teams.get(fixture.homeTeamId), away = teams.get(fixture.awayTeamId);
      const key = `${fixture.homeTeamId}|${fixture.awayTeamId}`;
      if (!home || !away || home.id === away.id || directed.has(key)
        || !isValidFixtureResult(tournament, day, fixture)) return false;
      directed.add(key);
      for (const team of [home, away]) {
        played.set(team.id, (played.get(team.id) ?? 0) + 1);
        if (kind === "argentina" && home.groupName !== away.groupName)
          interzonal.set(team.id, (interzonal.get(team.id) ?? 0) + 1);
      }
    }
  }
  if (tournament.teams.some(team => played.get(team.id) !== (kind === "argentina" ? 36 : 38)
    || (kind === "argentina" && interzonal.get(team.id) !== 2))) return false;
  if ([...directed].some(pair => { const [home, away] = pair.split("|"); return !directed.has(`${away}|${home}`); })) return false;
  return tournament.teams.every(home => tournament.teams.every(away =>
    home.id === away.id || (kind === "argentina" && home.groupName !== away.groupName)
      || directed.has(`${home.id}|${away.id}`)));
}

type Pair = readonly [string, string]; // better seed first
const FIRST_FINAL = "Final por el primer ascenso";
const REDUCIDO_FIRST = "Reducido · Primera fase";
const QUARTERS = "Reducido · Cuartos de final";
const SEMIS = "Reducido · Semifinales";
const FINAL = "Reducido · Final";
const BRAZIL_PLAYOFF = "Playoffs de ascenso";

function completedWinner(tournament: Tournament, days: readonly Matchday[], pair: Pair,
  advantage: boolean): string | undefined {
  const fixtures = days.flatMap(day => day.fixtures.map(fixture => ({ day, fixture })))
    .filter(({ fixture }) => pair.includes(fixture.homeTeamId) && pair.includes(fixture.awayTeamId));
  if (fixtures.length !== days.length || !fixtures.length || fixtures.some(({ day, fixture }) =>
    !isValidFixtureResult(tournament, day, fixture))) return undefined;
  let goals = 0, points = 0;
  for (const { fixture } of fixtures) {
    const result = fixture.result!;
    const home = result.homeGoals + (result.extraTime?.homeGoals ?? 0);
    const away = result.awayGoals + (result.extraTime?.awayGoals ?? 0);
    const difference = (fixture.homeTeamId === pair[0] ? 1 : -1) * (home - away);
    goals += difference;
    points += Math.sign(difference) * 3;
  }
  if (points !== 0) return points > 0 ? pair[0] : pair[1];
  if (goals !== 0) return goals > 0 ? pair[0] : pair[1];
  if (advantage) return pair[0];
  const last = fixtures[fixtures.length - 1].fixture;
  if (!last.result?.penalties || last.result.penalties.homeGoals === last.result.penalties.awayGoals)
    return undefined;
  return last.result.penalties.homeGoals > last.result.penalties.awayGoals ? last.homeTeamId : last.awayTeamId;
}

function compareSeed(a: TeamStanding, b: TeamStanding, positions: ReadonlyMap<string, number>): number {
  return (positions.get(a.teamId)! - positions.get(b.teamId)!) || b.points - a.points
    || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor;
}

function computeSecondDivision(tournament: Tournament, contexts: OfficialResolutionContext[]): Tournament {
  const kind = secondDivisionKind(tournament);
  if (!kind) return tournament;
  const regular = regularDivisionTournament(tournament);
  const next: Matchday[] = regular.matchdays.map(day => ({ ...day, leg: 1 }));
  let phase = 1;
  const add = (name: string, pairs: readonly Pair[], legs: 1 | 2, resolution?: Fixture["knockoutResolution"]): Matchday[] => {
    const days: Matchday[] = [];
    for (let leg = 1; leg <= legs; leg++) {
      const phaseName = legs === 1 ? name : `${name} · ${leg === 1 ? "Ida" : "Vuelta"}`;
      const phaseNumber = ++phase;
      const fixtures = pairs.map(([better, worse], index): Fixture => {
        const home = legs === 1 || leg === 2 ? better : worse;
        const away = home === better ? worse : better;
        const candidate: Fixture = {
          id: `${tournament.id}-promotion-${phaseNumber}-${index + 1}`,
          homeTeamId: home, awayTeamId: away,
          ...(resolution && leg === legs ? { knockoutResolution: resolution } : {}),
          ...(name === FIRST_FINAL || name.startsWith("Desempate descenso")
            ? { schedule: { logisticsNotes: "Estadio neutral; sede pendiente de designación." } } : {}),
        };
        const oldDay = tournament.matchdays.find(day => day.phaseName === phaseName);
        const previous = oldDay?.fixtures.find(fixture => fixture.id === candidate.id)
          ?? oldDay?.fixtures.find(fixture => fixture.homeTeamId === home && fixture.awayTeamId === away);
        if (!previous) return candidate;
        const reconciled = reconcileFixtureParticipants(previous, home, away)!;
        const current = { ...reconciled, knockoutResolution: candidate.knockoutResolution };
        if (resolution === "aggregate-then-penalties" && leg === 2 && current.result) {
          const first = days[0]?.fixtures[index];
          if (!first?.result || !isValidKnockoutResult(current.result, resolution,
            { homeGoals: first.result.awayGoals, awayGoals: first.result.homeGoals })) {
            const { result: _result, goalScorers: _goals, events: _events,
              lineups: _lineups, substitutions: _substitutions, operationalState: _state,
              eventsCoverage: _coverage, ...clean } = current;
            return clean;
          }
        }
        return current;
      });
      days.push({ number: 1, leg: phaseNumber, phaseName, fixtures });
    }
    next.push(...days);
    return days;
  };
  const ready = hasCompleteDivisionLeague(tournament);
  const zones = divisionZoneTournaments(tournament);
  const tables = zones.map(zone => calculateStandings(zone));
  contexts.push(...getBrazilianOfficialDrawContexts(regular));
  const unresolved = zones.map((zone, index) => getUnresolvedStandingsTieGroups(zone, tables[index]));
  const blocks = (index: number, top: number) => unresolved[index].some(group =>
    group.some(team => tables[index].findIndex(row => row.teamId === team.teamId) < top));
  if (kind === "brasil") {
    const table = tables[0];
    add(BRAZIL_PLAYOFF, ready && !blocks(0, 6)
      ? [[table[2].teamId, table[5].teamId], [table[3].teamId, table[4].teamId]] : [], 2);
  } else {
    const [a, b] = tables;
    const seeded = ready && !blocks(0, 8) && !blocks(1, 8);
    const finalPairs: Pair[] = seeded ? [[a[0].teamId, b[0].teamId]] : [];
    const firstFinal = add(FIRST_FINAL, finalPairs, 1, "extra-time-then-penalties");
    const positions = new Map(tables.flatMap(table => table.map((row, index) => [row.teamId, index + 1] as const)));
    const all = tables.flat();
    const sortSeeds = (ids: readonly string[], priority?: string, key = QUARTERS): string[] | undefined => {
      const rows = all.filter(row => ids.includes(row.teamId)).sort((x, y) =>
        x.teamId === priority ? -1 : y.teamId === priority ? 1 : compareSeed(x, y, positions));
      const result: string[] = [];
      let pending = false;
      for (let start = 0; start < rows.length;) {
        let end = start + 1;
        while (end < rows.length && rows[start].teamId !== priority && rows[end].teamId !== priority
          && compareSeed(rows[start], rows[end], positions) === 0) end++;
        const tied = rows.slice(start, end);
        if (tied.length > 1) {
          const context = makeResolutionContext(tournament, "argentina-seeding", key, `Sorteo de ordenamiento · ${key}`,
            tied.map(row => row.teamId), tied.map(row => ({ ...row, zonePosition: positions.get(row.teamId) }))
              .sort((a, b) => a.teamId.localeCompare(b.teamId)));
          contexts.push(context);
          const order = verifiedDrawOrder(tournament, context);
          if (order) result.push(...order); else pending = true;
        } else result.push(tied[0].teamId);
        start = end;
      }
      return pending ? undefined : result;
    };
    const firstPairs: Pair[] = [];
    if (seeded) {
      for (let index = 1; index <= 3; index++) {
        firstPairs.push([a[index].teamId, b[8 - index].teamId], [b[index].teamId, a[8 - index].teamId]);
      }
      const fifths = sortSeeds([a[4].teamId, b[4].teamId], undefined, "Reducido · Primera fase · Quintos");
      if (fifths) firstPairs.push([fifths[0], fifths[1]]);
    }
    const first = add(REDUCIDO_FIRST, firstPairs, 1);
    const firstWinners = firstPairs.map(pair => completedWinner(tournament, first, pair, true));
    const champion = finalPairs[0] ? completedWinner(tournament, firstFinal, finalPairs[0], false) : undefined;
    const loser = champion ? finalPairs[0].find(id => id !== champion) : undefined;
    let survivors: string[] | undefined = firstWinners.length === 7 && firstWinners.every(Boolean) && loser
      ? sortSeeds([...(firstWinners as string[]), loser], loser) : undefined;
    for (const [name, count] of [[QUARTERS, 8], [SEMIS, 4], [FINAL, 2]] as const) {
      const pairs: Pair[] = survivors?.length === count
        ? Array.from({ length: count / 2 }, (_, i) => [survivors![i], survivors![count - i - 1]] as const) : [];
      const days = add(name, pairs, 2, name === FINAL ? "aggregate-then-penalties" : undefined);
      const winners = pairs.map(pair => completedWinner(tournament, days, pair, name !== FINAL));
      survivors = winners.length === count / 2 && winners.every(Boolean)
        ? sortSeeds(winners as string[], loser, name === QUARTERS ? SEMIS : name === SEMIS ? FINAL : "Reducido · Concluido") : undefined;
    }
    // Article 111: a two-club tie across the relegation boundary needs a neutral playoff.
    // Larger tied groups require AFA's draw/order; never replace that with the display order.
    for (let index = 0; index < 2; index++) {
      const table = tables[index];
      const tied = ready && table[15]?.points === table[16]?.points
        ? table.filter(row => row.points === table[16].points) : [];
      const context = ready ? multipleRelegationContext(zones[index], table) : undefined;
      if (context) contexts.push(context);
      add(`Desempate descenso · Zona ${index === 0 ? "A" : "B"}`,
        tied.length === 2 ? [[tied[0].teamId, tied[1].teamId]] : [], 1, "extra-time-then-penalties");
    }
  }
  const updated = { ...tournament, format: "staged" as const, legs: phase, matchdays: next };
  return JSON.stringify(updated) === JSON.stringify(tournament) ? tournament : updated;
}

export function getOfficialResolutionContexts(tournament: Tournament): OfficialResolutionContext[] {
  const contexts: OfficialResolutionContext[] = [];
  computeSecondDivision(tournament, contexts);
  return contexts;
}
export function advanceSecondDivision(tournament: Tournament): Tournament {
  const contexts: OfficialResolutionContext[] = [];
  const progressed = computeSecondDivision(tournament, contexts);
  if (!progressed.officialResolutions?.length) return progressed;
  let changed = false;
  const officialResolutions = progressed.officialResolutions.map(record => {
    if (record.invalidation || record.supersededBy) return record;
    const context = contexts.find(context => context.scope === record.scope && context.key === record.key
      && context.dependencySnapshot === record.dependencySnapshot);
    if (context) return record;
    changed = true;
    return { ...record, invalidation: { at: new Date().toISOString(), reason: "Cambiaron los participantes, criterios o resultados de los que dependía la resolución." } };
  });
  return changed ? { ...progressed, officialResolutions } : progressed;
}

export function getDivisionOutcome(input: Tournament): DivisionOutcome {
  if (secondDivisionKind(input) && hasUnverifiedCompetitionRules(input)) return {
    promoted: [], relegated: [], complete: false,
    pending: ["El reglamento de tabla o clasificaciones de esta temporada está pendiente de verificar."],
  };
  const tournament = advanceSecondDivision(input);
  const kind = secondDivisionKind(tournament);
  const pending: string[] = [];
  const promoted: string[] = [];
  const relegated: { teamId: string; destination: string }[] = [];
  if (!kind || !hasCompleteDivisionLeague(tournament)) return {
    promoted, relegated, pending: ["Fase regular incompleta: se requieren todos los cruces y resultados válidos."], complete: false,
  };
  const zones = divisionZoneTournaments(tournament);
  const tables = zones.map(zone => calculateStandings(zone));
  const stageWinners = (name: string, count: number, advantage: boolean) => {
    const days = tournament.matchdays.filter(day => day.phaseName === name || day.phaseName?.startsWith(`${name} · `));
    const last = days[days.length - 1];
    if (!last || last.fixtures.length !== count) return [];
    return last.fixtures.map(fixture => completedWinner(tournament, days,
      [fixture.homeTeamId, fixture.awayTeamId], advantage)).filter((id): id is string => Boolean(id));
  };
  if (kind === "brasil") {
    const unresolved = getUnresolvedStandingsTieGroups(zones[0], tables[0]);
    for (const group of unresolved) {
      const places = group.map(row => tables[0].findIndex(item => item.teamId === row.teamId));
      if (places.some(place => place < 6) || (places.some(place => place < 16) && places.some(place => place >= 16)))
        pending.push("Desempate de tabla pendiente: faltan tarjetas verificadas o sorteo oficial.");
    }
    if (!pending.length) promoted.push(...tables[0].slice(0, 2).map(row => row.teamId));
    promoted.push(...stageWinners(BRAZIL_PLAYOFF, 2, true));
    if (!pending.length) relegated.push(...tables[0].slice(16).map(row => ({ teamId: row.teamId, destination: "Série C" })));
    if (promoted.length !== 4) pending.push("Playoffs de ascenso pendientes (sin final adicional ni penales).");
  } else {
    promoted.push(...stageWinners(FIRST_FINAL, 1, false), ...stageWinners(FINAL, 1, false));
    if (promoted.length !== 2) pending.push("Final por el primer ascenso, Reducido o sorteo de ordenamiento pendiente.");
    tables.forEach((table, index) => {
      let ids = table.slice(16).map(row => row.teamId);
      if (table[15].points === table[16].points) {
        const tied = table.filter(row => row.points === table[16].points);
        const winner = tied.length === 2
          ? stageWinners(`Desempate descenso · Zona ${index === 0 ? "A" : "B"}`, 1, false)[0] : undefined;
        const context = multipleRelegationContext(zones[index], table);
        const order = context ? programmeOrder(tournament, context) : undefined;
        if (order) {
          const alreadyBelow = table.filter(row => row.points < tied[0].points).map(row => row.teamId);
          const count = 2 - alreadyBelow.length;
          ids = [...alreadyBelow, ...order.slice(-count)];
        } else if (!winner) { pending.push(`Desempate de descenso pendiente en Zona ${index === 0 ? "A" : "B"} (art. 111).`); ids = []; }
        else ids = [...table.filter(row => row.points < tied[0].points).map(row => row.teamId), ...tied.filter(row => row.teamId !== winner).map(row => row.teamId)];
      }
      for (const teamId of ids) {
        const team = tournament.teams.find(team => team.id === teamId)!;
        const destination = team.afaAffiliation === "direct" ? "Primera B" : team.afaAffiliation === "indirect" ? "Federal A" : "Afiliación pendiente";
        relegated.push({ teamId, destination });
        if (!team.afaAffiliation) pending.push(`Falta verificar la afiliación de ${team.name} para definir su destino.`);
      }
    });
  }
  return { promoted, relegated, pending: [...new Set(pending)], complete: pending.length === 0 };
}
