// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from "vitest";
import type {OfficialLeagueSeason} from "../../application/ports/official-league-source";
import {importOfficialTournament} from "../../application/use-cases/import-official-tournament";
import {AnfaThirdDivisionSource} from "./anfa-third-division-source";
import {CopaDoBrasilOfficialSource} from "./south-american-cup-sources";
import sample0 from "../../test-utils/fixtures/live/argentina-apertura-2026.json";
import sample1 from "../../test-utils/fixtures/live/libertadores-preliminary-2026.json";
import sample2 from "../../test-utils/fixtures/live/anfa-pending.json";
import sample3 from "../../test-utils/fixtures/live/cbf-homonyms.json";
import sample4 from "../../test-utils/fixtures/live/cbf-aggregate-penalties.json";
import sample5 from "../../test-utils/fixtures/live/anfa-repeated-home.json";
import sample6 from "../../test-utils/fixtures/live/espn-continental-schedule.json";
const samples = {
  "argentina-apertura-2026.json": sample0,
  "libertadores-preliminary-2026.json": sample1,
  "anfa-pending.json": sample2,
  "cbf-homonyms.json": sample3,
  "cbf-aggregate-penalties.json": sample4,
  "anfa-repeated-home.json": sample5,
  "espn-continental-schedule.json": sample6,
};
const read = <K extends keyof typeof samples>(name: K) => samples[name];
afterEach(()=>vi.unstubAllGlobals());
describe("minimized samples captured from live providers",()=>{
 it("preserves the published Argentina playoff matches despite chronological ordering",async()=>{
  const season=read("argentina-apertura-2026.json") as OfficialLeagueSeason;
  const source={fetchSeason:async()=>season};
  const result=await importOfficialTournament(source,{findAll:()=>[],save:()=>{},saveWithActivity:()=>{}},undefined,"argentina-primera");
  const fixtures=result.matchdays.flatMap(d=>d.fixtures);
  for(const m of season.matchdays.flatMap(d=>d.matches)){
   const f=fixtures.find(f=>f.id===`official-2026-${m.id}`);
   expect(f,`Partido publicado ${m.id}`).toBeDefined();
   expect(result.teams.find(t=>t.id===f!.homeTeamId)?.name).toBe(m.homeTeamName);
   expect(result.teams.find(t=>t.id===f!.awayTeamId)?.name).toBe(m.awayTeamName);
   expect(f!.result?.homeGoals).toBe(m.homeGoals);
   expect(f!.result?.awayGoals).toBe(m.awayGoals);
  }
 });
 it("accepts the published Libertadores direct entrants into preliminary stage 2",async()=>{
  const season=read("libertadores-preliminary-2026.json") as OfficialLeagueSeason;
  // Apply the adapter's declared stage metadata rather than bypassing integrity checks.
  const {EspnContinentalCupSource}=await import("./espn-continental-cup-source");
  const minimalEvent={id:"metadata",date:"2026-02-01T20:00:00Z",season:{year:2026,slug:"first-stage"},competitions:[{status:{type:{completed:false,state:"pre",name:"STATUS_SCHEDULED"}},competitors:[{homeAway:"home",team:{displayName:"Club A"}},{homeAway:"away",team:{displayName:"Club B"}}]}]};
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({events:[minimalEvent]}))));
  const metadata=await new EspnContinentalCupSource().fetchSeason("libertadores");
  const data={...season,knockoutStages:metadata.knockoutStages};
  await expect(importOfficialTournament({fetchSeason:async()=>data},{findAll:()=>[],save:()=>{},saveWithActivity:()=>{}},undefined,"libertadores")).resolves.toBeDefined();
 });
 it("interprets the actual ANFA VS token as pending without inventing a score",async()=>{
  const sample=read("anfa-pending.json");
  // A one-round harness wraps the exact clubs and token captured in round 26.
  const html=`<table class="table-striped table-responsive table-hover"><tbody><tr><td>1</td><td><div class="team-cell"><strong>${sample.home}</strong></div></td><td><span class="resultado-box">${sample.score}</span></td><td><div class="team-cell"><strong>${sample.away}</strong></div></td></tr></tbody></table>`;
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>new Response(String(input).includes("?j=")?html:'<a href="?j=1">1</a>')));
  const season=await new AnfaThirdDivisionSource().fetchSeason("tercera-a");
  expect(season.matchdays[0].matches[0]).toMatchObject({homeTeamName:sample.home,awayTeamName:sample.away});
  expect(season.matchdays[0].matches[0].homeGoals).toBeUndefined();
 });
 it("keeps the three homonymous CBF clubs distinct using their published identifiers",async()=>{
  const sample=read("cbf-homonyms.json") as {samples:{phaseId:string;matches:unknown[]}[]};
  const phases=sample.samples.map((s,index)=>({fase_id:s.phaseId,fase_nome:index===0?"2ª Fase":"3ª Fase",rodadas_qtd:"1",fase_tipo:"eliminacao"}));
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
   const selected=sample.samples.find(s=>String(input).endsWith("/"+s.phaseId));
   return new Response(JSON.stringify(selected?{data:selected.matches}:{phasesList:phases}));
  }));
  const season=await new CopaDoBrasilOfficialSource().fetchSeason("copa-brasil");
  const names=new Set(season.matchdays.flatMap(d=>d.matches.flatMap(m=>[m.homeTeamName,m.awayTeamName])).filter(name=>name.startsWith("Operário")));
  expect(names.size).toBe(3);
  for(const day of season.matchdays){const clubs=day.matches.flatMap(m=>[m.homeTeamName,m.awayTeamName]);expect(new Set(clubs).size).toBe(clubs.length);}
 });
});

it("preserves CBF shootouts decided by aggregate even when the second leg is not a draw",async()=>{
 const sample=read("cbf-aggregate-penalties.json");
 const phase={fase_id:"1999",fase_nome:"5ª Fase",rodadas_qtd:"2",fase_tipo:"eliminacao"};
 vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>new Response(JSON.stringify(String(input).endsWith("/1999")?{data:sample.matches}:{phasesList:[phase]}))));
 const source=new CopaDoBrasilOfficialSource();const data=await source.fetchSeason("copa-brasil");
 expect(data.matchdays[1].matches[0].penalties).toEqual({homeGoals:2,awayGoals:4});
 const result=await importOfficialTournament(source,{findAll:()=>[],save:()=>{},saveWithActivity:()=>{}},undefined,"copa-brasil",undefined,{seasonData:data});
 expect(result.matchdays[1].fixtures[0].knockoutResolution).toBe("aggregate-then-penalties");
 expect(data.knockoutStages?.some(stage=>stage.name==="Copa do Brasil · Final")).toBe(false);
});
it("rejects the repeated ANFA home pairing rather than inventing a reversed fixture",async()=>{
 const sample=read("anfa-repeated-home.json") as {matches:{round:number;home:string;away:string;score:string}[]};
 const season:OfficialLeagueSeason={id:"anfa-tercera-a-2026",name:"Muestra real ANFA",season:2026,sourceUrl:sample.matches[0] ? "https://anfaterceradivision.cl/assets/php/calendario_ta.php" : "",format:"round-robin",
  teams:[{name:sample.matches[0].home},{name:sample.matches[0].away}],
  matchdays:sample.matches.map(m=>({number:m.round,matches:[{id:`real-j${m.round}`,homeTeamName:m.home,awayTeamName:m.away,homeGoals:Number(m.score.split("-")[0]),awayGoals:Number(m.score.split("-")[1])}]}))};
 const save=vi.fn();await expect(importOfficialTournament({fetchSeason:async()=>season},{findAll:()=>[],save,saveWithActivity:save},undefined,"tercera-a")).rejects.toThrow(/localía|repetido|duplicad/i);
 expect(save).not.toHaveBeenCalled();
});
it.each(["season","duplicate","roster"] as const)("rejects a synthetic %s inconsistency introduced into a captured season before saving",async(kind)=>{
 const source=read("argentina-apertura-2026.json") as OfficialLeagueSeason;
 let data:OfficialLeagueSeason=source;
 if(kind==="season")data={...source,season:2027};
 if(kind==="duplicate")data={...source,matchdays:source.matchdays.map((day,i)=>i?day:{...day,matches:[...day.matches,day.matches[0]]})};
 if(kind==="roster"){const names=[...new Set(source.matchdays.flatMap(day=>day.matches.flatMap(m=>[m.homeTeamName,m.awayTeamName])))];data={...source,teams:names.slice(1).map(name=>({name}))};}
 const save=vi.fn();await expect(importOfficialTournament({fetchSeason:async()=>data},{findAll:()=>[],save,saveWithActivity:save},undefined,"argentina-primera")).rejects.toThrow();expect(save).not.toHaveBeenCalled();
});

it("retains the published dates and UTC offset of real continental fixtures",async()=>{
 const sample=read("espn-continental-schedule.json") as {events:{id:string;date:string}[]};
 vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({events:sample.events}))));
 const {EspnContinentalCupSource}=await import("./espn-continental-cup-source");
 const season=await new EspnContinentalCupSource().fetchSeason("sudamericana");
 for(const event of sample.events){const match=season.matchdays.flatMap(d=>d.matches).find(m=>m.id===event.id);
  expect(match?.schedule).toEqual({date:event.date.slice(0,10),time:event.date.slice(11,16),utcOffset:"Z"});}
});
