import { createServer } from "vite";
import { JSDOM } from "jsdom";
import { writeFile, mkdir } from "node:fs/promises";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const dom = new JSDOM("");
globalThis.DOMParser = dom.window.DOMParser;
const nativeFetch = globalThis.fetch;
const requests = new Map();
// Cómo llegan las consultas a las fuentes sin CORS (ESPN va siempre directo):
//   --via=direct (por defecto)  a los sitios oficiales, sin proxy;
//   --via=proxy                 a través de @cancha/official-source-proxy en este proceso (misma política que la API, sin levantarla);
//   --via=api[=URL]             a través de la API (CANCHA_API_URL o http://127.0.0.1:3000): prueba el despliegue real.
const [via, viaUrl] = (process.argv.find(arg => arg.startsWith("--via="))?.slice(6) ?? "direct").split(/=(.*)/s);
if (!["direct", "proxy", "api"].includes(via)) throw new Error(`--via debe ser direct, proxy o api[=URL] (se recibió "${via}").`);
const { officialSourceTargets, createOfficialSourceProxy } = await server.ssrLoadModule("@cancha/official-source-proxy");
const sources = via === "proxy" ? createOfficialSourceProxy({ rateLimit: 0, fetch: nativeFetch }) : undefined;
const apiBase = via === "api" ? (viaUrl || process.env.CANCHA_API_URL || "http://127.0.0.1:3000").replace(/\/+$/, "") : undefined;
const cache = new Map();
/** URL real de la consulta y si pasa por el proxy en este proceso. */
function target(input) {
  const path = String(input);
  for (const [prefix, host] of Object.entries(officialSourceTargets)) {
    if (!path.startsWith(prefix + "/")) continue;
    if (via === "api") return { url: apiBase + path };
    if (via === "proxy") return { url: path, inProcess: true };
    return { url: host + path.slice(prefix.length) };
  }
  return { url: path };
}
function lowerCaseHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers instanceof Headers ? Object.fromEntries(headers) : headers).map(([name, value]) => [name.toLowerCase(), String(value)]));
}
function summarize(body) {
  try {
    const data = JSON.parse(body);
    const events = data.events;
    if (!Array.isArray(events)) return { type: "json", keys: Object.keys(data).slice(0,15) };
    const teams = new Set(), ids = new Set(), phases = {}, statuses = {}, years = {}, pendingTeams = [];
    let duplicateIds = 0;
    for (const e of events) {
      if (ids.has(e.id)) duplicateIds++; ids.add(e.id);
      const phase = e.season?.slug ?? "unknown"; phases[phase] = (phases[phase] ?? 0) + 1;
      const year = String(e.season?.year ?? "unknown"); years[year] = (years[year] ?? 0) + 1;
      const c = e.competitions?.[0];const status = c?.status?.type?.name ?? "unknown";statuses[status] = (statuses[status] ?? 0) + 1;
      for (const entry of c?.competitors ?? []) { const name = entry.team?.displayName; if (name) teams.add(name); if (/^(TBD|To Be Determined)\b/i.test(name ?? "")) pendingTeams.push(name); }
    }
    return { type:"scoreboard", events:events.length, teams:teams.size, duplicateIds, phases, statuses, years, pendingTeams:[...new Set(pendingTeams)] };
  } catch {
    const doc = new dom.window.DOMParser().parseFromString(body,"text/html");
    return { type:"text/html", title:doc.title, matchNodes:doc.querySelectorAll("[data-match-id]").length,
      tables:doc.querySelectorAll("table").length, roundSelectors:doc.querySelectorAll("select").length,
      hasCbfPhases:body.includes("phasesList"), hasArgentinaFeed:body.includes("editions.json") };
  }
}
globalThis.fetch = async (input, init = {}) => {
  const { url, inProcess } = target(input);const key = url + JSON.stringify(init.headers ?? {});
  if (!cache.has(key)) cache.set(key,(async()=>{
    const record = { url, via: inProcess || apiBase && url.startsWith(apiBase) ? via : "direct", startedAt:new Date().toISOString() };requests.set(key,record);
    try {
      const response = inProcess
        ? await sources.respond({ method: "GET", url, headers: lowerCaseHeaders(init.headers) }).then(r => new Response(r.body, { status: r.status, headers: r.headers }))
        : await nativeFetch(url,{...init,signal:AbortSignal.timeout(25000)});
      const sourceCache = response.headers.get("x-cancha-source-cache");
      const body = await response.text();Object.assign(record,{status:response.status,finalUrl:response.url || url,bytes:Buffer.byteLength(body),...(sourceCache ? {sourceCache} : {}),...summarize(body)});
      return { body, status:response.status,headers:response.headers };
    } catch(error) {record.error=String(error)+(error.cause ? `: ${String(error.cause)}` : "");throw error;}
  })());
  const value=await cache.get(key);return new Response(value.body,{status:value.status,headers:value.headers});
};
const competitions = [
 ["argentina-primera"],["argentina-nacional"],["brasil-primera"],["brasil-serie-b"],
 ["libertadores"],["sudamericana"],["copa-argentina"],["copa-brasil"],
 ["primera"],["primera-b"],["segunda","ascenso"],["segunda","descenso"],["copa-chile"],["copa-liga"],
 ["tercera-a"],["tercera-b","norte"],["tercera-b","sur"],
];
const results=[];
const only = process.argv.find(arg=>arg.startsWith("--only="))?.slice(7).split(",");

try {
 const { loadOfficialLeagueSource } = await server.ssrLoadModule("/src/infrastructure/external-services/load-official-league-source.ts");
 const { importOfficialTournament } = await server.ssrLoadModule("@cancha/core/application/use-cases/import-official-tournament");
 for (const [league,zone] of competitions) {
  if (only && !only.includes(league)) continue;
  const result={league,zone,checkedAt:new Date().toISOString()};results.push(result);
  const activity = [];
  try {
   const source=await loadOfficialLeagueSource(league);
   const season=await source.fetchSeason(league,zone);
   const matches=season.matchdays.flatMap(day=>day.matches);
   Object.assign(result,{adapter:"passed",season:season.season,source:season.sourceName,sourceUrl:season.sourceUrl,
     teams:new Set([...(season.teams?.map(t=>t.name)??[]),...matches.flatMap(m=>[m.homeTeamName,m.awayTeamName])]).size,
     publishedMatches:matches.length,phases:[...new Set(season.matchdays.map(d=>d.phaseName??"Sin fase"))],
     groups:[...new Set([...(season.teams?.map(t=>t.groupName).filter(Boolean)??[]),...matches.flatMap(m=>[m.homeGroupName,m.awayGroupName]).filter(Boolean)])],
     matchesWithScore:matches.filter(m=>m.homeGoals!==undefined&&m.awayGoals!==undefined).length,
     matchesWithSchedule:matches.filter(m=>m.schedule?.date).length,
     matchesByPhase:season.matchdays.reduce((acc,day)=>{const phase=day.phaseName??"Sin fase";acc[phase]=(acc[phase]??0)+day.matches.length;return acc;},{}),
     duplicateIds:matches.length-new Set(matches.map(m=>m.id)).size,
     statuses:matches.reduce((acc,m)=>{const s=m.operationalStatus??"not-published";acc[s]=(acc[s]??0)+1;return acc;},{}),coverage:season.coverage??"unknown"});
   result.conflicts=season.matchdays.flatMap(day=>{
    const seen=new Set();return day.matches.flatMap(m=>{const duplicated=seen.has(m.homeTeamName)||seen.has(m.awayTeamName)||m.homeTeamName===m.awayTeamName;seen.add(m.homeTeamName);seen.add(m.awayTeamName);return duplicated?[{phase:day.phaseName,number:day.number,match:m}]:[];});
   }).slice(0,10);
   const repository={findAll:()=>[],save:()=>{},saveWithActivity:()=>{},findActivity:()=>activity,recordActivity:event=>activity.push(event)};
   const imported=await importOfficialTournament(source,repository,undefined,league,zone,{seasonData:season});
   const importedFixtures=imported.matchdays.flatMap(day=>day.fixtures);
   result.changedPublishedMatches=matches.flatMap(m=>{const f=importedFixtures.find(f=>f.id===`official-${season.season}-${m.id}`);const home=f&&imported.teams.find(t=>t.id===f.homeTeamId)?.name;const away=f&&imported.teams.find(t=>t.id===f.awayTeamId)?.name;return !f||home!==m.homeTeamName||away!==m.awayTeamName||JSON.stringify(f.result??null)!==JSON.stringify(m.homeGoals===undefined?null:{homeGoals:m.homeGoals,awayGoals:m.awayGoals,...(m.extraTime?{extraTime:m.extraTime}:{}),...(m.penalties?{penalties:m.penalties}:{})})?[{published:m,imported:f??null}]:[];});
   Object.assign(result,{import:"passed",importedTeams:imported.teams.length,importedMatches:imported.matchdays.flatMap(d=>d.fixtures).length});
  } catch(error) {result.error=error instanceof Error ? error.message : String(error);result.import="failed";}
  result.sourceIncidents=activity.filter(e=>e.action==="source-incident-reviewed").map(e=>e.after);
  console.log(JSON.stringify(result));
 }
} finally {
 globalThis.fetch=nativeFetch;dom.window.close();await server.close();
 await mkdir("docs",{recursive:true});
 process.exitCode=results.some(r=>r.import!=="passed"||r.changedPublishedMatches?.length)?1:0;
 await writeFile(process.argv.find(arg=>arg.startsWith("--output="))?.slice(9) ?? "../../docs/live-importers-results.json",JSON.stringify({checkedAt:new Date().toISOString(),via,...(apiBase ? {api:apiBase} : {}),libraryAccess:"none; isolated in-memory repository",results,requests:[...requests.values()]},null,2)+"\n");
}
