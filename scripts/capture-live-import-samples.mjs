import {JSDOM} from "jsdom";
import {writeFile} from "node:fs/promises";
const base="src/test-utils/fixtures/live/";
const anfaUrl="https://anfaterceradivision.cl/assets/php/calendario_ta.php?j=26";
const anfaResponse=await fetch(anfaUrl,{signal:AbortSignal.timeout(25000)});
if(!anfaResponse.ok)throw new Error(`ANFA HTTP ${anfaResponse.status}`);
const dom=new JSDOM(await anfaResponse.text());
const row=[...dom.window.document.querySelectorAll("tr")].find(row=>/Futuro/.test(row.textContent)&&/Oriente/.test(row.textContent));
if(!row)throw new Error("No se encontró la muestra ANFA");
const cells=[...row.querySelectorAll(":scope > td")];
const sample={sourceUrl:anfaUrl,capturedAt:new Date().toISOString(),round:Number(cells[0].textContent.trim()),
 home:cells[1].querySelector(".team-cell strong").textContent.trim(),score:cells[2].querySelector(".resultado-box").textContent.trim(),away:cells[3].querySelector(".team-cell strong").textContent.trim()};
await writeFile(base+"anfa-pending.json",JSON.stringify(sample,null,2)+"\n");dom.window.close();
function arrayAfter(body,index){const marker=body.lastIndexOf('"data":',index);const start=body.indexOf("[",marker);let depth=0,string=false,escaped=false;
 for(let i=start;i<body.length;i++){const c=body[i];if(string){if(escaped)escaped=false;else if(c==="\\")escaped=true;else if(c==='"')string=false;}else if(c==='"')string=true;else if(c==="[")depth++;else if(c==="]"&&--depth===0)return JSON.parse(body.slice(start,i+1));}throw new Error("Lista CBF incompleta");}
const samples=[];
for(const id of ["1996","1997"]){const url=`https://www.cbf.com.br/futebol-brasileiro/tabelas/copa-do-brasil/masculino/2026/${id}`;
 const response=await fetch(url,{headers:{RSC:"1"},signal:AbortSignal.timeout(25000)});if(!response.ok)throw new Error(`CBF HTTP ${response.status}`);
 const body=await response.text();const records=arrayAfter(body,body.indexOf('"id_jogo"'));
 const cleanTeam=team=>({id:team.id,nome:team.nome,gols:team.gols,panaltis:team.panaltis});
 const matches=records.filter(m=>m.mandante?.nome?.startsWith("Oper")||m.visitante?.nome?.startsWith("Oper"))
  .map(m=>({id_jogo:m.id_jogo,rodada:m.rodada,mandante:cleanTeam(m.mandante),visitante:cleanTeam(m.visitante)}));
 samples.push({sourceUrl:url,phaseId:id,matches});
}
await writeFile(base+"cbf-homonyms.json",JSON.stringify({capturedAt:new Date().toISOString(),samples},null,2)+"\n");
console.log(JSON.stringify({anfa:sample,cbf:samples}));

const aggregateUrl="https://www.cbf.com.br/futebol-brasileiro/tabelas/copa-do-brasil/masculino/2026/1999";
const aggregateResponse=await fetch(aggregateUrl,{headers:{RSC:"1"},signal:AbortSignal.timeout(25000)});
if(!aggregateResponse.ok)throw new Error(`CBF HTTP ${aggregateResponse.status}`);
const aggregateBody=await aggregateResponse.text();const aggregateGames=arrayAfter(aggregateBody,aggregateBody.indexOf('"id_jogo"'));
const second=aggregateGames.find(m=>Number(m.rodada)===2&&Number(m.mandante.gols)!==Number(m.visitante.gols)&&(Number(m.mandante.panaltis)>0||Number(m.visitante.panaltis)>0));
if(!second)throw new Error("No se encontró una vuelta con penales por global");
const first=aggregateGames.find(m=>Number(m.rodada)===1&&m.mandante.id===second.visitante.id&&m.visitante.id===second.mandante.id);
const cleanMatch=m=>({id_jogo:m.id_jogo,rodada:m.rodada,mandante:{id:m.mandante.id,nome:m.mandante.nome,gols:m.mandante.gols,panaltis:m.mandante.panaltis},visitante:{id:m.visitante.id,nome:m.visitante.nome,gols:m.visitante.gols,panaltis:m.visitante.panaltis}});
await writeFile(base+"cbf-aggregate-penalties.json",JSON.stringify({sourceUrl:aggregateUrl,capturedAt:new Date().toISOString(),matches:[first,second].map(cleanMatch)},null,2)+"\n");
const repeated=[];
for(const round of [10,23]){
 const url=`https://anfaterceradivision.cl/assets/php/calendario_ta.php?j=${round}`;
 const response=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!response.ok)throw new Error(`ANFA HTTP ${response.status}`);
 const page=new JSDOM(await response.text());
 const row=[...page.window.document.querySelectorAll("table.table-striped.table-responsive.table-hover")][0];
 const match=[...row.querySelectorAll("tbody tr")].find(row=>/Cabrero/.test(row.textContent)&&/Agu/.test(row.textContent));
 if(!match)throw new Error("No se encontró la localía repetida");
 const cells=[...match.querySelectorAll(":scope > td")];
 repeated.push({sourceUrl:url,round,home:cells[1].querySelector(".team-cell strong").textContent.trim(),score:cells[2].querySelector(".resultado-box").textContent.trim(),away:cells[3].querySelector(".team-cell strong").textContent.trim()});page.window.close();
}
await writeFile(base+"anfa-repeated-home.json",JSON.stringify({capturedAt:new Date().toISOString(),matches:repeated},null,2)+"\n");
console.log(JSON.stringify({aggregate:[first,second].map(cleanMatch),repeated}));

const espnUrl="https://site.api.espn.com/apis/site/v2/sports/soccer/conmebol.sudamericana/scoreboard?dates=2026&limit=1000";
const espnResponse=await fetch(espnUrl,{signal:AbortSignal.timeout(25000)});if(!espnResponse.ok)throw new Error(`ESPN HTTP ${espnResponse.status}`);
const scoreboard=await espnResponse.json();
const selected=[scoreboard.events.find(e=>e.season?.slug==="group-stage"),scoreboard.events.find(e=>e.competitions?.[0]?.status?.type?.state==="pre")].filter(Boolean);
const events=selected.map(e=>({id:e.id,date:e.date,season:e.season,competitions:e.competitions.slice(0,1).map(c=>({status:c.status,...(c.leg?{leg:c.leg}:{}),...(c.group?{group:c.group}:{}),competitors:c.competitors.map(t=>({homeAway:t.homeAway,team:{id:t.team.id,displayName:t.team.displayName},...(t.score!==undefined?{score:t.score}:{}),...(t.shootoutScore!==undefined?{shootoutScore:t.shootoutScore}:{})}))}))}));
await writeFile(base+"espn-continental-schedule.json",JSON.stringify({sourceUrl:espnUrl,capturedAt:new Date().toISOString(),events},null,2)+"\n");
console.log(JSON.stringify({continentalEvents:events.length}));
