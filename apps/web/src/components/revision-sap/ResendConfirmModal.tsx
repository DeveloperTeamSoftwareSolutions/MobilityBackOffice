import { useEffect, useRef } from 'react';

interface Props {
  orderNumber: string;
  itemCount: number;
  /** Una por cada centro distinto de las líneas. */
  sapOrderCount: number;
  onClose: () => void;
}

/**
 * Confirmación del reenvío. El reenvío todavía no está conectado: el botón de
 * confirmar queda deshabilitado y el modal lo dice, para que nadie crea que la orden
 * salió.
 */
export function ResendConfirmModal({ orderNumber, itemCount, sapOrderCount, onClose }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="bo-rs__modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bo-rs-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bo-rs__modal">
        <h2 id="bo-rs-modal-title" className="bo-rs__modal-title">
          Reenviar {orderNumber} a SAP
        </h2>
        <p className="bo-rs__modal-text">
          Se reenvía con los centros y destinos guardados de sus{' '}
          {itemCount === 1 ? 'ítem' : `${itemCount} ítems`}
          {sapOrderCount > 1 ? `, en ${sapOrderCount} órdenes SAP (una por centro)` : ''}.
        </p>
        <p className="bo-rs__preview">
          El reenvío a SAP todavía no está conectado: falta que el envío parta la orden por
          centro, que avise los ítems sin stock antes de enviar y que no pueda duplicar
          pedidos.
        </p>
        <div className="bo-rs__modal-actions">
          <button
            ref={cancelRef}
            type="button"
            className="bo-rs__button bo-rs__button--ghost"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button type="button" className="bo-rs__button" disabled>
            Confirmar reenvío
          </button>
        </div>
      </div>
    </div>
  );
}
