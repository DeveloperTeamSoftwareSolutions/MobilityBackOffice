import { useEffect, useRef } from 'react';
import { ResendResult } from './revision-sap.types';
import { SapErrorMessage } from './SapErrorMessage';

interface Props {
  orderNumber: string;
  /** Cambios sin guardar: se reenviaría sin ellos. */
  pendingChanges: number;
  /** Productos con un aviso que impide enviar. */
  blocking: number;
  groupInvoice: boolean;
  sending: boolean;
  /** Resultado del envío; mientras es `null`, el modal pregunta. */
  result: ResendResult | null;
  /** Falla de transporte: ni siquiera sabemos qué pasó en SAP. */
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirmación del reenvío a SAP, y después el resultado.
 *
 * Confirmar importa porque esto **crea un pedido real en SAP**: no es un borrador que
 * se pueda deshacer desde acá. El mismo modal muestra después qué contestó SAP, en vez
 * de un toast que se va: el número de pedido es el dato que BackOffice necesita copiar,
 * y el motivo del rechazo es lo que hay que leer para corregir.
 */
export function ResendModal({
  orderNumber,
  pendingChanges,
  blocking,
  groupInvoice,
  sending,
  result,
  error,
  onConfirm,
  onClose,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !sending) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  const titulo = result
    ? result.accepted
      ? 'SAP aceptó la orden'
      : result.skipped
        ? 'No se envió a SAP'
        : 'SAP rechazó la orden'
    : `Reenviar ${orderNumber} a SAP`;

  return (
    <div
      className="bo-rs__modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bo-rs-resend-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
    >
      <div className="bo-rs__modal">
        <h2 id="bo-rs-resend-title" className="bo-rs__modal-title">
          {titulo}
        </h2>

        {/* ---- Antes de enviar: qué va a pasar ---- */}
        {!result && !error && (
          <>
            <p className="bo-rs__modal-text">
              Se manda la orden completa. SAP decide: si la acepta, crea el pedido y la
              orden sale de la bandeja; si la rechaza, vuelve acá con el motivo nuevo.
            </p>
            <ul className="bo-rs__gi-effects">
              <li className="bo-rs__gi-effect bo-rs__gi-effect--warn">
                <strong>Crea un pedido real en SAP.</strong> No se puede deshacer desde
                BackOffice: si sale mal, se resuelve en SAP.
              </li>
              {pendingChanges > 0 && (
                <li className="bo-rs__gi-effect bo-rs__gi-effect--warn">
                  Tenés {pendingChanges === 1 ? '1 cambio sin guardar' : `${pendingChanges} cambios sin guardar`}:
                  se reenviaría <strong>sin</strong> esos cambios. Guardalos primero.
                </li>
              )}
              {blocking > 0 && (
                <li className="bo-rs__gi-effect bo-rs__gi-effect--warn">
                  {blocking === 1 ? '1 producto necesita corrección' : `${blocking} productos necesitan corrección`}:
                  SAP lo va a volver a rechazar.
                </li>
              )}
              <li className="bo-rs__gi-effect">
                {groupInvoice
                  ? 'Agrupa factura está en Sí: si alguna línea no tiene stock, no se envía nada y rebota completa.'
                  : 'Las líneas sin stock se dejan afuera y el resto se envía igual.'}
              </li>
            </ul>
          </>
        )}

        {/* ---- Falla de transporte: el pedido PUDO haberse creado ---- */}
        {error && (
          <>
            <p className="bo-rs__error">{error}</p>
            <p className="bo-rs__modal-text">
              No reintentes sin mirar: si el pedido alcanzó a crearse, volver a enviar lo
              duplicaría.
            </p>
          </>
        )}

        {/* ---- Resultado ---- */}
        {result && (
          <>
            {result.accepted && (
              <dl className="bo-rs__stock-kpis">
                <div>
                  <dt>N° de pedido</dt>
                  <dd>{result.sapOrderNumber ?? '—'}</dd>
                </div>
                <div>
                  <dt>N° de entrega</dt>
                  <dd>{result.sapDispatchNumber ?? '—'}</dd>
                </div>
                <div>
                  <dt>Productos enviados</dt>
                  <dd>{result.itemsSent}</dd>
                </div>
              </dl>
            )}

            {result.accepted && !result.sapDispatchNumber && (
              <p className="bo-rs__warning bo-rs__warning--blocking">
                SAP creó el pedido pero <strong>no devolvió el N° de entrega</strong>: la
                mercadería no se despacha. La entrega se resuelve en SAP; la orden sigue
                en revisión.
              </p>
            )}

            {result.skipped && (
              <p className="bo-rs__modal-text">
                {result.skippedReason ?? 'El envío no llegó a SAP.'}
              </p>
            )}

            {!result.accepted && !result.skipped && <SapErrorMessage error={result.error} />}

            {result.filteredItemsCount > 0 && (
              <p className="bo-rs__warning">
                Se dejaron afuera {result.filteredItemsCount === 1
                  ? '1 producto sin stock'
                  : `${result.filteredItemsCount} productos sin stock`}: se envió el resto.
              </p>
            )}

            <p className="bo-rs__modal-text">
              {result.stillInReview
                ? 'La orden sigue en la bandeja de revisión.'
                : 'La orden salió de la bandeja: la revisión quedó cerrada.'}
            </p>
          </>
        )}

        <div className="bo-rs__modal-actions">
          <button
            ref={closeRef}
            type="button"
            className="bo-rs__button bo-rs__button--ghost"
            disabled={sending}
            onClick={onClose}
          >
            {result || error ? 'Cerrar' : 'Cancelar'}
          </button>
          {!result && !error && (
            <button type="button" className="bo-rs__button" disabled={sending} onClick={onConfirm}>
              {sending ? 'Enviando a SAP…' : 'Sí, reenviar a SAP'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
