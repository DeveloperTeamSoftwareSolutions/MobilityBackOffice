import { formatDateTime } from '../soporte/DocumentHeader';
import { formatSalesArea } from './revision-sap.logic';
import { ReviewQueueEntry } from './revision-sap.types';

interface Props {
  entries: ReviewQueueEntry[];
  hasSearch: boolean;
  onSelect: (entry: ReviewQueueEntry) => void;
}

/** Bandeja: una fila por orden rechazada, con el motivo a la vista. */
export function ReviewQueueList({ entries, hasSearch, onSelect }: Props) {
  if (entries.length === 0) {
    return (
      <p className="bo-rs__empty">
        {hasSearch
          ? 'Ninguna orden en revisión coincide con la búsqueda.'
          : 'No hay órdenes rechazadas por SAP esperando revisión.'}
      </p>
    );
  }

  return (
    <div className="bo-rs__table-wrap">
      <table className="bo-rs__table">
        <thead>
          <tr>
            <th>Orden</th>
            <th>Cliente</th>
            <th>Área de venta</th>
            <th>Vendedor</th>
            <th>Motivo del rechazo</th>
            <th className="bo-rs__th--number">Intentos</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.guid}
              className="bo-rs__row"
              tabIndex={0}
              onClick={() => onSelect(entry)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(entry);
                }
              }}
            >
              <td>
                <span className="bo-rs__cell--strong">{entry.orderNumber}</span>
                <span className="bo-rs__cell-sub">
                  Rechazada {formatDateTime(entry.rejectedAt)}
                </span>
              </td>
              <td>
                {entry.customerName}
                <span className="bo-rs__cell-sub">{entry.customerCode}</span>
              </td>
              <td className="bo-rs__mono">{formatSalesArea(entry.salesArea)}</td>
              <td className="bo-rs__cell--muted">{entry.sellerEmail}</td>
              <td>
                <span className="bo-rs__reason" title={entry.sapError}>
                  {entry.sapError}
                </span>
              </td>
              <td className="bo-rs__cell--number">{entry.attempts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
