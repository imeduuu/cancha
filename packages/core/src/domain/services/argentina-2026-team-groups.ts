import { normalizeTeamName } from "./team-name";

const teamNamesByGroup = {
  "Zona A": [
    "Platense",
    "Defensa y Justicia",
    "Central Córdoba (Santiago del Estero)",
    "Lanús",
    "Deportivo Riestra",
    "Talleres (Córdoba)",
    "Boca Juniors",
    "Estudiantes de La Plata",
    "Instituto (Córdoba)",
    "Gimnasia (Mendoza)",
    "San Lorenzo",
    "Independiente",
    "Newell's Old Boys",
    "Unión (Santa Fe)",
    "Vélez Sarsfield",
  ],
  "Zona B": [
    "Argentinos Juniors",
    "Aldosivi",
    "Atlético Tucumán",
    "Banfield",
    "Barracas Central",
    "Belgrano (Córdoba)",
    "River Plate",
    "Gimnasia La Plata",
    "Estudiantes de Río Cuarto",
    "Independiente Rivadavia",
    "Huracán",
    "Racing Club",
    "Rosario Central",
    "Sarmiento (Junín)",
    "Tigre",
  ],
} as const;

const teamGroupPairs: readonly (readonly [string, "Zona A" | "Zona B"])[] = [
  ...teamNamesByGroup["Zona A"].map((teamName) => [teamName, "Zona A"] as const),
  ...teamNamesByGroup["Zona B"].map((teamName) => [teamName, "Zona B"] as const),
];
const groupByTeamName = new Map(
  teamGroupPairs.map(([teamName, groupName]) => [normalizeTeamName(teamName), groupName]),
);

export function getArgentina2026TeamGroup(teamName: string): "Zona A" | "Zona B" | undefined {
  return groupByTeamName.get(normalizeTeamName(teamName));
}
