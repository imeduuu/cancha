import type {NationalCupRegulationInput} from "./register-national-cup-regulation";
import type {Tournament} from "../../domain/entities/tournament";
import type {TournamentRepository} from "../ports/tournament-repository";
import {canonical} from "../../domain/services/continental-plan";
import {projectSeasonPlanning,planningLibrarySnapshot,type SeasonPlanningInput} from "../services/season-planning";
import {createLinkedDivisionSeasons} from "./create-linked-division-seasons";
import {createTournamentSeason} from "./create-tournament-season";
import {reviewContinentalEdition,confirmContinentalEdition,type ContinentalPreparationInput} from "./prepare-continental-edition";
const reviews=new WeakMap<object,string>();
export function reviewSeasonPlanning(input:SeasonPlanningInput,repository:TournamentRepository){
 const copy=JSON.parse(JSON.stringify(input)) as SeasonPlanningInput;
 const preview=projectSeasonPlanning(copy,repository.findAll(),repository.findActivity?.() ?? []);
 if(!preview.canReview)throw new Error(preview.blockers.join(" "));
 const continental=copy.mode==="continental"?reviewContinentalEdition({cup:copy.cup ?? "libertadores",edition:copy.targetSeason,
  qualifyingSeason:copy.qualifyingSeason ?? preview.source!.season!,sourceIds:copy.sourceIds ?? [copy.sourceId],selectedKeys:copy.selectedKeys ?? [],
  sourceUrl:copy.sourceUrl ?? "",note:copy.note ?? "",...(copy.targetId?{targetId:copy.targetId}:{})} satisfies ContinentalPreparationInput,repository):undefined;
 const review={input:copy,preview,continental};reviews.set(review,canonical(review));return review;
}
export type SeasonPlanningReview=ReturnType<typeof reviewSeasonPlanning>;
export interface SeasonPlanningActions {onRegisterCupRegulation?:(sourceId:string,input:NationalCupRegulationInput)=>Tournament;onReviewPlanning?:(input:SeasonPlanningInput)=>SeasonPlanningReview;onConfirmPlanning?:(review:SeasonPlanningReview)=>readonly Tournament[]}
export function confirmSeasonPlanning(review:SeasonPlanningReview,repository:TournamentRepository,confirmed:boolean):readonly Tournament[]{
 if(!confirmed || reviews.get(review)!==canonical(review))throw new Error("Revisa la vista previa y confirma expresamente sin alterar sus datos.");
 if(review.preview.snapshot!==planningLibrarySnapshot(repository.findAll(),repository.findActivity?.() ?? []))throw new Error("Dependencia desactualizada: los datos de la biblioteca cambiaron. Revisa nuevamente antes de crear.");
 const current=projectSeasonPlanning(review.input,repository.findAll(),repository.findActivity?.() ?? []);
 if(!current.canReview)throw new Error(current.blockers.join(" "));
 let created:readonly Tournament[];
 if(review.input.mode==="continental"){
  if(!review.continental)throw new Error("Falta la revisión continental del flujo existente.");
  created=[confirmContinentalEdition(review.continental,repository,true)];
 }else if(review.input.mode==="divisions"){
  if(!current.upper || !current.lower)throw new Error("Falta la pareja de divisiones revisada.");
  created=createLinkedDivisionSeasons(current.upper,current.lower,review.input.incoming ?? [],review.input.sourceUrl ?? "",repository);
 }else if(review.input.mode==="national-cup")created=[createTournamentSeason(current.source!,review.input.targetSeason,repository,undefined,undefined,false,true,{regulationId:review.input.regulationId ?? "",targetId:review.input.targetId})];
 else created=[createTournamentSeason(current.source!,review.input.targetSeason,repository,undefined,undefined,false,true)];
 reviews.delete(review);return created;
}
