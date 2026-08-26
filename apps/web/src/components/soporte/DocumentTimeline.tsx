import { TimelineEvent } from './soporte.types';
import { formatDateTimeWithSeconds } from './DocumentHeader';

/**
 * Kinds que la UI colorea. Cualquier otro (incluidos los que el middleware sume
 * más adelante) cae en el estilo neutro sin romper nada.
 */
const KIND_LABEL: Readonly<Record<string, string>> = {
  created: 'Alta',
  edited: 'Edición',
  sent: 'Envío',
  status: 'Cambio de estado',
  milestone: 'Decisión',
  message: 'Mensaje',
  resolution: 'Resolución',
  credit: 'Crédito',
  payment: 'Pago',
  cancelled: 'Anulación',
};

/** Rol del actor → etiqueta legible. */
const ROLE_LABEL: Readonly<Record<string, string>> = {
  seller: 'Vendedor',
  manager: 'Gerente',
  credit: 'Créditos',
  system: 'Sistema',
};

interface Props {
  events: TimelineEvent[];
  /** Cuando está activo se muestran también las consultas (quién miró el documento). */
  includeViews: boolean;
}

/**
 * Línea de tiempo del documento: el "caminito" completo, del alta al cierre.
 *
 * Los eventos vienen ya ordenados y fundidos por el middleware — la UI no reordena
 * ni deduplica, solo presenta. `source` se muestra en cada hito porque es lo que
 * permite a soporte saber de qué tabla salió el dato cuando algo no cierra.
 */
export function DocumentTimeline({ events, includeViews }: Props) {
  if (events.length === 0) {
    return (
      <p className="bo-sp__empty">
        El documento no tiene hitos registrados.
        {!includeViews && ' Probá activar las consultas para ver quién lo miró.'}
      </p>
    );
  }

  return (
    <ol className="bo-sp__timeline">
      {events.map((event, index) => (
        <li
          key={`${event.at}-${event.kind}-${index}`}
          className={`bo-sp__event bo-sp__event--${KIND_LABEL[event.kind] ? event.kind : 'other'}`}
        >
          <div className="bo-sp__event-marker" aria-hidden="true" />
          <div className="bo-sp__event-body">
            <div className="bo-sp__event-head">
              <span className="bo-sp__event-kind">
                {KIND_LABEL[event.kind] ?? event.kind}
              </span>
              <time className="bo-sp__event-time" dateTime={event.at}>
                {formatDateTimeWithSeconds(event.at)}
              </time>
            </div>

            <p className="bo-sp__event-title">{event.title}</p>

            {event.detail && (
              <p className="bo-sp__event-detail">{event.detail}</p>
            )}

            <p className="bo-sp__event-actor">
              {event.actorEmail ?? 'Sin actor registrado'}
              {event.actorRole
                ? ` · ${ROLE_LABEL[event.actorRole] ?? event.actorRole}`
                : ''}
            </p>

            {event.source && (
              <p className="bo-sp__event-source">Origen: {event.source}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
