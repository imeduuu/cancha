import { DomainError } from "../../domain/domain-error.js";
import type {NationalCupRegulation} from "../../domain/entities/national-cup-planning";
import {isNationalCupRegulation} from "../../domain/services/national-cup-planning";
import {validateTournamentIntegrity} from "../../domain/services/tournament-integrity";
import {competitionIdentity} from "../services/competition-center";
import type {TournamentRepository} from "../ports/tournament-repository";
import {createActivityEvent,saveWithActivity} from "../services/activity-log";
export type NationalCupRegulationInput=Omit<NationalCupRegulation,"id"|"at"|"competitionId">;
export function registerNationalCupRegulation(sourceId:string,input:NationalCupRegulationInput,repository:TournamentRepository,confirmed:boolean){
 if(!confirmed)throw new DomainError("Confirma expresamente el registro documental revisado.");
 const source=repository.findAll().find(t=>t.id===sourceId);
 if(!source || source.competitionType!=="cup" || !source.competitionId && competitionIdentity(source)===source.id || competitionIdentity(source).startsWith("conmebol-"))throw new DomainError("Selecciona una copa nacional con identificador registrado.");
 if(source.nationalCupPlanning?.requiresReview)throw new DomainError("La copia requiere reconstruir expresamente sus referencias documentales; conserva el original para registrar disposiciones.");
 const record={...JSON.parse(JSON.stringify(input)),id:crypto.randomUUID(),at:new Date().toISOString(),competitionId:competitionIdentity(source)} as NationalCupRegulation;
 if(!isNationalCupRegulation(record))throw new DomainError("Reglamento inválido: revisa edición, criterios, cupos y fuentes HTTPS; los criterios verificados requieren documentación.");
 const next={...source,nationalCupPlanning:{schemaVersion:1 as const,regulations:[...(source.nationalCupPlanning?.regulations ?? []),record],reviews:source.nationalCupPlanning?.reviews ?? []}};
 const issues=validateTournamentIntegrity(next);if(issues.length)throw new DomainError(issues[0]);
 saveWithActivity(repository,next,createActivityEvent(next,{action:"regulations-updated",entityType:"season",summary:`Se registró un reglamento de participación de copa para ${record.edition}. Verificación manual del usuario.`,after:{nationalCupRegulation:record},note:record.note}));return next;
}
