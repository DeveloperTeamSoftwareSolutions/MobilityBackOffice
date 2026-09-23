import { useEffect, useMemo, useRef, useState } from 'react';
import { NoSaleReason, ReviewItem } from './revision-sap.types';

interface Props {
  item: ReviewItem;
  /** Motivos activos del catálogo. Vacío mientras se cargan o si el catálogo falló. */
  reasons: NoSaleReason[];
  reasonsLoading: boolean;
  reasonsError: string | null;
  /**
   * Es la ÚLTIMA línea activa de la orden. Cancelarla deja el envío sin nada que mandar,
   * así que el modal cambia de tono: avisa y ofrece el camino correcto.
   */
  esLaUltima: boolean;
  saving: boolean;
  error: string | null;
  onConfirm: (reasonCode: string, reasonNotes: string | null) => void;
  onCancel: () => void;
  /** Abre el rechazo de la orden, que es lo que corresponde si no va a salir nada. */
  onRejectOrder: () => void;
}

/** El mismo tope que acepta el middleware. */
const MAX_REASON = 500;

/**
 * Cancelar una línea con motivo de no venta.
 *
 * **El motivo es obligatorio y sale del catálogo**, no es texto libre: el código es lo que
 * hace comparables las pérdidas entre órdenes —cuántas líneas se cayeron por precio,
 * cuántas por stock—. La nota explica el caso puntual y no lo reemplaza.
 *
 * La línea no desaparece: queda en la tabla, tachada y con su motivo. Por eso el modal lo
 * dice antes de confirmar — si no, "cancelar" se lee como "borrar".
 *
 * **Cancelar la última línea activa es otra cosa** y el modal lo trata distinto: sin
 * líneas el envío no tiene nada que mandar y va a rebotar. En ese caso avisa y ofrece
 * "Rechazar orden", que es la acción que realmente cierra el documento y le avisa al
 * vendedor. No lo prohíbe: quien quiera cancelarlas todas puede, pero sabiendo.
 */
export function CancelItemModal({
  item,
  reasons,
  reasonsLoading,
  reasonsError,
  esLaUltima,
  saving,
  error,
  onConfirm,
  onCancel,
  onRejectOrder,
}: Props) {
  const [reasonCode, setReasonCode] = useState('');
  const [notes, setNotes] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);

  const ordenados = useMemo(
    () =>
      [...reasons].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.label.localeCompare(b.label),
      ),
    [reasons],
  );

  useEffect(() => {
    // El foco arranca en Cancelar: no dejamos la acción a un Enter de distancia.
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, saving]);

  const nota = notes.trim();
  const puedeConfirmar = !saving && reasonCode !== '';

  return (
    <div
      className="bo-rs__modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bo-rs-cancel-item-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onCancel();
      }}
    >
      <div className="bo-rs__modal">
        <h2 id="bo-rs-cancel-item-title" className="bo-rs__modal-title">
          Cancelar línea {item.lineNumber}
        </h2>

        <p className="bo-rs__modal-text">
          <strong>{item.productCode}</strong>
          {item.productDescription ? ` · ${item.productDescription}` : ''}
        </p>

        <ul className="bo-rs__gi-effects">
          <li className="bo-rs__gi-effect">
            <strong>No se envía a SAP.</strong> Queda fuera del próximo envío; el resto de
            la orden sigue su curso.
          </li>
          <li className="bo-rs__gi-effect">
            La línea <strong>no desaparece</strong>: sigue acá, tachada y con su motivo, y
            el motivo queda en el hilo de la orden.
          </li>
          <li className="bo-rs__gi-effect">
            Se puede reactivar <strong>mientras no se haya reenviado</strong>. Después de
            un envío ya no, porque ese envío salió sin ella.
          </li>
        </ul>

        {esLaUltima && (
          <div className="bo-rs__warning bo-rs__warning--blocking">
            <p>
              <strong>Es la última línea que queda.</strong> Si la cancelás, el envío no va
              a tener nada que mandar: "Reenviar a SAP" va a rebotar sin crear ningún
              pedido.
            </p>
            <p>
              Si lo que querés es dar de baja la orden entera, usá{' '}
              <button
                type="button"
                className="bo-rs__link-button"
                disabled={saving}
                onClick={onRejectOrder}
              >
                Rechazar orden
              </button>
              : cierra el documento y le avisa al vendedor con el motivo.
            </p>
          </div>
        )}

        <label className="bo-rs__field">
          <span className="bo-rs__label">Motivo de no venta (obligatorio)</span>
          <select
            className="bo-rs__select"
            value={reasonCode}
            disabled={saving || reasonsLoading || ordenados.length === 0}
            onChange={(e) => setReasonCode(e.target.value)}
          >
            <option value="">
              {reasonsLoading ? 'Cargando motivos…' : 'Elegí un motivo'}
            </option>
            {ordenados.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
          <span className="bo-rs__cell-sub">
            Es el mismo catálogo que usa MobilityIA: el motivo elegido acá se puede comparar
            con el de cualquier otra orden.
          </span>
        </label>

        {reasonsError && <p className="bo-rs__error">{reasonsError}</p>}

        <label className="bo-rs__field">
          <span className="bo-rs__label">Aclaración (opcional)</span>
          <input
            type="text"
            className="bo-rs__input"
            maxLength={MAX_REASON}
            value={notes}
            disabled={saving}
            placeholder="Lo puntual de este caso, si hace falta"
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        {error && <p className="bo-rs__error">{error}</p>}

        <div className="bo-rs__modal-actions">
          <button
            ref={cancelRef}
            type="button"
            className="bo-rs__button bo-rs__button--ghost"
            disabled={saving}
            onClick={onCancel}
          >
            Volver
          </button>
          <button
            type="button"
            className="bo-rs__button bo-rs__button--danger"
            disabled={!puedeConfirmar}
            title={reasonCode === '' ? 'Elegí el motivo para poder cancelar' : undefined}
            onClick={() => onConfirm(reasonCode, nota || null)}
          >
            {saving ? 'Cancelando…' : 'Cancelar la línea'}
          </button>
        </div>
      </div>
    </div>
  );
}
