import type {ActivityEvent} from "@cancha/core/domain/entities/activity-event";
import {associationCatalog} from "@cancha/core/application/services/club-associations";
/** Catalog remains readable when its original tournament has been moved/deleted. */
export function ClubAssociationCatalog({activity,universeId}:{activity:readonly ActivityEvent[];universeId:string|null}){
  const catalog=associationCatalog(activity,universeId);
  return <section aria-label="Catálogo de asociaciones del universo"><h3>Asociaciones registradas</h3><p>La consulta conserva el universo declarado. Selecciona una temporada existente para registrar o corregir metadatos; no se crean participantes ni competiciones como soporte ficticio.</p>
    <ul>{catalog.map(entry=><li key={entry.id}><strong>{entry.current.association.name}</strong> · {entry.id} · revisión {entry.revision}{entry.ambiguous?" · identidad ambigua":""} · {entry.current.association.source?.url ?? "Declaración local"}<details><summary>Historial de la asociación ({entry.history.length})</summary><ul>{entry.history.map((r,i)=><li key={i}>Revisión {r.revision}: {r.association.name} · {r.association.source?.url} {r.association.source?.reference}</li>)}</ul></details></li>)}</ul>
    {!catalog.length && <p>Sin asociaciones registradas en este universo.</p>}
  </section>;
}
