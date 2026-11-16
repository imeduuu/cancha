import type {Tournament} from "../domain/entities/tournament";
import {closureCup,closureLeague} from "./season-closure-fixtures";
export function drawCup(twoLegs=false):Tournament {
  const t=closureCup();
  return {...t,id:"draw-cup",competitionId:"custom-draw-cup",name:"Copa de preparación",legs:twoLegs?4:2,
    competitionRules:{...t.competitionRules!,sourceUrls:["https://example.org/regulation"],standingsNote:"Orden registrado",placementsNote:"Eliminatorias registradas por el usuario"},
    seasonPreparation:{schemaVersion:1,sourceTournamentIds:[],plannedParticipants:t.teams.map(team=>team.id),calendarReviews:[]},
    knockoutStages:[{name:"Semifinal",legs:twoLegs?2:1},{name:"Final",legs:twoLegs?2:1}],
    matchdays:twoLegs?[{number:1,leg:1,phaseName:"Semifinal · Ida",fixtures:[]},{number:1,leg:2,phaseName:"Semifinal · Vuelta",fixtures:[]},{number:1,leg:3,phaseName:"Final · Ida",fixtures:[]},{number:1,leg:4,phaseName:"Final · Vuelta",fixtures:[]}]:[{number:1,leg:1,phaseName:"Semifinal",fixtures:[]},{number:1,leg:2,phaseName:"Final",fixtures:[]}]};
}
export function drawGroups():Tournament {
  const t=closureLeague("draw-groups");
  return {...t,name:"Grupos de preparación",teams:t.teams.map((team,i)=>({...team,groupName:i<2?"A":"B"})),matchdays:[],
    competitionRules:{...t.competitionRules!,sourceUrls:["https://example.org/regulation"],standingsNote:"Tabla registrada",placementsNote:"Dos grupos registrados, sin bombos acreditados"},
    seasonPreparation:{schemaVersion:1,sourceTournamentIds:[],plannedParticipants:t.teams.map(team=>team.id),calendarReviews:[]}};
}
