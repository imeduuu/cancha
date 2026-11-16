import type { Tournament } from "../../domain/entities/tournament";
import type { ContinentalCup, ContinentalPlan } from "../../domain/entities/continental-plan";
import type { TournamentRepository } from "../ports/tournament-repository";
import { continentalProjection, entryKey, continentalRosterDifferences } from "../services/continental-projection";
import { canonical, isHttpsReference } from "../../domain/services/continental-plan";
import { competitionIdentity } from "../services/competition-center";
import { validateTournamentIntegrity } from "../../domain/services/tournament-integrity";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";
export interface ContinentalPreparationInput {
  readonly cup: ContinentalCup;
  readonly edition: number;
  readonly qualifyingSeason: number;
  readonly sourceIds: readonly string[];
  readonly selectedKeys: readonly string[];
  readonly targetId?: string;
  readonly sourceUrl: string;
  readonly note: string;
}
const reviewed = new WeakMap<object,string>();
export function reviewContinentalEdition(input: ContinentalPreparationInput, repository: TournamentRepository) {
  if (!["libertadores","sudamericana"].includes(input.cup) || !Number.isSafeInteger(input.edition) || !Number.isSafeInteger(input.qualifyingSeason)
    || input.qualifyingSeason < 1 || input.edition < input.qualifyingSeason) throw new Error("La edición y la temporada de clasificación son incompatibles.");
  if (!isHttpsReference(input.sourceUrl) || !input.note.trim()) throw new Error("Registra una referencia HTTPS y la decisión documental de vinculación entre temporadas.");
  if (!input.sourceIds.length || new Set(input.sourceIds).size !== input.sourceIds.length) throw new Error("Selecciona orígenes distintos.");
  const tournaments = repository.findAll(), activity = repository.findActivity?.() ?? [];
  const target = input.targetId ? tournaments.find(t => t.id === input.targetId) : undefined;
  if (input.targetId && (!target || competitionIdentity(target) !== `conmebol-${input.cup}` || target.season !== input.edition))
    throw new Error("La copa de destino no corresponde a la competición y edición.");
  if (!target && tournaments.some(t => competitionIdentity(t) === `conmebol-${input.cup}` && t.season === input.edition))
    throw new Error("Ya existe esa edición. Selecciónala para revisar discrepancias sin reemplazar sus participantes.");
  for (const id of input.sourceIds) {
    const source = tournaments.find(t => t.id === id);
    if (!source || source.season !== input.qualifyingSeason || competitionIdentity(source).startsWith("conmebol-"))
      throw new Error("Un origen falta, no es nacional o corresponde a otra temporada.");
  }
  const projection = continentalProjection(input.sourceIds,input.qualifyingSeason,input.cup,tournaments,activity);
  const entries = projection.entries.filter(e => input.selectedKeys.includes(entryKey(e)));
  if (new Set(input.selectedKeys).size !== input.selectedKeys.length || entries.length !== input.selectedKeys.length
    || entries.some(e => e.status === "pending" || projection.conflicts.includes(entryKey(e))))
    throw new Error("La selección contiene cupos pendientes, conflictos o referencias inválidas.");
  if (!target && !entries.length) throw new Error("Selecciona al menos un clasificado elegible para la planificación.");
  const review = { input: JSON.parse(JSON.stringify(input)) as ContinentalPreparationInput, entries, projection,
    target, targetSnapshot: canonical(target ?? null), differences: target ? continentalRosterDifferences(entries,target) : undefined };
  reviewed.set(review,canonical(review)); return review;
}
export type ContinentalReview = ReturnType<typeof reviewContinentalEdition>;
export function confirmContinentalEdition(review: ContinentalReview, repository: TournamentRepository, confirmed: boolean,
  createId: () => string = () => crypto.randomUUID(), now: () => Date = () => new Date()): Tournament {
  if (!confirmed || reviewed.get(review) !== canonical(review)) throw new Error("Revisa y confirma expresamente la selección sin modificar la revisión.");
  const current = reviewContinentalEdition(review.input,repository);
  if (canonical(current) !== canonical(review)) throw new Error("Los orígenes o la copa cambiaron. Revisa nuevamente las dependencias.");
  const used = new Set(repository.findAll().flatMap(t => [t.id,...t.teams.map(team => team.id),...(t.continentalPlans?.map(p => p.id) ?? [])]));
  const unique = () => { for (let i=0;i<100;i++) { const id=createId(); if (id.trim() && !used.has(id)) {used.add(id);return id;} } throw new Error("No se pudo generar un identificador único."); };
  const at = now().toISOString();
  const {input,target} = current;
  const entries = current.entries.map(e => ({...e,...(!target ? {targetTeamId:unique()}: {})}));
  const plan: ContinentalPlan = { schemaVersion:1, id:unique(), at, cup:input.cup, edition:input.edition,
    qualifyingSeason:input.qualifyingSeason, sourceTournamentIds:[...input.sourceIds], dependencies:current.projection.dependencies,
    entries, pendingReasons:current.projection.reasons, sourceUrl:input.sourceUrl.trim(), note:input.note.trim(), mode:target ? "review" : "incorporated" };
  const next: Tournament = target ? {...target, continentalPlans:[...(target.continentalPlans ?? []),plan]} : {
    id:unique(), competitionId:`conmebol-${input.cup}`, name:`${input.cup === "libertadores" ? "Copa Libertadores" : "Copa Sudamericana"} ${input.edition}`,
    season:input.edition, createdAt:at, teams:entries.map(e => ({id:e.targetTeamId!,name:e.teamName})),
    legs:1, tieBreakers:[], matchdays:[], format:"staged", competitionType:"cup", importCoverage:"unknown", continentalPlans:[plan],
    rulesNote:"Planificación local de participantes. Calendario, fases y reglamento de la edición pendientes; no acredita cupos oficiales.",
    competitionRules:{season:input.edition,verification:{standings:"pending",placements:"pending"}},
  };
  const issues=validateTournamentIntegrity(next); if (issues.length) throw new Error(issues[0]);
  saveWithActivity(repository,next,createActivityEvent(next,{action:target ? "regulations-updated" : "season-created",entityType:"season",
    summary:target ? "Se registró una revisión continental sin cambiar participantes ni partidos." : "Se preparó una edición continental local con participantes confirmados expresamente por el usuario.",
    after:{continentalPlan:plan},note:input.note},now));
  reviewed.delete(review); return next;
}
