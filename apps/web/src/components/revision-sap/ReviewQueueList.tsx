import { formatDateTime } from '../soporte/DocumentHeader';
import { formatSalesArea, salesAreaNames } from './revision-sap.logic';
import { Pagination, ReviewQueueEntry, SortDir, SortField } from './revision-sap.types';

const COLUMNS: { key: string; label: string; sort: SortField | null; numeric?: boolean }[] = [
  { key: 'order', label: 'Orden', sort: 'orderNumber' },
  { key: 'customer', label: 'Cliente', sort: 'customerName' },
  { key: 'area', label: 'Área de venta', sort: null },
  { key: 'seller', label: 'Vendedor', sort: 'sellerEmail' },
  { key: 'reason', label: 'Motivo del rechazo', sort: 'sapLastAttemptAt' },
  { key: 'attempts', label: 'Intentos', sort: null, numeric: true },
];

interface Props {
  entries: ReviewQueueEntry[];
  pagination: Pagination | null;
  sortBy: SortField;
  sortDir: SortDir;
  loading: boolean;
  hasSearch: boolean;
  onSort: (field: SortField) => void;
  onSelect: (entry: ReviewQueueEntry) => void;
  onPage: (page: number) => void;
}

/** Bandeja: una fila por orden rechazada, con el motivo a la vista. */
export function ReviewQueueList({
  entries,
  pagination,
  sortBy,
  sortDir,
  loading,
  hasSearch,
  onSort,
  onSelect,
  onPage,
}: Props) {
  if (!loading && entries.length === 0) {
    return (
      <p className="bo-rs__empty">
        {hasSearch
          ? 'Ninguna orden en revisión coincide con la búsqueda.'
          : 'No hay órdenes rechazadas por SAP esperando revisión.'}
      </p>
    );
  }

  const page = pagination?.page ?? 1;
  const totalPages = Math.max(1, pagination?.totalPages ?? 1);

  return (
    <>
      <div className="bo-rs__table-wrap">
        <table className="bo-rs__table">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th key={col.key} className={col.numeric ? 'bo-rs__th--number' : undefined}>
                  {col.sort ? (
                    <button
                      type="button"
                      className="bo-rs__th-button"
                      onClick={() => onSort(col.sort as SortField)}
                    >
                      {col.label}
                      {sortBy === col.sort && (
                        <span className="bo-rs__sort-arrow" aria-hidden="true">
                          {sortDir === 'ASC' ? '▲' : '▼'}
                        </span>
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
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
                    Rechazada {formatDateTime(entry.sapLastAttemptAt)}
                  </span>
                </td>
                <td>
                  {entry.customerName ?? '—'}
                  {entry.customerCode && (
                    <span className="bo-rs__cell-sub">{entry.customerCode}</span>
                  )}
                </td>
                <td>
                  <span className="bo-rs__mono">{formatSalesArea(entry.salesArea)}</span>
                  {salesAreaNames(entry.salesArea) && (
                    <span className="bo-rs__cell-sub">{salesAreaNames(entry.salesArea)}</span>
                  )}
                </td>
                <td className="bo-rs__cell--muted">{entry.sellerEmail ?? '—'}</td>
                <td>
                  <span className="bo-rs__reason" title={entry.sapLastError ?? undefined}>
                    {entry.sapLastError ?? 'SAP no devolvió un motivo'}
                  </span>
                </td>
                <td className="bo-rs__cell--number">{entry.attempts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && (
        <div className="bo-rs__pager">
          <span className="bo-rs__pager-info">
            Página {page} de {totalPages}
          </span>
          <div className="bo-rs__pager-buttons">
            <button
              type="button"
              className="bo-rs__button bo-rs__button--ghost"
              disabled={page <= 1 || loading}
              onClick={() => onPage(page - 1)}
            >
              Anterior
            </button>
            <button
              type="button"
              className="bo-rs__button bo-rs__button--ghost"
              disabled={page >= totalPages || loading}
              onClick={() => onPage(page + 1)}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </>
  );
}
