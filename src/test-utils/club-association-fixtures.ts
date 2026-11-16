import {generatorScenario} from "./group-generator-fixtures";
import {reviewClubAssociation,confirmClubAssociation} from "../application/use-cases/record-club-affiliation";
import {reviewDrawConfiguration,confirmDrawConfiguration} from "../application/use-cases/configure-stage-draw";
import type {SportingAssociation} from "../domain/entities/club-affiliation";
import type {DrawConfiguration} from "../domain/entities/draw-configuration";

/** Fictitious organizations, explicitly synthetic; never real historical claims. */
export function clubAssociationScenario(registerRule=true){
  const s=generatorScenario(),source={url:"https://example.org/synthetic-affiliations",reference:"Fixture ficticio, sin hechos históricos"};
  const associations:SportingAssociation[]=["a","b"].map(id=>({id:`synthetic-association-${id}`,name:`Asociación ficticia ${id.toUpperCase()}`,organizationType:"unspecified",mode:"documented",verification:"verified",source}));
  for(const association of associations)confirmClubAssociation(reviewClubAssociation({kind:"association",tournamentId:s.t.id,universeId:null,operation:"create",revision:1,association},s.repository,true),s.repository,null,true);
  const affiliate=(index:number,associationIndex:number,revision=1)=>confirmClubAssociation(reviewClubAssociation({kind:"affiliation",tournamentId:s.t.id,universeId:null,teamId:s.ids[index],revision,status:"known",associationId:associations[associationIndex].id,mode:"documented",verification:"verified",source},s.repository,true),s.repository,null,true);
  s.ids.forEach((_,i)=>affiliate(i,i<2?0:1));
  let configuration=s.configuration;
  if(registerRule){
    const review=reviewDrawConfiguration({...configuration,revision:2,restrictions:[...configuration.restrictions,{id:"association-limit",type:"association",schemaVersion:1,maxPerGroup:1,description:"Condición sintética explícita"}]},s.repository);
    confirmDrawConfiguration(review,s.repository,null,true);configuration=s.state.activity.at(-1)!.after as DrawConfiguration;
  }
  return {...s,configuration,associations,source,affiliate};
}
