import { Fragment, useState } from 'react';
import { formatDateTime } from '../soporte/DocumentHeader';
import {
  draftFor,
  effectiveCenter,
  formatMoney,
  formatQuantity,
  isCancelled,
  itemWarnings,
} from './revision-sap.logic';
import { LineDraft, LineDrafts, ReviewCatalogs, ReviewItem } from './revision-sap.types';
import { ProductStockModal } from './ProductStockModal';

interface Props {
  orderGuid: string;
  items: ReviewItem[];
  headerCenterCode: string | null;
  drafts: LineDrafts;
  catalogs: ReviewCatalogs;
  editable: boolean;
  saveErrors: Record<string, string>;
  onChange: (itemGuid: string, next: LineDraft) => void;
  /** Abre el modal de cancelación de esa línea. */
  onCancelItem: (item: ReviewItem) => void;
  /** Reactiva la línea sin preguntar: no se pierde nada, y el motivo queda en el hilo. */
  onReactivateItem: (item: ReviewItem) => void;
  /** Guid de la línea que está esperando al servidor, para apagar su botón. */
  busyItemGuid: string | null;
  /** Etiqueta del motivo por código, del catálogo. Sin ella se muestra el código. */
  reasonLabels: Record<string, string>;
  /**
   * Líneas que YA salieron en una orden SAP con pedido creado: `lineNumber -> N° pedido`.
   * No se vuelven a enviar —lo duplicaría— así que se muestran apagadas y sin acciones.
   */
  yaEnSap: Map<number, string>;
}

/**
 * Ítems de la orden con su centro y su destino editables.
 *
 * Con precio unitario y total de línea desde el 2026-09-24 — antes la sección era "sin
 * precios" a propósito. **Sin costo ni margen**, que es otra cosa: precio es lo que se le
 * cobra al cliente y el costo es rentabilidad interna.
 *
 * Acá se corrige lo que hizo que SAP rechazara: el centro y el destino de cada línea.
 * El stock no se muestra en la fila sino a pedido, en un modal: consultarlo para todos
 * los productos de entrada tarda y casi nunca hace falta.
 *
 * Una línea sin centro propio sale con el de la cabecera; elegir uno lo fija para esa
 * línea. Un centro o destino guardado que ya no está en las listas se muestra igual
 * como opción marcada: esconderlo haría creer que la línea no tenía nada.
 */
export function ReviewItemsTable({
  orderGuid,
  items,
  headerCenterCode,
  drafts,
  catalogs,
  editable,
  saveErrors,
  onChange,
  onCancelItem,
  onReactivateItem,
  busyItemGuid,
  reasonLabels,
  yaEnSap,
}: Props) {
  // La línea entera, no sólo el código: el modal necesita la cantidad para decir si el
  // centro alcanza, y el guid para poder cargarle el centro elegido.
  const [stockFor, setStockFor] = useState<ReviewItem | null>(null);
  // El nombre del centro de cabecera, para nombrarlo igual que a los demás en el
  // selector en vez de un escueto "De la cabecera (2102)".
  const headerCenterName =
    catalogs.centers.find((c) => c.centerCode === headerCenterCode)?.centerName ?? null;

  if (items.length === 0) {
    return <p className="bo-rs__empty">La orden no tiene productos.</p>;
  }

  // Un Middleware anterior a 1.376.0 no manda los precios. Las columnas se muestran sólo
  // si hay algo que poner: dos columnas de rayas no informan, ocupan.
  const hayPrecios = items.some((i) => i.unitPrice != null || i.lineTotal != null);
  // Las filas de detalle (motivo, avisos) abarcan todo menos la primera columna.
  const colsDetalle = hayPrecios ? 7 : 5;

  return (
    <>
      <div className="bo-rs__table-wrap">
        <table className="bo-rs__table bo-rs__table--items">
          <thead>
            <tr>
              <th className="bo-rs__th--number">#</th>
              <th>Producto</th>
              <th className="bo-rs__th--number">Cantidad</th>
              {/* Precio unitario y total de línea. Sin costo ni margen: eso es
                  rentabilidad interna y no viaja a esta sección. */}
              {hayPrecios && <th className="bo-rs__th--number">Precio</th>}
              {hayPrecios && <th className="bo-rs__th--number">Total</th>}
              <th>Centro de distribución</th>
              <th>Destino de entrega</th>
              <th className="bo-rs__th--actions">Envío</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const draft = draftFor(item, drafts);
              const cancelled = isCancelled(item);
              // Ya salió en una orden SAP con pedido creado. No se vuelve a enviar —lo
              // duplicaría— y tampoco se puede cancelar: lo que ya está en SAP se
              // resuelve en SAP.
              const pedidoEnSap = yaEnSap.get(item.lineNumber) ?? null;
              const fueraDelEnvio = cancelled || pedidoEnSap !== null;
              // Una línea que no viaja no necesita avisos: decirle que no tiene stock, o
              // que su destino quedó fuera del área, sería ruido sobre algo que no sale.
              const warnings = fueraDelEnvio
                ? []
                : itemWarnings(item, draft, headerCenterCode, catalogs);
              const saveError = saveErrors[item.guid];
              const changed =
                !fueraDelEnvio &&
                (draft.centerCode !== item.centerCode ||
                  draft.destinationCode !== item.deliveryDestinationCode);
              const centerKnown = catalogs.centers.some((c) => c.centerCode === draft.centerCode);
              const destination = catalogs.destinations.find(
                (d) => d.destinationCode === draft.destinationCode,
              );
              // Centro y destino quedan bloqueados si la línea no va a viajar: elegirlos
              // no cambiaría nada y haría creer que va a salir.
              const editableLine = editable && !fueraDelEnvio;
              const busy = busyItemGuid === item.guid;
              const rowClass = [
                'bo-rs__item-row',
                changed ? 'bo-rs__item-row--changed' : '',
                warnings.length > 0 || saveError ? 'bo-rs__item-row--warned' : '',
                // Misma presentación apagada para los dos motivos de no viajar; lo que
                // los distingue es la fila de abajo, que dice cuál es.
                fueraDelEnvio ? 'bo-rs__item-row--cancelled' : '',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <Fragment key={item.guid}>
                  <tr className={rowClass}>
                    <td className="bo-rs__cell--number bo-rs__cell--muted">{item.lineNumber}</td>
                    <td>
                      <span className="bo-rs__cell--strong">{item.productCode}</span>
                      {changed && <span className="bo-rs__chip">Sin guardar</span>}
                      {cancelled && (
                        <span className="bo-rs__pill bo-rs__pill--muted">No se envía</span>
                      )}
                      {pedidoEnSap && (
                        <span className="bo-rs__pill bo-rs__pill--ok">Ya está en SAP</span>
                      )}
                      <span className="bo-rs__cell-sub">{item.productDescription ?? '—'}</span>
                    </td>
                    <td className="bo-rs__cell--number">
                      {formatQuantity(item.quantity)} {item.unitOfMeasure ?? ''}
                    </td>
                    {hayPrecios && (
                      <td className="bo-rs__cell--number">
                        {formatMoney(item.unitPrice)}
                        {/* El descuento va debajo del precio, que es lo que modifica.
                            Sólo si hay: un "0 %" en cada línea es ruido. */}
                        {(item.discountPct ?? 0) > 0 && (
                          <span className="bo-rs__cell-sub">−{item.discountPct}%</span>
                        )}
                      </td>
                    )}
                    {hayPrecios && (
                      <td className="bo-rs__cell--number bo-rs__cell--strong">
                        {formatMoney(item.lineTotal)}
                      </td>
                    )}
                    <td>
                      <select
                        className="bo-rs__select"
                        aria-label={`Centro de distribución de la línea ${item.lineNumber}`}
                        value={draft.centerCode ?? ''}
                        disabled={!editableLine}
                        onChange={(e) =>
                          onChange(item.guid, { ...draft, centerCode: e.target.value || null })
                        }
                      >
                        {/* Sin centro propio solo si todavía no tiene uno guardado: el
                            servidor no borra un centro, lo reemplaza. */}
                        {!item.centerCode && (
                          <option value="">
                            {headerCenterCode
                              ? `${headerCenterCode}${
                                  headerCenterName ? ` · ${headerCenterName}` : ''
                                } (mismo de la cabecera)`
                              : 'Sin centro (el de la cabecera)'}
                          </option>
                        )}
                        {draft.centerCode && !centerKnown && (
                          <option value={draft.centerCode}>
                            {draft.centerCode} · no permitido para el cliente
                          </option>
                        )}
                        {catalogs.centers.map((c) => (
                          <option key={c.centerCode} value={c.centerCode}>
                            {c.centerCode} · {c.centerName ?? ''}
                          </option>
                        ))}
                      </select>
                      {/* El stock vive acá, debajo del selector, porque es lo que se
                          mira para decidir ESTE campo. Como columna aparte quedaba
                          lejos de la decisión y ensanchaba la tabla. */}
                      <button
                        type="button"
                        className="bo-rs__link-button bo-rs__stock-link"
                        onClick={() => setStockFor(item)}
                      >
                        {editableLine ? 'Ver stock y elegir centro' : 'Ver stock por centro'}
                      </button>
                    </td>
                    <td>
                      <select
                        className="bo-rs__select"
                        aria-label={`Destino de entrega de la línea ${item.lineNumber}`}
                        value={draft.destinationCode ?? ''}
                        disabled={!editableLine}
                        onChange={(e) =>
                          onChange(item.guid, { ...draft, destinationCode: e.target.value || null })
                        }
                      >
                        <option value="">Elegí un destino</option>
                        {draft.destinationCode && !destination && (
                          <option value={draft.destinationCode}>
                            {draft.destinationCode} · fuera del área de venta
                          </option>
                        )}
                        {catalogs.destinations.map((d) => (
                          <option key={d.destinationCode} value={d.destinationCode}>
                            {d.destinationCode} · {d.destinationName ?? ''}
                          </option>
                        ))}
                      </select>
                      {destination?.deliveryAddress && (
                        <span className="bo-rs__cell-sub">{destination.deliveryAddress}</span>
                      )}
                    </td>
                    <td className="bo-rs__cell--actions">
                      {pedidoEnSap ? (
                        // Sin acciones: ya tiene pedido en SAP. Cancelarla no lo
                        // desharía —eso se resuelve en SAP— y reenviarla lo duplicaría.
                        <span className="bo-rs__cell--muted">Enviado</span>
                      ) : cancelled ? (
                        <button
                          type="button"
                          className="bo-rs__button bo-rs__button--ghost bo-rs__button--small"
                          disabled={!editable || busy}
                          onClick={() => onReactivateItem(item)}
                          title={
                            editable
                              ? 'Vuelve a incluirse en el próximo envío'
                              : 'La orden ya no está en revisión'
                          }
                        >
                          {busy ? 'Reactivando…' : 'Reactivar'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="bo-rs__button bo-rs__button--ghost bo-rs__button--small"
                          disabled={!editable || busy}
                          onClick={() => onCancelItem(item)}
                          title={
                            editable
                              ? 'La línea deja de enviarse a SAP, con un motivo de no venta'
                              : 'La orden ya no está en revisión'
                          }
                        >
                          {/* "Cancelar línea" y no "Cancelar" a secas: en esta misma
                              pantalla los modales usan "Cancelar" para cerrarse sin hacer
                              nada, y acá significaría lo contrario —una acción que SÍ
                              cambia la orden—. La misma palabra para las dos cosas es
                              exactamente lo que hace apretar la equivocada. */}
                          Cancelar línea
                        </button>
                      )}
                    </td>
                  </tr>
                  {pedidoEnSap && (
                    // El número de pedido va a la vista, no en un tooltip: es la respuesta
                    // a "por qué este producto no se vuelve a enviar", y además es el dato
                    // con el que se busca en SAP.
                    <tr className="bo-rs__cancelled-row">
                      <td />
                      <td colSpan={colsDetalle}>
                        <span className="bo-rs__cancelled-reason">
                          Ya salió en el pedido <strong>{pedidoEnSap}</strong>. No se vuelve
                          a enviar: hacerlo crearía un segundo pedido por la misma venta.
                        </span>
                      </td>
                    </tr>
                  )}
                  {cancelled && (
                    // El motivo va en su propia fila y no en un tooltip: es la respuesta a
                    // "por qué esto no llegó a SAP", y tiene que leerse sin pasar el mouse.
                    <tr className="bo-rs__cancelled-row">
                      <td />
                      <td colSpan={colsDetalle}>
                        <span className="bo-rs__cancelled-reason">
                          <strong>
                            {item.noSaleReasonCode
                              ? (reasonLabels[item.noSaleReasonCode] ?? item.noSaleReasonCode)
                              : 'Sin motivo registrado'}
                          </strong>
                          {item.noSaleReasonNotes ? ` · ${item.noSaleReasonNotes}` : ''}
                        </span>
                        {item.cancelledBy && (
                          <span className="bo-rs__cell-sub">
                            Cancelada por {item.cancelledBy}
                            {item.cancelledAt ? ` · ${formatDateTime(item.cancelledAt)}` : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                  {(warnings.length > 0 || saveError) && (
                    <tr className="bo-rs__warning-row">
                      <td />
                      <td colSpan={colsDetalle}>
                        <ul className="bo-rs__warnings">
                          {saveError && (
                            <li className="bo-rs__warning bo-rs__warning--blocking">{saveError}</li>
                          )}
                          {warnings.map((warning) => (
                            <li
                              key={warning.kind}
                              className={
                                warning.blocking
                                  ? 'bo-rs__warning bo-rs__warning--blocking'
                                  : 'bo-rs__warning'
                              }
                            >
                              {warning.message}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {stockFor && (
        <ProductStockModal
          orderGuid={orderGuid}
          productCode={stockFor.productCode}
          productDescription={stockFor.productDescription}
          quantity={stockFor.quantity}
          currentCenter={effectiveCenter(draftFor(stockFor, drafts).centerCode, headerCenterCode).code}
          centers={catalogs.centers}
          // Sólo se puede elegir si la orden se puede editar, y si la línea no está
          // cancelada: elegirle un centro a algo que no va a salir no cambia nada. En
          // solo lectura el modal sigue sirviendo para mirar.
          onSelectCenter={
            editable && !isCancelled(stockFor)
              ? (centerCode) => {
                  onChange(stockFor.guid, { ...draftFor(stockFor, drafts), centerCode });
                  setStockFor(null);
                }
              : undefined
          }
          onClose={() => setStockFor(null)}
        />
      )}
    </>
  );
}
