import type { CompleteLibrary } from "../application/services/save-checkpoints";
import type { SaveCheckpointStore } from "../application/ports/save-checkpoint-store";
import type { SaveCheckpoint } from "../domain/entities/save-checkpoint";

export function checkpointLibrary(): CompleteLibrary {
  return {
    tournaments: ["one", "two", "unassigned"].map(id => ({id, name: `Liga ${id}`, season: 2026, format: "round-robin" as const,
      teams: [{id: "a", name: "Club homónimo"}, {id: "b", name: "Otro club"}], legs: 1, tieBreakers: ["goalDifference" as const],
      createdAt: "2026-01-01T00:00:00Z", calendarProvenance: "official-import" as const,
      matchdays: [{number: 1, leg: 1, fixtures: [{id: `f-${id}`, homeTeamId: "a", awayTeamId: "b", result: {homeGoals: 2, awayGoals: 1}}]}],
    })),
    activity: [{id: "event-one", action: "match-result-updated", tournamentId: "one", tournamentName: "Liga one", universeId: "u-one",
      occurredAt: "2026-01-01T00:00:00Z", entityId: "f-one", entityType: "match", summary: "Resultado manual", after: {homeGoals: 2, awayGoals: 1}}],
    universes: {version: 1, activeUniverseId: "u-one", universes: [{id: "u-one", name: "Partida uno"}, {id: "u-two", name: "Partida dos"}],
      assignments: {one: "u-one", two: "u-two"}},
  };
}
export function testClone<T>(value: T): T { return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T; }
/** Application test double only. Browser tests use native IndexedDB. */
export class MemoryCheckpointStore implements SaveCheckpointStore {
  readonly records = new Map<string, unknown>();
  async list(): Promise<unknown[]> { return [...this.records.values()].map(testClone); }
  async get(id: string): Promise<unknown> { return testClone(this.records.get(id)); }
  async add(record: SaveCheckpoint): Promise<void> {
    if (this.records.has(record.id)) throw new DOMException("ID duplicado", "ConstraintError");
    this.records.set(record.id, testClone(record));
  }
  async replace(id: string, expected: unknown, record: SaveCheckpoint): Promise<void> {
    this.assertExpected(id, expected);this.records.set(id, testClone(record));
  }
  async delete(id: string, expected: unknown): Promise<void> { this.assertExpected(id, expected);this.records.delete(id); }
  private assertExpected(id: string, expected: unknown) {
    if (!this.records.has(id) || JSON.stringify(this.records.get(id)) !== JSON.stringify(expected)) throw new Error("El punto cambió o fue eliminado.");
  }
  async exclusive<T>(action: () => Promise<T>): Promise<T> { return action(); }
}
