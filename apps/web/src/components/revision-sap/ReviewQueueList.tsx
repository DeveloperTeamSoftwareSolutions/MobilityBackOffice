import { formatDateTime } from '../soporte/DocumentHeader';
import {
  formatSalesArea,
  parseSapError,
  resolutionOf,
  salesAreaNames,
  sapErrorTypeLabel,
  statusLabel,
  statusTone,
} from './revision-sap.logic';
import {
  Pagination,
  ReviewQueueEntry,
  ReviewView,
  SortDir,
  SortField,
} from './revision-sap.types';

interface Column {
  key: string;
  label: string;
  sort: SortField | null;
  numeric?: boolean;
}

/**
 * Las dos pestañas no miran lo mismo.
 *
 * En PENDIENTES importa por qué la orden está acá: el motivo del rechazo y cuántas
 * veces se intentó. En RESUELTAS eso ya no se puede accionar, y lo que importa es cómo
 * terminó: cómo se resolvió, en qué estado quedó, quién la cerró y cuándo.
 */
function columnsFor(view: ReviewView): Column[] {
  const comunes: Column[] = [
    { key: 'order', label: 'Orden', sort: 'orderNumber' },
    { key: 'customer', label: 'Cliente', sort: 'customerName' },
    { key: 'area', label: 'Área de venta', sort: null },
    { key: 'seller', label: 'Vendedor', sort: 'sellerEmail' },
  ];
  if (view === 'resolved') {
    return [
      ...comunes,
      { key: 'resolution', label: 'Cómo se resolvió', sort: null },
      { key: 'status', label: 'Estado hoy', sort: null },
      { key: 'decidedBy', label: 'Resuelta por', sort: null },
      { key: 'decidedAt', label: 'Fecha', sort: 'decidedAt' },
    ];
  }
  return [
    ...comunes,
    { key: 'reason', label: 'Motivo del rechazo', sort: 'sapLastAttemptAt' },
    { key: 'attempts', label: 'Intentos', sort: null, numeric: true },
  ];
}

/**
 * El motivo en una celda: el tipo como etiqueta y el primer mensaje. SAP suele mandar
 * varias líneas; en la tabla entra la que importa —la de error— y el resto se cuenta.
 * El texto completo queda en el `title`, para no perderlo.
 */
function ReasonCell({ error }: { error: string | null }) {
  const lines = parseSapError(error);
  if (lines.length === 0) {
    return <span className="bo-rs__cell--muted">SAP no devolvió un motivo</span>;
  }
  const principal = lines.find((l) => l.type === 'E' || l.type === 'A') ?? lines[0];
  const resto = lines.length - 1;

  return (
    <span className="bo-rs__reason-cell" title={lines.map((l) => (l.type ? `[${l.type}] ${l.message}` : l.message)).join('\n')}>
      {principal.type && (
        <span
          className={`bo-rs__sap-type bo-rs__sap-type--${principal.type === 'E' || principal.type === 'A' ? 'error' : principal.type === 'W' ? 'warn' : 'info'}`}
        >
          {sapErrorTypeLabel(principal.type)}
        </span>
      )}
      <span className="bo-rs__reason">{principal.message}</span>
      {resto > 0 && (
        <span className="bo-rs__cell-sub">
          {resto === 1 ? '+1 mensaje más' : `+${resto} mensajes más`}
        </span>
      )}
    </span>
  );
}

interface Props {
  entries: ReviewQueueEntry[];
  pagination: Pagination | null;
  view: ReviewView;
  sortBy: SortField;
  sortDir: SortDir;
  loading: boolean;
  hasSearch: boolean;
  onSort: (field: SortField) => void;
  onSelect: (entry: ReviewQueueEntry) => void;
  onPage: (page: number) => void;
}

/** Bandeja: una fila por orden, con lo que importa según la pestaña. */
export function ReviewQueueList({
  entries,
  pagination,
  view,
  sortBy,
  sortDir,
  loading,
  hasSearch,
  onSort,
  onSelect,
  onPage,
}: Props) {
  const columns = columnsFor(view);

  if (!loading && entries.length === 0) {
    return (
      <p className="bo-rs__empty">
        {hasSearch
          ? 'Ninguna orden coincide con la búsqueda.'
          : view === 'resolved'
            ? 'Todavía no se resolvió ninguna orden. Acá van a quedar las que BackOffice reenvíe o cierre.'
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
              {columns.map((col) => (
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
            {entries.map((entry) => {
              const resolucion = resolutionOf(entry);
              return (
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
                      {view === 'resolved'
                        ? `Rechazada ${formatDateTime(entry.sapLastAttemptAt)}`
                        : `Rechazada ${formatDateTime(entry.sapLastAttemptAt)}`}
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

                  {view === 'resolved' ? (
                    <>
                      <td>
                        <span className={`bo-rs__pill bo-rs__pill--${resolucion.tone}`}>
                          {resolucion.label}
                        </span>
                        {entry.sapOrderNumber && (
                          <span className="bo-rs__cell-sub">Pedido {entry.sapOrderNumber}</span>
                        )}
                        {resolucion.hint && (
                          <span className="bo-rs__cell-sub">{resolucion.hint}</span>
                        )}
                      </td>
                      {/* El estado de HOY puede no coincidir con cómo se resolvió: la
                          orden sigue viva y pudo moverse después. */}
                      <td>
                        <span className={`bo-rs__pill bo-rs__pill--${statusTone(entry.statusCode)}`}>
                          {statusLabel(entry.statusCode)}
                        </span>
                      </td>
                      <td className="bo-rs__cell--muted">{entry.decidedBy ?? '—'}</td>
                      <td className="bo-rs__cell--muted">{formatDateTime(entry.decidedAt)}</td>
                    </>
                  ) : (
                    <>
                      <td>
                        <ReasonCell error={entry.sapLastError} />
                      </td>
                      <td className="bo-rs__cell--number">{entry.attempts}</td>
                    </>
                  )}
                </tr>
              );
            })}
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
