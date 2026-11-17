// Prueba de humo del build de core: Node puro (sin Vite ni condición "source")
// debe resolver @cancha/core/* hacia dist/*.js y poder ejecutar casos de uso.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const modules = readdirSync(dist, { recursive: true })
  .filter(file => file.endsWith(".js"))
  .map(file => relative(dist, join(dist, file)).replaceAll("\\", "/").replace(/\.js$/, ""));

for (const module of modules) await import(`@cancha/core/${module}`);

const resolved = import.meta.resolve("@cancha/core/application/use-cases/create-tournament");
if (!resolved.includes("/dist/")) throw new Error(`@cancha/core no resolvió a dist/: ${resolved}`);

const { createTournament } = await import("@cancha/core/application/use-cases/create-tournament");
const { calculateStandings } = await import("@cancha/core/domain/services/standings");
const saved = [];
const repository = {
  findAll: () => [...saved],
  save: tournament => saved.push(tournament),
  saveWithActivity: tournament => saved.push(tournament),
};
const tournament = createTournament(
  { name: "Humo", teamNames: ["Club A", "Club B", "Club C", "Club D"], legs: 1, tieBreakers: ["goalDifference"] },
  repository,
);
const standings = calculateStandings(tournament);
if (saved.length !== 1 || standings.length !== 4) throw new Error("La prueba de humo de core en Node falló.");

console.log(`core dist OK: ${modules.length} módulos importados desde Node ${process.version}.`);
