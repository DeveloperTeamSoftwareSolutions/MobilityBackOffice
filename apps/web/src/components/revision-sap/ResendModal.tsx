import { useEffect, useRef } from 'react';
import { formatQuantity } from './revision-sap.logic';
import { ResendBucket, ResendPlan, ResendResult } from './revision-sap.types';
import { SapErrorMessage } from './SapErrorMessage';

interface Props {
  orderNumber: string;
  /** Cambios sin guardar: se reenviaría sin ellos. */
  pendingChanges: number;
  /** Productos con un aviso que impide enviar. */
  blocking: number;
  groupInvoice: boolean;
  /** Cómo va a salir el envío: una orden SAP por centro, con sus productos. */
  plan: ResendPlan;
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
 * **Antes de enviar muestra CÓMO VA A SALIR**: una tarjeta por orden SAP, con sus
 * productos y el número de intento. No es decoración — el envío parte la orden por centro
 * y deja afuera las líneas canceladas, y ninguna de esas dos cosas se ve mirando la orden.
 * Sin esto, "Reenviar a SAP" es un botón que crea pedidos a ciegas, y un clic sin querer
 * los crea igual.
 *
 * **El resultado va POR CENTRO**, por la misma razón: con tres centros puede que dos
 * salgan y uno no, y hace falta saber CUÁL falló para corregir sólo ese.
 */
export function ResendModal({
  orderNumber,
  pendingChanges,
  blocking,
  groupInvoice,
  plan,
  sending,
  result,
  error,
  onConfirm,
  onClose,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const centersToSend = plan.orders.length;
  // Sin líneas activas no hay nada que mandar: el envío rebotaría sin crear ningún
  // pedido. Se avisa acá en vez de dejar que el usuario descubra el rechazo.
  const sinNadaQueEnviar = centersToSend === 0;
  // Líneas que salen con el centro de la CABECERA, por no tener uno propio. Desde el
  // Middleware 1.374.0 el envío lo hereda —igual que el camino del vendedor—, así que
  // esto ya no impide enviar: se muestra para que el operador sepa de qué centro va a
  // salir cada producto antes de crear pedidos reales.
  const heredados = plan.orders.reduce((n, o) => n + o.heredados, 0);

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

        {/* ---- Antes de enviar: CÓMO va a salir, y después qué va a pasar ---- */}
        {!result && !error && (
          <>
            {sinNadaQueEnviar ? (
              <p className="bo-rs__warning bo-rs__warning--blocking">
                <strong>No queda ninguna línea para enviar.</strong>{' '}
                {plan.cancelledCount > 0
                  ? `Las ${plan.cancelledCount} líneas de la orden están canceladas.`
                  : 'La orden no tiene productos.'}{' '}
                El envío rebotaría sin crear ningún pedido. Si la orden no va a salir, lo
                que corresponde es <strong>rechazarla</strong>: cierra el documento y le
                avisa al vendedor con el motivo.
              </p>
            ) : (
              <>
                {heredados > 0 && (
                  <p className="bo-rs__warning">
                    {heredados === 1
                      ? '1 línea no tiene centro propio y sale con el de la cabecera.'
                      : `${heredados} líneas no tienen centro propio y salen con el de la cabecera.`}{' '}
                    Si alguna tiene que salir de otro centro, elegilo antes de enviar.
                  </p>
                )}

                <p className="bo-rs__modal-text">
                  Va a ser el <strong>intento {plan.attemptNumber}</strong>. La orden sale{' '}
                  <strong>partida por centro de distribución</strong>:{' '}
                  {centersToSend === 1
                    ? 'todas las líneas van juntas en una sola orden SAP.'
                    : `se crean ${centersToSend} órdenes SAP, una por centro.`}{' '}
                  SAP decide cada una por separado.
                </p>

                {/* La previsualización: qué lleva cada orden SAP, producto por producto. */}
                <ul className="bo-rs__plan">
                  {plan.orders.map((o, i) => (
                    <li key={o.centerCode ?? `sin-centro-${i}`} className="bo-rs__plan-order">
                      <div className="bo-rs__plan-head">
                        <strong>
                          {centersToSend === 1
                            ? 'Orden SAP'
                            : `Orden SAP ${i + 1} de ${centersToSend}`}
                        </strong>
                        <span
                          className="bo-rs__pill bo-rs__pill--muted"
                        >
                          {o.centerCode
                            ? `Centro ${o.centerCode}${o.centerName ? ` · ${o.centerName}` : ''}`
                            : 'Centro de la cabecera'}
                        </span>
                        {o.heredados > 0 && (
                          <span className="bo-rs__cell--muted">
                            {o.heredados === 1
                              ? '1 línea lo hereda de la cabecera'
                              : `${o.heredados} líneas lo heredan de la cabecera`}
                          </span>
                        )}
                        <span className="bo-rs__cell--muted">
                          {o.items.length === 1 ? '1 producto' : `${o.items.length} productos`}
                        </span>
                      </div>
                      <ul className="bo-rs__plan-items">
                        {o.items.map((item) => (
                          <li key={item.guid} className="bo-rs__plan-item">
                            <span className="bo-rs__cell--muted">{item.lineNumber}</span>
                            <span className="bo-rs__cell--strong">{item.productCode}</span>
                            <span>{item.productDescription ?? '—'}</span>
                            <span className="bo-rs__cell--number">
                              {formatQuantity(item.quantity)} {item.unitOfMeasure ?? ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <ul className="bo-rs__gi-effects">
              {plan.cancelledCount > 0 && !sinNadaQueEnviar && (
                <li className="bo-rs__gi-effect">
                  {plan.cancelledCount === 1
                    ? '1 línea cancelada queda afuera'
                    : `${plan.cancelledCount} líneas canceladas quedan afuera`}
                  : no viajan a SAP. Si alguna tenía que ir, reactivala antes de enviar.
                </li>
              )}
              {!sinNadaQueEnviar && (
                <li className="bo-rs__gi-effect bo-rs__gi-effect--warn">
                  <strong>
                    {centersToSend === 1
                      ? 'Crea un pedido real en SAP.'
                      : `Crea ${centersToSend} pedidos reales en SAP.`}
                  </strong>{' '}
                  No se puede deshacer desde BackOffice: si sale mal, se resuelve en SAP.
                </li>
              )}
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
            <button
              type="button"
              className="bo-rs__button"
              // El envío no puede salir: sin líneas activas, o con alguna que hereda el
              // centro de la cabecera. El servidor lo rechaza igual —es él quien manda—
              // pero dejar el botón vivo sería ofrecer algo que no funciona y devolver un
              // error donde ya sabíamos la respuesta.
              disabled={sending || sinNadaQueEnviar}
              title={
                sinNadaQueEnviar
                  ? 'No queda ninguna línea para enviar: reactivá alguna o rechazá la orden'
                  : undefined
              }
              onClick={onConfirm}
            >
              {sending ? 'Enviando a SAP…' : 'Sí, reenviar a SAP'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
