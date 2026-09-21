import { useEffect, useRef } from 'react';
import { ResendBucket, ResendResult } from './revision-sap.types';
import { SapErrorMessage } from './SapErrorMessage';

interface Props {
  orderNumber: string;
  /** Cambios sin guardar: se reenviaría sin ellos. */
  pendingChanges: number;
  /** Productos con un aviso que impide enviar. */
  blocking: number;
  groupInvoice: boolean;
  /** En cuántas órdenes SAP va a salir: una por centro distinto. */
  centersToSend: number;
  sending: boolean;
  /** Resultado del envío; mientras es `null`, el modal pregunta. */
  result: ResendResult | null;
  /** Falla de transporte: ni siquiera sabemos qué pasó en SAP. */
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** Cómo se llama cada desenlace. Mismas palabras que la pestaña "Órdenes SAP". */
const ESTADO: Record<ResendBucket['status'], { label: string; tone: 'ok' | 'warn' | 'danger' }> = {
  accepted: { label: 'Aceptada', tone: 'ok' },
  accepted_no_dispatch: { label: 'Aceptada sin entrega', tone: 'warn' },
  rejected: { label: 'Rechazada por SAP', tone: 'danger' },
  not_sent: { label: 'No se envió', tone: 'danger' },
};

/**
 * Confirmación del reenvío a SAP, y después el resultado.
 *
 * Confirmar importa porque esto **crea pedidos reales en SAP**: no son borradores que se
 * puedan deshacer desde acá. El mismo modal muestra después qué contestó SAP, en vez de
 * un toast que se va: los números de pedido son el dato que BackOffice necesita copiar, y
 * los motivos de rechazo son lo que hay que leer para corregir.
 *
 * **El resultado va POR CENTRO**, porque el envío parte la orden en una orden SAP por
 * centro de distribución. Un resumen único no alcanzaría: con tres centros puede que dos
 * salgan y uno no, y hace falta saber CUÁL falló para corregir sólo ese.
 */
export function ResendModal({
  orderNumber,
  pendingChanges,
  blocking,
  groupInvoice,
  centersToSend,
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
      ? result.totalBuckets === 1
        ? 'SAP aceptó la orden'
        : `SAP aceptó las ${result.totalBuckets} órdenes`
      : result.skipped
        ? 'No se envió a SAP'
        : result.partial
          ? 'SAP aceptó una parte'
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
      <div className="bo-rs__modal bo-rs__modal--wide">
        <h2 id="bo-rs-resend-title" className="bo-rs__modal-title">
          {titulo}
        </h2>

        {/* ---- Antes de enviar: qué va a pasar ---- */}
        {!result && !error && (
          <>
            <p className="bo-rs__modal-text">
              La orden sale <strong>partida por centro de distribución</strong>:{' '}
              {centersToSend === 1
                ? 'todas las líneas van juntas en una sola orden SAP.'
                : `se crean ${centersToSend} órdenes SAP, una por centro.`}{' '}
              SAP decide cada una por separado.
            </p>
            <ul className="bo-rs__gi-effects">
              <li className="bo-rs__gi-effect bo-rs__gi-effect--warn">
                <strong>
                  {centersToSend === 1
                    ? 'Crea un pedido real en SAP.'
                    : `Crea ${centersToSend} pedidos reales en SAP.`}
                </strong>{' '}
                No se puede deshacer desde BackOffice: si sale mal, se resuelve en SAP.
              </li>
              {centersToSend > 1 && (
                <li className="bo-rs__gi-effect bo-rs__gi-effect--warn">
                  Cada centro va por su cuenta: <strong>puede que unos salgan y otros no</strong>.
                  Los que salgan quedan creados en SAP igual.
                </li>
              )}
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

        {/* ---- Falla de transporte: los pedidos PUDIERON haberse creado ---- */}
        {error && (
          <>
            <p className="bo-rs__error">{error}</p>
            <p className="bo-rs__modal-text">
              No reintentes sin mirar: si alguno de los pedidos alcanzó a crearse, volver a
              enviar lo duplicaría.
            </p>
          </>
        )}

        {/* ---- Resultado ---- */}
        {result && (
          <>
            {/* El aviso más fuerte primero: parte de la orden YA está en SAP. */}
            {result.partial && (
              <p className="bo-rs__warning bo-rs__warning--blocking">
                <strong>
                  {result.acceptedBuckets === 1
                    ? '1 centro salió y '
                    : `${result.acceptedBuckets} centros salieron y `}
                  {result.failedBuckets === 1 ? '1 no.' : `${result.failedBuckets} no.`}
                </strong>{' '}
                Los pedidos que sí se crearon <strong>ya existen en SAP</strong>: no reenvíes
                la orden entera o se duplicarían. Corregí sólo los centros que fallaron.
              </p>
            )}

            {result.skipped && (
              <p className="bo-rs__modal-text">
                {result.skippedReason ?? 'El envío no llegó a SAP.'}
              </p>
            )}

            {result.buckets.length > 0 && (
              <ul className="bo-rs__resend-buckets">
                {result.buckets.map((b, i) => {
                  const estado = ESTADO[b.status];
                  return (
                    <li key={`${b.centerCode}-${i}`} className="bo-rs__resend-bucket">
                      <div className="bo-rs__resend-bucket-head">
                        <strong>Centro {b.centerCode}</strong>
                        <span className={`bo-rs__pill bo-rs__pill--${estado.tone}`}>
                          {estado.label}
                        </span>
                        <span className="bo-rs__cell--muted">
                          {b.itemsCount === 1 ? '1 producto' : `${b.itemsCount} productos`}
                        </span>
                      </div>

                      {(b.sapOrderNumber || b.sapDispatchNumber) && (
                        <div className="bo-rs__resend-bucket-nums">
                          <span>
                            Pedido <strong>{b.sapOrderNumber ?? '—'}</strong>
                          </span>
                          <span>
                            Entrega <strong>{b.sapDispatchNumber ?? '—'}</strong>
                          </span>
                        </div>
                      )}

                      {b.status === 'accepted_no_dispatch' && (
                        <p className="bo-rs__warning">
                          SAP creó el pedido pero <strong>no devolvió el N° de entrega</strong>:
                          la mercadería no se despacha. Se resuelve en SAP, no reenviando.
                        </p>
                      )}

                      {b.error && <SapErrorMessage error={b.error} />}
                    </li>
                  );
                })}
              </ul>
            )}

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
