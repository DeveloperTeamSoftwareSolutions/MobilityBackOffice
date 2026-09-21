import { useEffect, useRef, useState } from 'react';

interface Props {
  orderNumber: string;
  /** Para decirle a quién le vuelve la orden. */
  sellerEmail: string | null;
  saving: boolean;
  error: string | null;
  onConfirm: (reasonNotes: string) => void;
  onCancel: () => void;
}

/** El mismo tope que acepta el middleware. */
const MAX_REASON = 500;

/**
 * Confirmación del rechazo de la orden.
 *
 * Confirmar importa porque **no se deshace**: `Rejected` es terminal y no hay botón que
 * reabra la orden, ni acá ni del lado del vendedor. Por eso el modal dice las tres cosas
 * que cambian —se cierra, vuelve al vendedor, sólo puede copiarla— antes de pedir el
 * motivo, y no después.
 *
 * **El motivo es obligatorio y por eso el botón arranca apagado.** El estado que le llega
 * al vendedor dice "Rechazada" y nada más —igual que un rechazo de Créditos—, así que el
 * comentario del hilo es el único lugar donde va a poder leer quién la rechazó y por qué.
 * Un rechazo sin motivo es una orden que muere en silencio.
 */
export function RejectOrderModal({
  orderNumber,
  sellerEmail,
  saving,
  error,
  onConfirm,
  onCancel,
}: Props) {
  const [reason, setReason] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const motivo = reason.trim();

  useEffect(() => {
    // El foco arranca en Cancelar, no en el campo: la acción destructiva no debe quedar
    // a un Enter de distancia.
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, saving]);

  return (
    <div
      className="bo-rs__modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bo-rs-reject-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onCancel();
      }}
    >
      <div className="bo-rs__modal">
        <h2 id="bo-rs-reject-title" className="bo-rs__modal-title">
          Rechazar {orderNumber}
        </h2>

        <p className="bo-rs__modal-text">
          Se cierra la orden: no se va a poder corregir ni enviar a SAP, ni desde acá ni
          desde MobilityIA.
        </p>

        <ul className="bo-rs__gi-effects">
          <li className="bo-rs__gi-effect bo-rs__gi-effect--danger">
            <strong>No se puede deshacer.</strong> La orden queda en estado Rechazada y no
            hay forma de reabrirla.
          </li>
          <li className="bo-rs__gi-effect">
            Le vuelve al vendedor{sellerEmail ? ` (${sellerEmail})` : ''} como{' '}
            <strong>Rechazada</strong>. Lo único que va a poder hacer es copiarla, que abre
            una orden nueva con el mismo cliente y las mismas líneas.
          </li>
          <li className="bo-rs__gi-effect">
            La orden sale de la bandeja de pendientes y queda registrada en las resueltas,
            con tu nombre y la fecha.
          </li>
        </ul>

        <label className="bo-rs__field">
          {/* No dice "Motivo del rechazo" a secas: el detalle ya tiene un bloque
              "Motivo del rechazo de SAP" —el error que devolvió SAP— y son dos cosas
              distintas. Ese lo escribió SAP; éste lo escribe BackOffice. */}
          <span className="bo-rs__label">Por qué se rechaza (obligatorio)</span>
          <input
            type="text"
            className="bo-rs__input"
            maxLength={MAX_REASON}
            value={reason}
            disabled={saving}
            placeholder="Por qué no se puede resolver esta orden"
            onChange={(e) => setReason(e.target.value)}
          />
          <span className="bo-rs__cell-sub">
            Es lo <strong>único</strong> que el vendedor va a leer sobre el rechazo: el
            estado sólo dice "Rechazada". Queda en el hilo de la orden y en la auditoría.
          </span>
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
            Cancelar
          </button>
          <button
            type="button"
            className="bo-rs__button bo-rs__button--danger"
            disabled={saving || motivo.length === 0}
            title={motivo.length === 0 ? 'Escribí el motivo para poder rechazar' : undefined}
            onClick={() => onConfirm(motivo)}
          >
            {saving ? 'Rechazando…' : 'Sí, rechazar la orden'}
          </button>
        </div>
      </div>
    </div>
  );
}
