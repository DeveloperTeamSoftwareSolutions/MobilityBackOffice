import { Fragment, useState } from 'react';
import { draftFor, effectiveCenter, formatQuantity, itemWarnings } from './revision-sap.logic';
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
}

/**
 * Ítems de la orden con su centro y su destino editables. Sin precios ni totales.
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
}: Props) {
  // La línea entera, no sólo el código: el modal necesita la cantidad para decir si el
  // centro alcanza, y el guid para poder cargarle el centro elegido.
  const [stockFor, setStockFor] = useState<ReviewItem | null>(null);

  if (items.length === 0) {
    return <p className="bo-rs__empty">La orden no tiene productos.</p>;
  }

  return (
    <>
      <div className="bo-rs__table-wrap">
        <table className="bo-rs__table bo-rs__table--items">
          <thead>
            <tr>
              <th className="bo-rs__th--number">#</th>
              <th>Producto</th>
              <th className="bo-rs__th--number">Cantidad</th>
              <th>Centro de distribución</th>
              <th>Destino de entrega</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const draft = draftFor(item, drafts);
              const warnings = itemWarnings(item, draft, headerCenterCode, catalogs);
              const saveError = saveErrors[item.guid];
              const changed =
                draft.centerCode !== item.centerCode ||
                draft.destinationCode !== item.deliveryDestinationCode;
              const center = effectiveCenter(draft.centerCode, headerCenterCode);
              const centerKnown = catalogs.centers.some((c) => c.centerCode === draft.centerCode);
              const destination = catalogs.destinations.find(
                (d) => d.destinationCode === draft.destinationCode,
              );
              const rowClass = [
                'bo-rs__item-row',
                changed ? 'bo-rs__item-row--changed' : '',
                warnings.length > 0 || saveError ? 'bo-rs__item-row--warned' : '',
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
                      <span className="bo-rs__cell-sub">{item.productDescription ?? '—'}</span>
                    </td>
                    <td className="bo-rs__cell--number">
                      {formatQuantity(item.quantity)} {item.unitOfMeasure ?? ''}
                    </td>
                    <td>
                      <select
                        className="bo-rs__select"
                        aria-label={`Centro de distribución de la línea ${item.lineNumber}`}
                        value={draft.centerCode ?? ''}
                        disabled={!editable}
                        onChange={(e) =>
                          onChange(item.guid, { ...draft, centerCode: e.target.value || null })
                        }
                      >
                        {/* Sin centro propio solo si todavía no tiene uno guardado: el
                            servidor no borra un centro, lo reemplaza. */}
                        {!item.centerCode && (
                          <option value="">De la cabecera ({headerCenterCode ?? 'sin centro'})</option>
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
                      {center.inherited && (
                        <span className="bo-rs__cell-sub">Sale con el centro de la cabecera</span>
                      )}
                      {/* El stock vive acá, debajo del selector, porque es lo que se
                          mira para decidir ESTE campo. Como columna aparte quedaba
                          lejos de la decisión y ensanchaba la tabla. */}
                      <button
                        type="button"
                        className="bo-rs__link-button bo-rs__stock-link"
                        onClick={() => setStockFor(item)}
                      >
                        {editable ? 'Ver stock y elegir centro' : 'Ver stock por centro'}
                      </button>
                    </td>
                    <td>
                      <select
                        className="bo-rs__select"
                        aria-label={`Destino de entrega de la línea ${item.lineNumber}`}
                        value={draft.destinationCode ?? ''}
                        disabled={!editable}
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
                  </tr>
                  {(warnings.length > 0 || saveError) && (
                    <tr className="bo-rs__warning-row">
                      <td />
                      <td colSpan={4}>
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
          // Sólo se puede elegir si la orden se puede editar. En solo lectura el modal
          // sigue sirviendo para mirar.
          onSelectCenter={
            editable
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
