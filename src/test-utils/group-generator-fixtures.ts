import type {ActivityEvent} from "../domain/entities/activity-event";
import type {Tournament} from "../domain/entities/tournament";
import type {DrawConfiguration} from "../domain/entities/draw-configuration";
import type {TournamentRepository} from "../application/ports/tournament-repository";
import {drawGroups} from "./stage-draw-fixtures";
import {emptyDrawConfiguration} from "../application/services/draw-configuration";
import {reviewDrawConfiguration,confirmDrawConfiguration} from "../application/use-cases/configure-stage-draw";
import {groupStageKey} from "../application/services/draw-and-bracket";

export function generatorScenario(teamCount=4,groupCount=2){
  if(teamCount%groupCount)throw new Error("El fixture necesita capacidades iguales explícitas.");
  const base=drawGroups(),teams=Array.from({length:teamCount},(_,i)=>({id:`synthetic-${i}`,name:`Participante ${i+1}`,groupName:`G${Math.floor(i/(teamCount/groupCount))+1}`}));
  const t={...base,teams,seasonPreparation:{...base.seasonPreparation!,plannedParticipants:teams.map(t=>t.id)}};
  const state:{tournaments:Tournament[];activity:ActivityEvent[]}={tournaments:[t],activity:[]};
  const repository:TournamentRepository={findAll:()=>state.tournaments,findActivity:()=>state.activity,save:next=>{state.tournaments=[next];},
    saveWithActivity:(next,event)=>{state.tournaments=[next];state.activity.push(event);},recordActivity:event=>{state.activity.push(event);}};
  const c=emptyDrawConfiguration(t,null,[t],[]),ids=teams.map(t=>t.id),potSize=groupCount;
  c.pots=Array.from({length:teamCount/potSize},(_,i)=>({id:`pot-${i}`,name:`Bombo ${i+1}`,capacity:potSize,teamIds:ids.slice(i*potSize,(i+1)*potSize)}));
  c.restrictions=c.pots.map(p=>({id:`quota-${p.id}`,type:"pot-distribution" as const,potId:p.id,perGroup:1}));
  confirmDrawConfiguration(reviewDrawConfiguration(c,repository),repository,null,true);
  const configuration=state.activity[0].after as DrawConfiguration;
  const input={tournamentId:t.id,universeId:null,stage:groupStageKey,seed:"synthetic-seed"};
  return {t,ids,state,repository,configuration,input};
}
