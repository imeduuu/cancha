import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../domain/entities/activity-event";
import type { Tournament } from "../domain/entities/tournament";
import type { AsyncTournamentLibraryRepository } from "../application/ports/async-tournament-repository";
import type { TournamentLibraryRepository } from "../application/ports/tournament-repository";
import { createActivityEvent } from "../application/services/activity-log";
import { createTournament } from "../application/use-cases/create-tournament";
import { closureLeague } from "./season-closure-fixtures";

/**
 * Suite de contrato de la biblioteca de torneos: lo que cualquier adaptador
 * (localStorage, MongoDB…) debe cumplir para que los casos de uso funcionen igual.
 * Acepta el puerto síncrono y el asíncrono: todas las llamadas se esperan con await.
 *
 * Los fallos se provocan sólo con entradas inválidas (torneo que no supera la
 * integridad, evento inválido, lista vacía o con ids repetidos), así que la suite
 * no necesita inyectar errores de almacenamiento y sirve para cualquier adaptador.
 */
export type ContractRepository = TournamentLibraryRepository | AsyncTournamentLibraryRepository;

export interface TournamentRepositoryContractHarness {
  /** Un repositorio sobre un almacén nuevo y vacío (se llama antes de cada caso). */
  create(): ContractRepository | Promise<ContractRepository>;
  /** Otra instancia sobre el mismo almacén que el último `create()`. */
  reopen(): ContractRepository | Promise<ContractRepository>;
}

export const tournamentRepositoryContractCases = {
  emptyLibrary: "una biblioteca nueva está vacía",
  roundTrip: "save + findAll devuelven el torneo idéntico, incluidos resultados y programación",
  updateInPlace: "guardar otra vez el mismo id lo actualiza sin duplicarlo",
  persistence: "torneos e historial persisten en otra instancia sobre el mismo almacén",
  invalidSave: "save rechaza un torneo inválido y no escribe nada",
  saveWithActivity: "saveWithActivity guarda el torneo y su evento juntos",
  saveWithActivityAtomic: "saveWithActivity no deja escrituras parciales si el evento o el torneo son inválidos",
  saveManyWithActivity: "saveManyWithActivity guarda todos los torneos y un solo evento",
  saveManyAtomic: "saveManyWithActivity con un torneo inválido no guarda ninguno ni el evento",
  saveManyRejectsBadSelection: "saveManyWithActivity rechaza una selección vacía o con ids repetidos",
  recordActivity: "recordActivity agrega eventos en orden y no duplica un id ya registrado",
  deleteById: "deleteById elimina el torneo y registra tournament-deleted; un id inexistente falla",
  activeTournament: "el torneo activo se guarda, se borra con null y persiste",
} as const;

export type TournamentRepositoryContractCase = keyof typeof tournamentRepositoryContractCases;

export interface TournamentRepositoryContractOptions {
  /**
   * Casos que el adaptador no cumple, con el motivo. Se omiten (it.skip) y el
   * motivo queda en el nombre de la prueba para que el informe lo muestre.
   */
  readonly knownGaps?: Partial<Record<TournamentRepositoryContractCase, string>>;
}

type Awaitable<T> = T | Promise<T>;
/** Vista común de ambos puertos: cada método puede devolver un valor o una promesa. */
interface AnyRepository {
  save(tournament: Tournament): Awaitable<void>;
  findAll(): Awaitable<Tournament[]>;
  saveWithActivity?(tournament: Tournament, event: ActivityEvent): Awaitable<void>;
  saveManyWithActivity?(tournaments: readonly Tournament[], event: ActivityEvent): Awaitable<void>;
  recordActivity?(event: ActivityEvent): Awaitable<void>;
  findActivity?(): Awaitable<ActivityEvent[]>;
  deleteById(id: string): Awaitable<void>;
  getActiveTournamentId(): Awaitable<string | null>;
  setActiveTournamentId(id: string | null): Awaitable<void>;
}

function required<K extends "saveWithActivity" | "saveManyWithActivity" | "recordActivity" | "findActivity">(
  repository: AnyRepository,
  method: K,
): NonNullable<AnyRepository[K]> {
  const implementation = repository[method];
  if (!implementation) throw new Error(`El repositorio no implementa ${method}, que el contrato exige.`);
  return implementation.bind(repository) as NonNullable<AnyRepository[K]>;
}

/** Torneo válido de 4 equipos con un resultado y una programación cargados. */
export function contractTournament(id: string, name = `Torneo ${id}`): Tournament {
  let created: Tournament | undefined;
  const capture = {
    findAll: () => [],
    save: () => {},
    saveWithActivity: (tournament: Tournament) => { created = tournament; },
  };
  createTournament(
    { name, teamNames: ["Club Uno", "Club Dos", "Club Tres", "Club Cuatro"], legs: 1, tieBreakers: ["goalDifference"] },
    capture,
    () => new Date("2026-03-01T12:00:00.000Z"),
  );
  const base = created!;
  const [first, ...rest] = base.matchdays;
  const [played, scheduled, ...others] = first.fixtures;
  return {
    ...base,
    id,
    matchdays: [{
      ...first,
      fixtures: [
        { ...played, result: { homeGoals: 2, awayGoals: 1 } },
        { ...scheduled, schedule: { date: "2026-03-08", time: "18:30", venue: "Estadio Municipal" } },
        ...others,
      ],
    }, ...rest],
  };
}

function invalid(tournament: Tournament): Tournament {
  return { ...tournament, name: " " };
}

function contractEvent(tournament: Tournament, summary = `Se actualizó "${tournament.name}".`): ActivityEvent {
  return createActivityEvent(tournament, { action: "regulations-updated", entityType: "tournament", summary });
}

function byId(tournaments: readonly Tournament[]): Record<string, Tournament> {
  return Object.fromEntries(tournaments.map(tournament => [tournament.id, tournament]));
}

export function describeTournamentRepositoryContract(
  adapterName: string,
  harness: TournamentRepositoryContractHarness,
  options: TournamentRepositoryContractOptions = {},
): void {
  const open = async () => (await harness.create()) as AnyRepository;
  const reopen = async () => (await harness.reopen()) as AnyRepository;
  const contractCase = (key: TournamentRepositoryContractCase, test: () => Promise<void>) => {
    const gap = options.knownGaps?.[key];
    const title = tournamentRepositoryContractCases[key];
    if (gap) it.skip(`${title} [brecha conocida: ${gap}]`, test);
    else it(title, test);
  };

  describe(`Contrato de TournamentLibraryRepository: ${adapterName}`, () => {
    contractCase("emptyLibrary", async () => {
      const repository = await open();
      expect(await repository.findAll()).toEqual([]);
      expect(await required(repository, "findActivity")()).toEqual([]);
      expect(await repository.getActiveTournamentId()).toBeNull();
    });

    contractCase("roundTrip", async () => {
      const repository = await open();
      const built = contractTournament("contrato-a");
      const fixture = closureLeague("contrato-b");
      await repository.save(built);
      await repository.save(fixture);

      const stored = byId(await repository.findAll());
      expect(Object.keys(stored).sort()).toEqual(["contrato-a", "contrato-b"]);
      expect(stored["contrato-a"]).toEqual(built);
      expect(stored["contrato-b"]).toEqual(fixture);
    });

    contractCase("updateInPlace", async () => {
      const repository = await open();
      const tournament = contractTournament("contrato-a");
      await repository.save(tournament);
      await repository.save({ ...tournament, name: "Torneo renombrado" });

      const all = await repository.findAll();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe("Torneo renombrado");
    });

    contractCase("persistence", async () => {
      const repository = await open();
      const tournament = contractTournament("contrato-a");
      const event = contractEvent(tournament);
      await required(repository, "saveWithActivity")(tournament, event);

      const other = await reopen();
      expect(await other.findAll()).toEqual([tournament]);
      expect((await required(other, "findActivity")()).map(({ id }) => id)).toEqual([event.id]);
    });

    contractCase("invalidSave", async () => {
      const repository = await open();
      await expect(async () => repository.save(invalid(contractTournament("contrato-a"))))
        .rejects.toThrow(/^No se guardó/);
      expect(await repository.findAll()).toEqual([]);
    });

    contractCase("saveWithActivity", async () => {
      const repository = await open();
      const tournament = contractTournament("contrato-a");
      const event = contractEvent(tournament);
      await required(repository, "saveWithActivity")(tournament, event);

      expect(await repository.findAll()).toEqual([tournament]);
      const [stored] = await required(repository, "findActivity")();
      expect(stored).toMatchObject({
        id: event.id, action: "regulations-updated", tournamentId: "contrato-a", summary: event.summary,
      });
    });

    contractCase("saveWithActivityAtomic", async () => {
      const repository = await open();
      const original = contractTournament("contrato-a");
      const previousEvent = contractEvent(original, "Evento previo.");
      await required(repository, "saveWithActivity")(original, previousEvent);
      const saveWithActivity = required(repository, "saveWithActivity");
      const changed = { ...original, name: "Cambio que no debe quedar" };

      const badEvent = { ...contractEvent(changed), action: "accion-inexistente" } as unknown as ActivityEvent;
      await expect(async () => saveWithActivity(changed, badEvent)).rejects.toThrow();
      await expect(async () => saveWithActivity(invalid(changed), contractEvent(changed))).rejects.toThrow();

      expect(await repository.findAll()).toEqual([original]);
      expect((await required(repository, "findActivity")()).map(({ id }) => id)).toEqual([previousEvent.id]);
    });

    contractCase("saveManyWithActivity", async () => {
      const repository = await open();
      const tournaments = [contractTournament("contrato-a"), contractTournament("contrato-b")];
      const event = contractEvent(tournaments[0], "Temporadas vinculadas.");
      await required(repository, "saveManyWithActivity")(tournaments, event);

      expect(byId(await repository.findAll())).toEqual(byId(tournaments));
      expect((await required(repository, "findActivity")()).map(({ id }) => id)).toEqual([event.id]);
    });

    contractCase("saveManyAtomic", async () => {
      const repository = await open();
      const original = contractTournament("contrato-a");
      await repository.save(original);

      const failure = async () => required(repository, "saveManyWithActivity")(
        [{ ...original, name: "Cambio que no debe quedar" }, invalid(contractTournament("contrato-b"))],
        contractEvent(original),
      );
      await expect(failure).rejects.toThrow();

      expect(await repository.findAll()).toEqual([original]);
      expect(await required(repository, "findActivity")()).toEqual([]);
    });

    contractCase("saveManyRejectsBadSelection", async () => {
      const repository = await open();
      const tournament = contractTournament("contrato-a");
      const saveMany = required(repository, "saveManyWithActivity");

      await expect(async () => saveMany([], contractEvent(tournament))).rejects.toThrow();
      await expect(async () => saveMany([tournament, { ...tournament, name: "Duplicado" }], contractEvent(tournament)))
        .rejects.toThrow();

      expect(await repository.findAll()).toEqual([]);
      expect(await required(repository, "findActivity")()).toEqual([]);
    });

    contractCase("recordActivity", async () => {
      const repository = await open();
      const library = { id: "library", name: "Biblioteca" };
      const first = { ...contractEvent(contractTournament("contrato-a"), "Primero."), tournamentId: library.id, tournamentName: library.name };
      const second = { ...contractEvent(contractTournament("contrato-b"), "Segundo."), tournamentId: library.id, tournamentName: library.name };
      const record = required(repository, "recordActivity");

      await record(first);
      await record(second);
      await record(first);

      expect((await required(repository, "findActivity")()).map(({ summary }) => summary)).toEqual(["Primero.", "Segundo."]);
      expect(await repository.findAll()).toEqual([]);
    });

    contractCase("deleteById", async () => {
      const repository = await open();
      const kept = contractTournament("contrato-a");
      const removed = contractTournament("contrato-b", "Torneo a eliminar");
      await repository.save(kept);
      await repository.save(removed);

      await repository.deleteById("contrato-b");

      expect(await repository.findAll()).toEqual([kept]);
      const events = await required(repository, "findActivity")();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ action: "tournament-deleted", tournamentId: "contrato-b", tournamentName: "Torneo a eliminar" });
      await expect(async () => repository.deleteById("no-existe")).rejects.toThrow();
      expect(await repository.findAll()).toEqual([kept]);
    });

    contractCase("activeTournament", async () => {
      const repository = await open();
      const tournament = contractTournament("contrato-a");
      await repository.save(tournament);

      await repository.setActiveTournamentId("contrato-a");
      expect(await repository.getActiveTournamentId()).toBe("contrato-a");
      expect(await (await reopen()).getActiveTournamentId()).toBe("contrato-a");

      await repository.setActiveTournamentId(null);
      expect(await repository.getActiveTournamentId()).toBeNull();
      expect(await (await reopen()).getActiveTournamentId()).toBeNull();
    });
  });
}
