import { Fragment } from 'react';
import {
  effectiveCenter,
  formatQuantity,
  itemWarnings,
  stockFor,
} from './revision-sap.logic';
import { DestinationDrafts, ReviewCatalogs, ReviewItem } from './revision-sap.types';

interface Props {
  items: ReviewItem[];
  headerCenterCode: string | null;
  drafts: DestinationDrafts;
  catalogs: ReviewCatalogs;
  editable: boolean;
  saveErrors: Record<string, string>;
  onDestination: (itemGuid: string, code: string | null) => void;
}

function stockText(available: number | null, unit: string | null, stockKnown: boolean): string {
  if (!stockKnown) return 'stock sin consultar';
  if (available == null) return 'stock no disponible';
  return available > 0 ? `stock ${formatQuantity(available)} ${unit ?? ''}`.trim() : 'sin stock';
}

/**
 * Ítems con su centro y su destino. Sin precios, descuentos ni totales.
 *
 * El destino se edita. El centro se muestra con el stock de cada centro permitido,
 * pero no se edita: hoy SAP recibe solo el centro de cabecera.
 *
 * Si la orden trae un destino que no está en la lista del área, se muestra igual como
 * opción marcada: esconderlo haría creer que la línea no tenía nada.
 */
export function ReviewItemsTable({
  items,
  headerCenterCode,
  drafts,
  catalogs,
  editable,
  saveErrors,
  onDestination,
}: Props) {
  const centerNames = new Map(catalogs.centers.map((c) => [c.centerCode, c.centerName]));

  return (
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
            const destination = item.guid in drafts ? drafts[item.guid] : item.deliveryDestinationCode;
            const warnings = itemWarnings(item, destination, headerCenterCode, catalogs);
            const saveError = saveErrors[item.guid];
            const changed = destination !== item.deliveryDestinationCode;
            const known = catalogs.destinations.find((d) => d.destinationCode === destination);
            const center = effectiveCenter(item, headerCenterCode);
            const stockKnown = catalogs.stock !== null;
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
                    <span className="bo-rs__mono">{center.code ?? '—'}</span>
                    {center.code && centerNames.get(center.code) && (
                      <span className="bo-rs__cell--muted"> · {centerNames.get(center.code)}</span>
                    )}
                    <span className="bo-rs__cell-sub">
                      {center.inherited ? 'de la cabecera · ' : ''}
                      {stockText(
                        stockFor(catalogs.stock, item.productCode, center.code),
                        item.unitOfMeasure,
                        stockKnown,
                      )}
                    </span>
                    {stockKnown && catalogs.stock?.[item.productCode] && catalogs.centers.length > 0 && (
                      <details className="bo-rs__stock">
                        <summary>Stock por centro</summary>
                        <ul className="bo-rs__stock-list">
                          {catalogs.centers.map((c) => (
                            <li key={c.centerCode}>
                              <span className="bo-rs__mono">{c.centerCode}</span>{' '}
                              {c.centerName ?? ''}
                              <span className="bo-rs__stock-qty">
                                {formatQuantity(catalogs.stock?.[item.productCode]?.[c.centerCode] ?? 0)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td>
                    <select
                      className="bo-rs__select"
                      aria-label={`Destino de entrega de la línea ${item.lineNumber}`}
                      value={destination ?? ''}
                      disabled={!editable}
                      onChange={(e) => onDestination(item.guid, e.target.value || null)}
                    >
                      <option value="">Elegí un destino</option>
                      {destination && !known && (
                        <option value={destination}>{destination} · fuera del área de venta</option>
                      )}
                      {catalogs.destinations.map((d) => (
                        <option key={d.destinationCode} value={d.destinationCode}>
                          {d.destinationCode} · {d.destinationName ?? ''}
                        </option>
                      ))}
                    </select>
                    {known?.deliveryAddress && (
                      <span className="bo-rs__cell-sub">{known.deliveryAddress}</span>
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
  );
}
