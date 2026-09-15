import { Fragment } from 'react';
import {
  formatQuantity,
  itemWarnings,
  stockFor,
} from './revision-sap.logic';
import {
  Assignments,
  ItemAssignment,
  ReviewCatalogs,
  ReviewItem,
} from './revision-sap.types';

interface Props {
  items: ReviewItem[];
  assignments: Assignments;
  catalogs: ReviewCatalogs;
  onAssign: (itemGuid: string, next: ItemAssignment) => void;
}

function stockLabel(available: number | null, unit: string): string {
  if (available == null) return '';
  return available > 0 ? `${formatQuantity(available)} ${unit}` : 'sin stock';
}

/**
 * Ítems con su centro y destino editables. Sin precios, descuentos ni totales.
 *
 * Si la orden trae un centro o destino que ya no está en las listas, se muestra
 * igual como opción marcada: esconderlo haría creer que la línea no tenía nada.
 */
export function ReviewItemsTable({ items, assignments, catalogs, onAssign }: Props) {
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
            const original = {
              centerCode: item.centerCode,
              destinationCode: item.destinationCode,
            };
            const current = assignments[item.guid] ?? original;
            const warnings = itemWarnings(item, current, catalogs);
            const changed =
              current.centerCode !== original.centerCode ||
              current.destinationCode !== original.destinationCode;
            const centerKnown = catalogs.centers.some(
              (c) => c.centerCode === current.centerCode,
            );
            const destinationKnown = catalogs.destinations.some(
              (d) => d.destinationCode === current.destinationCode,
            );
            const rowClass = [
              'bo-rs__item-row',
              changed ? 'bo-rs__item-row--changed' : '',
              warnings.length > 0 ? 'bo-rs__item-row--warned' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <Fragment key={item.guid}>
                <tr className={rowClass}>
                  <td className="bo-rs__cell--number bo-rs__cell--muted">
                    {item.lineNumber}
                  </td>
                  <td>
                    <span className="bo-rs__cell--strong">{item.productCode}</span>
                    {changed && <span className="bo-rs__chip">Modificado</span>}
                    <span className="bo-rs__cell-sub">{item.productName}</span>
                  </td>
                  <td className="bo-rs__cell--number">
                    {formatQuantity(item.quantity)} {item.unitOfMeasure}
                  </td>
                  <td>
                    <select
                      className="bo-rs__select"
                      aria-label={`Centro de distribución de la línea ${item.lineNumber}`}
                      value={current.centerCode ?? ''}
                      onChange={(e) =>
                        onAssign(item.guid, {
                          ...current,
                          centerCode: e.target.value || null,
                        })
                      }
                    >
                      <option value="">Elegí un centro</option>
                      {current.centerCode && !centerKnown && (
                        <option value={current.centerCode}>
                          {current.centerCode} · no permitido para el cliente
                        </option>
                      )}
                      {catalogs.centers.map((center) => (
                        <option key={center.centerCode} value={center.centerCode}>
                          {center.centerCode} · {center.centerName} —{' '}
                          {stockLabel(
                            stockFor(catalogs.stock, item.productCode, center.centerCode),
                            item.unitOfMeasure,
                          )}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="bo-rs__select"
                      aria-label={`Destino de entrega de la línea ${item.lineNumber}`}
                      value={current.destinationCode ?? ''}
                      onChange={(e) =>
                        onAssign(item.guid, {
                          ...current,
                          destinationCode: e.target.value || null,
                        })
                      }
                    >
                      <option value="">Elegí un destino</option>
                      {current.destinationCode && !destinationKnown && (
                        <option value={current.destinationCode}>
                          {current.destinationCode} · fuera del área de venta
                        </option>
                      )}
                      {catalogs.destinations.map((destination) => (
                        <option
                          key={destination.destinationCode}
                          value={destination.destinationCode}
                        >
                          {destination.destinationCode} · {destination.destinationName}
                        </option>
                      ))}
                    </select>
                    {destinationKnown && (
                      <span className="bo-rs__cell-sub">
                        {catalogs.destinations.find(
                          (d) => d.destinationCode === current.destinationCode,
                        )?.deliveryAddress ?? ''}
                      </span>
                    )}
                  </td>
                </tr>
                {warnings.length > 0 && (
                  <tr className="bo-rs__warning-row">
                    <td />
                    <td colSpan={4}>
                      <ul className="bo-rs__warnings">
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
