import { useState } from 'react';
import { formatDateTime } from '../soporte/DocumentHeader';
import { draftFor, formatQuantity, itemWarnings } from './revision-sap.logic';
import {
  LineDraft,
  LineDrafts,
  ReviewCatalogs,
  ReviewItem,
  SapOrder,
  SapOrderStatus,
} from './revision-sap.types';
import { SapErrorMessage } from './SapErrorMessage';
import { ProductStockModal } from './ProductStockModal';

interface Props {
  orderGuid: string;
  sapOrders: SapOrder[];
  /** Ítems de la orden, para poder editar la línea que cada producto representa. */
  items: ReviewItem[];
  headerCenterCode: string | null;
  drafts: LineDrafts;
  catalogs: ReviewCatalogs;
  editable: boolean;
  saveErrors: Record<string, string>;
  onChange: (itemGuid: string, next: LineDraft) => void;
}

const STATUS: Record<SapOrderStatus, { label: string; tone: string; hint?: string }> = {
  accepted: { label: 'Aceptada', tone: 'ok' },
  accepted_no_dispatch: {
    label: 'Aceptada sin entrega',
    tone: 'warn',
    hint: 'SAP creó el pedido pero no la entrega: eso se resuelve en SAP.',
  },
  rejected: { label: 'Rechazada', tone: 'danger' },
  no_response: {
    label: 'Sin respuesta',
    tone: 'warn',
    hint: 'No quedó resultado del envío. Verificá en SAP antes de reenviar: el pedido pudo haberse creado.',
  },
};

/**
 * Las órdenes SAP de la orden, con sus productos.
 *
 * Una orden SAP por centro: es la unidad que SAP acepta o rechaza, y por eso el reenvío
 * vive acá y no en la orden entera. En las rechazadas se corrige el centro y el destino
 * de cada producto, que es lo que hace que la próxima salga bien.
 */
export function SapOrdersPanel({
  orderGuid,
  sapOrders,
  items,
  headerCenterCode,
  drafts,
  catalogs,
  editable,
  saveErrors,
  onChange,
}: Props) {
  const [stockFor, setStockFor] = useState<{ code: string; description: string | null } | null>(null);
  const itemsByGuid = new Map(items.map((i) => [i.guid, i]));

  if (sapOrders.length === 0) {
    return (
      <p className="bo-rs__empty">
        Esta orden todavía no generó ninguna orden SAP.
      </p>
    );
  }

  return (
    <>
      <ul className="bo-rs__sap-orders">
        {sapOrders.map((sapOrder) => {
          const status = STATUS[sapOrder.status];
          const rechazada = sapOrder.status === 'rejected';

          return (
            <li key={sapOrder.guid} className={`bo-rs__sap-order${rechazada ? ' bo-rs__sap-order--rejected' : ''}`}>
              <div className="bo-rs__sap-order-head">
                <span className={`bo-rs__pill bo-rs__pill--${status.tone}`}>{status.label}</span>
                <span className="bo-rs__cell--strong">
                  {sapOrder.centerCode
                    ? `Centro ${sapOrder.centerCode}${sapOrder.centerName ? ` · ${sapOrder.centerName}` : ''}`
                    : 'Centro sin informar'}
                </span>
                <span className="bo-rs__cell--muted">
                  {sapOrder.sapOrderNumber ? `Pedido ${sapOrder.sapOrderNumber}` : 'Sin número de pedido'}
                </span>
                {sapOrder.sapDispatchNumber && (
                  <span className="bo-rs__cell--muted">Entrega {sapOrder.sapDispatchNumber}</span>
                )}
                <span className="bo-rs__cell--muted bo-rs__sap-order-date">
                  {formatDateTime(sapOrder.attemptAt)}
                </span>
              </div>

              {rechazada && <SapErrorMessage error={sapOrder.error} />}
              {!rechazada && sapOrder.error && <SapErrorMessage error={sapOrder.error} />}
              {status.hint && <p className="bo-rs__cell--muted bo-rs__sap-order-hint">{status.hint}</p>}

              <div className="bo-rs__table-wrap">
                <table className="bo-rs__table bo-rs__table--compact">
                  <thead>
                    <tr>
                      <th className="bo-rs__th--number">#</th>
                      <th>Producto</th>
                      <th className="bo-rs__th--number">Cantidad</th>
                      <th>Stock</th>
                      {rechazada && <th>Centro de distribución</th>}
                      {rechazada && <th>Destino de entrega</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sapOrder.items.map((sapItem) => {
                      const item = sapItem.itemGuid ? itemsByGuid.get(sapItem.itemGuid) : undefined;
                      const draft: LineDraft = item
                        ? draftFor(item, drafts)
                        : { centerCode: sapItem.centerCode, destinationCode: sapItem.deliveryDestinationCode };
                      const warnings = item ? itemWarnings(item, draft, headerCenterCode, catalogs) : [];
                      const saveError = item ? saveErrors[item.guid] : undefined;
                      const changed =
                        !!item &&
                        (draft.centerCode !== item.centerCode ||
                          draft.destinationCode !== item.deliveryDestinationCode);
                      const centerKnown = catalogs.centers.some((c) => c.centerCode === draft.centerCode);
                      const destination = catalogs.destinations.find(
                        (d) => d.destinationCode === draft.destinationCode,
                      );

                      return (
                        <tr
                          key={`${sapOrder.guid}-${sapItem.lineNumber}`}
                          className={changed ? 'bo-rs__item-row--changed' : undefined}
                        >
                          <td className="bo-rs__cell--number bo-rs__cell--muted">{sapItem.lineNumber}</td>
                          <td>
                            <span className="bo-rs__cell--strong">{sapItem.productCode}</span>
                            {changed && <span className="bo-rs__chip">Sin guardar</span>}
                            {sapItem.description && (
                              <span className="bo-rs__cell-sub">{sapItem.description}</span>
                            )}
                            {(warnings.length > 0 || saveError) && (
                              <ul className="bo-rs__warnings">
                                {saveError && (
                                  <li className="bo-rs__warning bo-rs__warning--blocking">{saveError}</li>
                                )}
                                {warnings.map((w) => (
                                  <li
                                    key={w.kind}
                                    className={
                                      w.blocking
                                        ? 'bo-rs__warning bo-rs__warning--blocking'
                                        : 'bo-rs__warning'
                                    }
                                  >
                                    {w.message}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td className="bo-rs__cell--number">
                            {formatQuantity(sapItem.quantity)} {sapItem.unitOfMeasure ?? ''}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="bo-rs__link-button"
                              onClick={() =>
                                setStockFor({ code: sapItem.productCode, description: sapItem.description })
                              }
                            >
                              Ver stock
                            </button>
                          </td>
                          {rechazada && (
                            <td>
                              <select
                                className="bo-rs__select"
                                aria-label={`Centro de distribución de la línea ${sapItem.lineNumber}`}
                                value={draft.centerCode ?? ''}
                                disabled={!editable || !item}
                                onChange={(e) =>
                                  item && onChange(item.guid, { ...draft, centerCode: e.target.value || null })
                                }
                              >
                                {!item?.centerCode && (
                                  <option value="">
                                    De la cabecera ({headerCenterCode ?? 'sin centro'})
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
                            </td>
                          )}
                          {rechazada && (
                            <td>
                              <select
                                className="bo-rs__select"
                                aria-label={`Destino de entrega de la línea ${sapItem.lineNumber}`}
                                value={draft.destinationCode ?? ''}
                                disabled={!editable || !item}
                                onChange={(e) =>
                                  item &&
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
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {rechazada && (
                <div className="bo-rs__sap-order-actions">
                  <span className="bo-rs__cell--muted">
                    Se reenvía solo esta orden SAP, con los productos de este centro.
                  </span>
                  <button
                    type="button"
                    className="bo-rs__button"
                    disabled
                    title="El reenvío a SAP todavía no está conectado"
                  >
                    Reenviar esta orden SAP
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {stockFor && (
        <ProductStockModal
          orderGuid={orderGuid}
          productCode={stockFor.code}
          productDescription={stockFor.description}
          onClose={() => setStockFor(null)}
        />
      )}
    </>
  );
}
