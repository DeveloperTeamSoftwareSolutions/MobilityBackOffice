import { useEffect, useRef } from 'react';
import { ItemChange, ReviewCatalogs } from './revision-sap.types';

interface Props {
  orderNumber: string;
  changes: ItemChange[];
  catalogs: ReviewCatalogs;
  onClose: () => void;
}

function centerText(code: string | null, catalogs: ReviewCatalogs): string {
  if (!code) return 'sin centro';
  const center = catalogs.centers.find((c) => c.centerCode === code);
  return center ? `${code} · ${center.centerName}` : code;
}

function destinationText(code: string | null, catalogs: ReviewCatalogs): string {
  if (!code) return 'sin destino';
  const destination = catalogs.destinations.find((d) => d.destinationCode === code);
  return destination ? `${code} · ${destination.destinationName}` : code;
}

/**
 * Confirmación del reenvío: muestra exactamente qué cambia antes de mandar la orden
 * de nuevo a SAP. En la vista previa el botón de confirmar queda deshabilitado.
 */
export function ResendConfirmModal({ orderNumber, changes, catalogs, onClose }: Props) {
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

        {changes.length === 0 ? (
          <p className="bo-rs__modal-text">
            No cambiaste ningún ítem. La orden se reenvía con los mismos centros y
            destinos con los que SAP la rechazó.
          </p>
        ) : (
          <>
            <p className="bo-rs__modal-text">
              {changes.length === 1
                ? 'Se reenvía con este cambio:'
                : `Se reenvía con estos ${changes.length} cambios:`}
            </p>
            <ul className="bo-rs__change-list">
              {changes.map(({ item, before, after }) => (
                <li key={item.guid} className="bo-rs__change">
                  <span className="bo-rs__cell--strong">
                    Línea {item.lineNumber} · {item.productCode}
                  </span>
                  {before.centerCode !== after.centerCode && (
                    <span className="bo-rs__change-detail">
                      Centro: {centerText(before.centerCode, catalogs)} →{' '}
                      <strong>{centerText(after.centerCode, catalogs)}</strong>
                    </span>
                  )}
                  {before.destinationCode !== after.destinationCode && (
                    <span className="bo-rs__change-detail">
                      Destino: {destinationText(before.destinationCode, catalogs)} →{' '}
                      <strong>{destinationText(after.destinationCode, catalogs)}</strong>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="bo-rs__preview">
          Vista previa: el reenvío a SAP todavía no está conectado.
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
