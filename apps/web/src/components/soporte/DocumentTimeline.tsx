import { useState } from 'react';
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

/** Orden de lectura de la bitácora. */
export type TimelineOrder = 'asc' | 'desc';

const ORDER_KEY = 'bo_sp_timeline_order';

/**
 * Preferencia guardada del orden.
 *
 * Va en `localStorage` porque es una comodidad de lectura por persona, no un dato del
 * negocio: quien audita seguido prefiere ver lo último arriba, y no tiene sentido que
 * lo cambie en cada documento. El acceso va en try/catch porque en una ventana privada
 * o con las cookies bloqueadas `localStorage` puede lanzar excepción, y eso no debe
 * romper la línea de tiempo.
 */
export function loadOrderPreference(): TimelineOrder {
  try {
    return localStorage.getItem(ORDER_KEY) === 'desc' ? 'desc' : 'asc';
  } catch {
    return 'asc';
  }
}

function saveOrderPreference(order: TimelineOrder): void {
  try {
    localStorage.setItem(ORDER_KEY, order);
  } catch {
    /* Sin persistencia, la preferencia dura lo que la sesión. No es un error. */
  }
}

interface Props {
  events: TimelineEvent[];
  /** Cuando está activo se muestran también las consultas (quién miró el documento). */
  includeViews: boolean;
}

/**
 * Línea de tiempo del documento: el "caminito" completo, del alta al cierre.
 *
 * Los eventos vienen ya ordenados y fundidos por el middleware. Lo único que hace la
 * UI es poder **invertirlos**: quien audita seguido suele querer lo último arriba.
 * No reordena por criterio propio ni deduplica — dar vuelta la lista es exacto y
 * preserva el desempate del alta que resuelve el middleware.
 *
 * `source` se muestra en cada hito porque es lo que permite a soporte saber de qué
 * tabla salió el dato cuando algo no cierra.
 */
export function DocumentTimeline({ events, includeViews }: Props) {
  const [order, setOrder] = useState<TimelineOrder>(loadOrderPreference);

  function cambiarOrden(next: TimelineOrder) {
    setOrder(next);
    saveOrderPreference(next);
  }

  if (events.length === 0) {
    return (
      <p className="bo-sp__empty">
        El documento no tiene hitos registrados.
        {!includeViews && ' Probá activar las consultas para ver quién lo miró.'}
      </p>
    );
  }

  // La lista llega ordenada del más viejo al más nuevo desde el middleware. Darla
  // vuelta es exacto: incluye el desempate del alta, que en descendente queda última.
  const visibles = order === 'desc' ? [...events].reverse() : events;

  return (
    <>
      <div className="bo-sp__timeline-head">
        <span className="bo-sp__timeline-count">
          {events.length} {events.length === 1 ? 'hito' : 'hitos'}
        </span>
        <div className="bo-sp__order">
          <button
            type="button"
            className={`bo-sp__order-button ${order === 'asc' ? 'bo-sp__order-button--active' : ''}`}
            onClick={() => cambiarOrden('asc')}
            aria-pressed={order === 'asc'}
          >
            Más antiguos primero
          </button>
          <button
            type="button"
            className={`bo-sp__order-button ${order === 'desc' ? 'bo-sp__order-button--active' : ''}`}
            onClick={() => cambiarOrden('desc')}
            aria-pressed={order === 'desc'}
          >
            Más recientes primero
          </button>
        </div>
      </div>

      {/*
        Cada hito ocupa UNA fila. Antes eran cinco renglones apilados (tipo, hora,
        título, actor, origen) y veinte hitos no entraban en la pantalla, aunque
        sobraba ancho a los costados. Ahora todo eso va en la misma línea y el
        detalle —que la mayoría de los hitos no tiene— baja solo cuando existe.
      */}
      <ol className="bo-sp__timeline">
        {visibles.map((event, index) => (
        <li
          key={`${event.at}-${event.kind}-${index}`}
          className={`bo-sp__event bo-sp__event--${KIND_LABEL[event.kind] ? event.kind : 'other'}`}
        >
          <div className="bo-sp__event-marker" aria-hidden="true" />
          <div className="bo-sp__event-body">
            <div className="bo-sp__event-row">
              <span className="bo-sp__event-kind">
                {KIND_LABEL[event.kind] ?? event.kind}
              </span>
              <span className="bo-sp__event-title">{event.title}</span>
              {/*
                Quién, de dónde salió el dato y cuándo van agrupados en UN bloque
                pegado al margen derecho. Sueltos parecían tres datos flotando entre
                filas, y con los hitos juntos no se sabía a cuál pertenecía cada uno.
              */}
              <span className="bo-sp__event-meta">
                {/*
                  El actor NO se trunca. Antes se cortaba a 260px y una dirección
                  larga terminaba en puntos suspensivos, justo en el dato que soporte
                  necesita leer entero. El rol va en su propio `span` para que, si no
                  entra al lado del mail, baje debajo por el salto natural de línea en
                  vez de comerse el texto.
                */}
                <span className="bo-sp__event-who">
                  {event.actorEmail ?? 'Sin actor registrado'}
                  {event.actorRole && (
                    <span className="bo-sp__event-role">
                      {ROLE_LABEL[event.actorRole] ?? event.actorRole}
                    </span>
                  )}
                </span>
                {/*
                  El origen es de qué tabla salió el dato: soporte lo necesita solo
                  cuando algo no cierra, así que va atenuado y al final.
                */}
                {event.source && (
                  <span className="bo-sp__event-source">{event.source}</span>
                )}
                <time className="bo-sp__event-time" dateTime={event.at}>
                  {formatDateTimeWithSeconds(event.at)}
                </time>
              </span>
            </div>

            {event.detail && (
              <p className="bo-sp__event-detail">{event.detail}</p>
            )}
          </div>
        </li>
        ))}
      </ol>
    </>
  );
}
