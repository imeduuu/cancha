import type {Fixture} from "../../domain/entities/tournament";
import {validateMatchSchedule} from "../../domain/services/match-scheduling";
/** Full, validated instant only; date-only records do not establish match order. */
export function fixtureInstant(fixture:Fixture):number|undefined{
 const s=fixture.schedule;
 if(!s?.date || !s.time || !s.utcOffset || validateMatchSchedule(s))return undefined;
 const stamp=Date.parse(`${s.date}T${s.time}${s.utcOffset}`);
 return Number.isFinite(stamp)?stamp:undefined;
}
/** Existing record convention: positive regulation difference wins; zero preserves an unbeaten run. */
export function maximumResultStreak(differences:readonly number[]){
 let wins=0,unbeaten=0,bestWins=0,bestUnbeaten=0;
 for(const delta of differences){wins=delta>0?wins+1:0;unbeaten=delta>=0?unbeaten+1:0;bestWins=Math.max(bestWins,wins);bestUnbeaten=Math.max(bestUnbeaten,unbeaten);}
 return {wins:bestWins,unbeaten:bestUnbeaten};
}
