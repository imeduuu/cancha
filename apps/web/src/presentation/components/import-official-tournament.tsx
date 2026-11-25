import { useLibraryWrite } from "../library-write-context";
import { SourceIncidentsPanel } from "./source-incidents-panel";
import { useRef, useState } from "react";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import type {
  OfficialLeagueId,
  OfficialLeagueSeason,
  OfficialLeagueZone,
} from "@cancha/core/application/ports/official-league-source";
import type { TournamentRepository } from "@cancha/core/application/ports/tournament-repository";
import {
  importOfficialSeason,
  type ImportConflictResolution,
} from "@cancha/core/application/use-cases/import-official-tournament";
import { loadOfficialLeagueSource } from "../../infrastructure/external-services/load-official-league-source";
import { ConfirmationDialog } from "./confirmation-dialog";

import { NACIONAL_RULES_URL, SERIE_B_RULES_URL } from "@cancha/core/domain/services/second-division-rules";

/**
 * Aviso para una fuente que hoy no publica datos. El botón sigue activo: si la
 * fuente vuelve con el mismo formato, se importa sin publicar otra versión.
 */
interface SourceAvailability {
  readonly status: "unavailable";
  readonly label: string;
  readonly note: string;
}

const anfaMaintenance: SourceAvailability = {
  status: "unavailable",
  label: "Fuente en mantenimiento",
  note: "Desde noviembre de 2026, el sitio de ANFA Tercera División está en mantenimiento y no publica calendarios. "
    + "Puedes intentar importar igual (funcionará cuando el sitio vuelva) o crear el torneo manualmente.",
};

const officialLeagues = [
  { id: "argentina-nacional", title: "Primera Nacional Argentina 2026",
    description: "Dos zonas, final por el primer ascenso y Torneo Reducido.",
    sourceUrl: "https://www.espn.com/soccer/fixtures/_/league/arg.2",
    sourceName: "ESPN (proveedor externo)", rulesUrl: NACIONAL_RULES_URL },
  { id: "brasil-serie-b", title: "Brasileirão Série B 2026",
    description: "38 jornadas, dos ascensos directos y dos playoffs a ida y vuelta.",
    sourceUrl: "https://www.espn.com/soccer/fixtures/_/league/bra.2",
    sourceName: "ESPN (proveedor externo)", rulesUrl: SERIE_B_RULES_URL },
  {
    id: "primera",
    title: "Liga de Primera 2026",
    description: "Calendario y resultados de la máxima categoría.",
    sourceUrl: "https://www.campeonatochileno.cl/ligas/liga-de-primera-mercado-libre/",
    sourceName: "Campeonato Chileno",
  },
  {
    id: "copa-chile",
    title: "Copa Chile 2026",
    description: "Fase de grupos, octavos y cuartos de final publicados.",
    sourceUrl: "https://www.campeonatochileno.cl/competition/copa-chile-coca-cola-zero-azucar/",
    sourceName: "Campeonato Chileno",
    rulesUrl: "https://www.anfp.cl/bases/",
  },
  {
    id: "copa-liga",
    title: "Copa de la Liga 2026",
    description: "Grupos, semifinales y final publicados por Campeonato Chileno.",
    sourceUrl: "https://www.campeonatochileno.cl/competition/copa-de-la-liga/",
    sourceName: "Campeonato Chileno",
  },
  {
    id: "primera-b",
    title: "Primera B · Ascenso 2026",
    description: "Calendario de 30 fechas de la fase regular.",
    sourceUrl: "https://www.campeonatochileno.cl/competition/campeonato-de-ascenso-caixun-2026/",
    sourceName: "Campeonato Chileno",
    basesUrl: "https://www.anfp.cl/wp-content/uploads/2026/01/Bases-Primera-B-2026_VF_1.pdf",
  },
  {
    id: "segunda",
    title: "Segunda División 2026",
    description: "Elige la zona que quieres importar y trabajar.",
    sourceUrl: "https://www.campeonatochileno.cl/competition/liga-de-segunda-division-panini/",
    sourceName: "Campeonato Chileno",
    basesUrl: "https://www.anfp.cl/wp-content/uploads/2026/03/Bases-Segunda-Division-2026-2.pdf",
    zones: [
      { id: "ascenso", label: "Zona de Ascenso" },
      { id: "descenso", label: "Zona de Descenso" },
    ],
  },
  {
    id: "tercera-a",
    title: "Tercera A Nacional 2026",
    description: "Calendario y resultados oficiales de la categoría nacional.",
    sourceUrl: "https://anfaterceradivision.cl/assets/php/perfil_campeonato_ta.php",
    sourceName: "ANFA Tercera División",
    availability: anfaMaintenance,
  },
  {
    id: "tercera-b",
    title: "Tercera B 2026",
    description: "Elige la zona norte o sur que quieres importar y trabajar.",
    sourceUrl: "https://anfaterceradivision.cl/assets/php/calendario.php",
    sourceName: "ANFA Tercera División",
    availability: anfaMaintenance,
    zones: [
      { id: "norte", label: "Zona Norte" },
      { id: "sur", label: "Zona Sur" },
    ],
  },
  {
    id: "argentina-primera",
    title: "Primera División Argentina 2026",
    description: "Temporada anual con Apertura, Clausura y sus fases finales.",
    sourceUrl: "https://www.espn.com/soccer/fixtures/_/league/arg.1",
    sourceName: "ESPN (API pública)",
  },
  {
    id: "copa-argentina",
    title: "Copa Argentina 2026",
    description: "Fixture oficial por ronda, con resultados y definiciones por penales.",
    sourceUrl: "https://www.copaargentina.org/es/fixture.html",
    sourceName: "Copa Argentina",
    rulesUrl: "https://www.copaargentina.org/es/el-reglamento.html",
  },
  {
    id: "brasil-primera",
    title: "Brasileirão Série A 2026",
    description: "Calendario y resultados; las fechas se organizan desde los cruces publicados.",
    sourceUrl: "https://www.espn.com/soccer/fixtures/_/league/bra.1",
    sourceName: "ESPN (API pública)",
  },
  {
    id: "copa-brasil",
    title: "Copa do Brasil 2026",
    description: "Fases y partidos publicados por la CBF, incluidos los resultados.",
    sourceUrl: "https://www.cbf.com.br/futebol-brasileiro/tabelas/copa-do-brasil/masculino/2026",
    sourceName: "CBF",
    rulesUrl: "https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/REC_Copa_do_Brasil_2026_7c91253458.pdf",
  },
  {
    id: "libertadores",
    title: "Copa Libertadores 2026",
    description: "Fases previas, grupos y eliminatorias continentales.",
    sourceUrl: "https://www.espn.com/soccer/fixtures/_/league/conmebol.libertadores",
    sourceName: "ESPN (API pública)",
  },
  {
    id: "sudamericana",
    title: "Copa Sudamericana 2026",
    description: "Primera fase, grupos, playoffs y eliminatorias.",
    sourceUrl: "https://www.espn.com/soccer/fixtures/_/league/conmebol.sudamericana",
    sourceName: "ESPN (API pública)",
  },
] satisfies Array<{
  id: OfficialLeagueId;
  title: string;
  description: string;
  sourceUrl: string;
  sourceName: string;
  basesUrl?: string;
  rulesUrl?: string;
  zones?: readonly { id: OfficialLeagueZone; label: string }[];
  availability?: SourceAvailability;
}>;

type OfficialLeague = (typeof officialLeagues)[number];
type CountryId = "chile" | "argentina" | "brasil" | "continental";

const countryNames: Readonly<Record<CountryId, string>> = {
  chile: "Chile",
  argentina: "Argentina",
  brasil: "Brasil",
  continental: "Continentales",
};

const countries: readonly { id: CountryId; name: string }[] = [
  { id: "chile", name: "Chile" },
  { id: "argentina", name: "Argentina" },
  { id: "brasil", name: "Brasil" },
  { id: "continental", name: "Continentales" },
];

const countryLeagueIds: Readonly<Record<CountryId, readonly OfficialLeagueId[]>> = {
  chile: ["primera", "copa-chile", "copa-liga", "primera-b", "segunda", "tercera-a", "tercera-b"],
  argentina: ["argentina-primera", "argentina-nacional", "copa-argentina"],
  brasil: ["brasil-primera", "brasil-serie-b", "copa-brasil"],
  continental: ["libertadores", "sudamericana"],
};

interface ImportRequest {
  league: OfficialLeague;
  zone?: OfficialLeagueZone;
}

interface PendingImportConflict {
  readonly request: ImportRequest;
  readonly season: OfficialLeagueSeason;
  readonly existing: Tournament;
}

function getImportLabel({ league, zone }: ImportRequest): string {
  const zoneLabel = league.zones?.find((option) => option.id === zone)?.label;
  return `${league.title}${zoneLabel ? ` · ${zoneLabel}` : ""}`;
}

interface ImportOfficialTournamentProps {
  repository: TournamentRepository;
  onImported: (tournament: Tournament) => void;
  onActivityChanged?: () => void;
}

export function ImportOfficialTournament({
  repository,
  onImported,
  onActivityChanged,
}: ImportOfficialTournamentProps) {
  const runWrite = useLibraryWrite();
  const [selectedCountry, setSelectedCountry] = useState<CountryId>("chile");
  const [loadingLeague, setLoadingLeague] = useState<OfficialLeagueId | null>(null);
  const [choosingZoneFor, setChoosingZoneFor] = useState<OfficialLeagueId | null>(null);
  const [errors, setErrors] = useState<Partial<Record<OfficialLeagueId, string>>>({});
  const [importMessages, setImportMessages] = useState<Partial<Record<OfficialLeagueId, string>>>({});
  const [progress, setProgress] = useState<Partial<Record<OfficialLeagueId, { current: number; total: number; label: string }>>>({});
  const [cancelAvailable, setCancelAvailable] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingImportConflict | null>(null);
  const visibleLeagues = officialLeagues.filter((league) =>
    countryLeagueIds[selectedCountry].includes(league.id),
  );

  async function performImport(
    { league, zone }: ImportRequest,
    knownSeason?: OfficialLeagueSeason,
    conflictResolution?: ImportConflictResolution,
  ) {
    if (loadingLeague) {
      return;
    }

    setErrors((current) => ({ ...current, [league.id]: undefined }));
    setImportMessages((current) => ({ ...current, [league.id]: undefined }));
    try {
      setLoadingLeague(league.id);
      const canCancel = league.id === "copa-brasil" || league.id === "tercera-a" || league.id === "tercera-b";
      const abortController = canCancel ? new AbortController() : null;
      controller.current = abortController;
      setCancelAvailable(Boolean(abortController));
      setProgress((current) => ({ ...current, [league.id]: undefined }));
      const source = await loadOfficialLeagueSource(league.id);
      const officialSeason = knownSeason ?? await source.fetchSeason(league.id, zone, abortController ? {
        signal: abortController.signal,
        onProgress: (value) => setProgress((current) => ({ ...current, [league.id]: value })),
      } : undefined);
      controller.current = null;
      setCancelAvailable(false);
      const existing = repository.findAll().find(({ id }) => id === officialSeason.id);
      if (existing && !conflictResolution) {
        setPendingConflict({ request: { league, zone }, season: officialSeason, existing });
        return;
      }
      const outcome = await runWrite(() => {
        try {
        const tournament = importOfficialSeason(officialSeason, repository, undefined,
          conflictResolution ? { conflictResolution } : {}, league.id);
        setChoosingZoneFor(null);
        onImported(tournament);
        return {ok: true as const};
        } catch (error) { return {ok: false as const, error}; }
      });
      if (!outcome.ok) throw outcome.error;
      setImportMessages((current) => ({
        ...current,
        [league.id]: officialSeason.coverage === "complete"
          ? "La fuente reportó calendario completo."
          : officialSeason.coverage === "partial"
            ? "La fuente reportó una importación parcial."
            : "La fuente no informa si el calendario publicado cubre toda la temporada.",
      }));
    } catch (caught) {
      if (controller.current?.signal.aborted) {
        setImportMessages((current) => ({ ...current, [league.id]: "Importación cancelada. No se guardaron cambios." }));
        return;
      }
      setErrors((current) => ({
        ...current,
        [league.id]: caught instanceof Error
          ? caught.message
          : `No se pudo importar ${league.title}.`,
      }));
    } finally {
      controller.current = null;
      setCancelAvailable(false);
      setLoadingLeague(null);
      onActivityChanged?.();
    }
  }

  function requestImport(league: OfficialLeague, zone?: OfficialLeagueZone) {
    if (loadingLeague) {
      return;
    }

    void performImport({ league, zone });
  }

  function resolveConflict(resolution: ImportConflictResolution) {
    if (!pendingConflict) return;
    const { request, season } = pendingConflict;
    setPendingConflict(null);
    void performImport(request, season, resolution);
  }

  return (
    <>
      <SourceIncidentsPanel repository={repository} onActivityChanged={onActivityChanged} />
      <section className="official-import" aria-label="Importar campeonatos">
      <div className="official-import-intro">
        <span className="eyebrow">TORNEOS DE SUDAMÉRICA</span>
        <h3>Importar campeonato</h3>
        <p>Elige un país o las competiciones continentales disponibles.</p>
      </div>
      <div className="country-selector" role="group" aria-label="País o categoría">
        {countries.map(({ id: countryId, name: countryName }) => (
          <button
            aria-pressed={selectedCountry === countryId}
            className={selectedCountry === countryId ? "country-option selected" : "country-option"}
            key={countryId}
            onClick={() => setSelectedCountry(countryId)}
            type="button"
          >
            {countryName}
          </button>
        ))}
      </div>
      <h4 className="country-league-heading">{countryNames[selectedCountry]} · Temporada 2026</h4>
      {visibleLeagues.map((league) => (
        <article className="official-league-import" key={league.id}>
          <div>
            <h4>{league.title}</h4>
            <p>{league.description}</p>
          </div>
          {"availability" in league && league.availability && (
            <div className="rules-verification-note official-import-availability" role="note">
              <strong>{league.availability.label}</strong>
              <p>{league.availability.note}</p>
            </div>
          )}
          <button
            className="official-import-button"
            type="button"
            onClick={() => {
              if (league.zones) {
                setChoosingZoneFor((current) => current === league.id ? null : league.id);
              } else {
                requestImport(league);
              }
            }}
            disabled={loadingLeague !== null}
          >
            {loadingLeague === league.id
              ? `Consultando ${league.sourceName.split(" ")[0]}…`
              : choosingZoneFor === league.id
                ? "Cancelar selección"
                : "availability" in league
                  ? "Intentar importar"
                  : "Importar / actualizar"}
          </button>
          {league.zones && choosingZoneFor === league.id && (
            <div
              className="official-zone-options"
              role="group"
              aria-label={`Elige la zona de ${league.title}`}
            >
              <span>
                {league.id === "segunda"
                  ? "Se importará la fase y tabla de la zona por separado."
                  : "Cada zona se guardará como un campeonato independiente."}
              </span>
              {league.zones.map((zone) => (
                <button
                  className="small-action"
                  key={zone.id}
                  type="button"
                  disabled={loadingLeague !== null}
                  onClick={() => requestImport(league, zone.id)}
                >
                  {zone.label}
                </button>
              ))}
            </div>
          )}
          {loadingLeague === league.id && progress[league.id] && (
            <div className="official-import-progress" role="status" aria-live="polite" aria-atomic="true">
              <span>{progress[league.id]!.label} · paso {progress[league.id]!.current} de {progress[league.id]!.total}</span>
              <progress value={progress[league.id]!.current} max={progress[league.id]!.total} aria-label="Progreso de importación" />
            </div>
          )}
          {loadingLeague === league.id && cancelAvailable && (
            <button className="small-action" type="button" onClick={() => controller.current?.abort()}>Cancelar importación</button>
          )}
          {errors[league.id] && (
            <p className="field-error official-import-error" role="alert">{errors[league.id]}</p>
          )}
          {importMessages[league.id] && (
            <p className="official-import-source" role="status">
              Importación guardada · {importMessages[league.id]}
            </p>
          )}
          <span className="official-import-source">
            Fuente:{" "}
            <a href={league.sourceUrl} target="_blank" rel="noreferrer">
              {league.sourceName} ↗
            </a>
            {league.basesUrl && (
              <>
                {" "}·{" "}
                <a href={league.basesUrl} target="_blank" rel="noreferrer">
                  Bases ANFP 2026 ↗
                </a>
              </>
            )}
            {league.rulesUrl && (
              <>
                {" "}·{" "}
                <a href={league.rulesUrl} target="_blank" rel="noreferrer">
                  Reglamento oficial ↗
                </a>
              </>
            )}
          </span>
        </article>
      ))}
      </section>
      {pendingConflict && (
        <ConfirmationDialog
          open
          title={`La temporada ${pendingConflict.season.season} ya está guardada`}
          description={`${pendingConflict.existing.name} coincide con la temporada publicada de ${getImportLabel(pendingConflict.request)}. Elige qué hacer antes de incorporarla.`}
          warning="Actualizar conservando resultados mantiene los marcadores guardados para partidos con el mismo identificador y participantes. Reemplazar sobrescribe esos resultados. Los partidos que ya no pertenezcan al calendario nuevo no se conservan."
          confirmLabel="Cancelar importación"
          alternateActions={[
            { label: "Guardar como copia", onSelect: () => resolveConflict("copy") },
            {
              label: "Actualizar y conservar marcadores",
              onSelect: () => resolveConflict("update-preserving-results"),
            },
            { label: "Reemplazar todos los datos", onSelect: () => resolveConflict("replace") },
          ]}
          onCancel={() => setPendingConflict(null)}
          onConfirm={() => setPendingConflict(null)}
        />
      )}
    </>
  );
}
