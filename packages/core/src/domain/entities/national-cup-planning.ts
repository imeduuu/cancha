import type {RulesVerificationStatus} from "./tournament";
export interface NationalCupCriterion {
 readonly id:string;
 readonly kind:"division"|"positions"|"champion"|"explicit"|"pending";
 readonly description:string;
 readonly verification:RulesVerificationStatus;
 readonly sourceUrl?:string;
 readonly count:number;
 readonly sourceTournamentId?:string;
 readonly sourceCompetitionId?:string;
 readonly sourceSeason?:number;
 readonly teamIds?:readonly string[];
 readonly positions?:readonly number[];
}
export interface NationalCupRegulation {
 readonly id:string;readonly at:string;readonly competitionId:string;readonly edition:number;
 readonly verification:RulesVerificationStatus;readonly sourceUrl?:string;readonly note:string;
 readonly expectedParticipants:number;readonly criteria:readonly NationalCupCriterion[];
}
export interface NationalCupEntry {
 readonly criterionId:string;readonly sourceTournamentId:string;readonly sourceSeason:number;
 readonly teamId:string;readonly teamName:string;readonly status:"confirmed"|"provisional"|"pending";
 readonly scenario:"local"|"provider"|"unknown";
}
export interface NationalCupReview {
 readonly id:string;readonly at:string;readonly mode:"incorporated"|"review";
 readonly regulationTournamentId:string;readonly regulation:NationalCupRegulation;
 readonly dependencies:readonly {tournamentId:string;snapshot:string}[];
 readonly participants:readonly NationalCupEntry[];
}
export interface NationalCupPlanning {
 readonly schemaVersion:1;readonly requiresReview?:boolean;
 readonly regulations:readonly NationalCupRegulation[];readonly reviews:readonly NationalCupReview[];
}
