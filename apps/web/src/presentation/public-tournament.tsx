import { useEffect, useState } from "react";
import { createGraphqlClient } from "../infrastructure/api/graphql-client";

type SharedTournament = { name: string; season?: number; standings: { position: number; teamName: string; points: number; played: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number }[]; matchdays: { number: number; phaseName?: string; fixtures: { homeTeamName: string; awayTeamName: string; result?: { homeGoals: number; awayGoals: number } }[] }[] };

export function PublicTournament({ token }: { readonly token: string }) {
  const [tournament, setTournament] = useState<SharedTournament | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void createGraphqlClient().request<{ publicTournament: SharedTournament | null }>(
      "query PublicTournament($token: String!) { publicTournament(token: $token) { name season standings { position teamName points played wins draws losses goalsFor goalsAgainst } matchdays { number phaseName fixtures { homeTeamName awayTeamName result { homeGoals awayGoals } } } } }",
      { token },
    ).then(result => { if (active) setTournament(result.publicTournament); }).catch(() => { if (active) setTournament(null); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);
  if (loading) return <main><p role="status">Cargando torneo…</p></main>;
  if (!tournament) return <main><h1>Enlace no disponible</h1><p>Este torneo no existe o el enlace fue revocado.</p></main>;
  const leader = tournament.standings[0];
  return <main className="public-tournament"><header><h1>{tournament.name}{tournament.season ? " · " + tournament.season : ""}</h1><p>Vista pública de solo lectura</p></header>
    <section><h2>Tabla</h2><div className="table-scroll"><table><thead><tr><th>Pos.</th><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>Pts</th></tr></thead><tbody>{tournament.standings.map(row => <tr key={row.position}><td>{row.position}</td><th>{row.teamName}</th><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.points}</td></tr>)}</tbody></table></div></section>
    {leader && <section><h2>Campeón provisional</h2><p>{leader.teamName}</p></section>}
    <section><h2>Partidos</h2>{tournament.matchdays.map((day, index) => <div key={day.number + "-" + index}><h3>{day.phaseName ?? "Jornada " + day.number}</h3><ul>{day.fixtures.map((fixture, fixtureIndex) => <li key={fixtureIndex}>{fixture.homeTeamName} {fixture.result ? fixture.result.homeGoals + "–" + fixture.result.awayGoals : "vs."} {fixture.awayTeamName}</li>)}</ul></div>)}</section>
  </main>;
}
