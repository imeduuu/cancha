export function normalizeTeamName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es");
}

export function cleanTeamName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ");
}
