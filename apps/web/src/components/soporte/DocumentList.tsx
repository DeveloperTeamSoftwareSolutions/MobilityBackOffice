import {
  Pagination,
  SortDir,
  SortField,
  SupportDocument,
} from './soporte.types';
import { formatDateTime } from './DocumentHeader';

/** Columnas de la tabla. `sort` null = no ordenable. */
/** `numeric` alinea el encabezado a la derecha, como sus valores. */
const COLUMNS: {
  key: string;
  label: string;
  sort: SortField | null;
  numeric?: boolean;
}[] = [
  { key: 'documentNumber', label: 'Documento', sort: 'documentNumber' },
  { key: 'statusCode', label: 'Estado', sort: 'statusCode' },
  { key: 'customerName', label: 'Cliente', sort: 'customerName' },
  { key: 'sellerEmail', label: 'Vendedor', sort: 'sellerEmail' },
  { key: 'total', label: 'Total', sort: 'total', numeric: true },
  { key: 'documentDate', label: 'Fecha', sort: 'documentDate' },
];

/** Importe con separador de miles y su moneda. */
function formatTotal(total: number | null, currency: string | null): string {
  if (total == null) return '—';
  const amount = total.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${amount} ${currency}` : amount;
}

interface Props {
  documents: SupportDocument[];
  pagination: Pagination | null;
  sortBy: SortField;
  sortDir: SortDir;
  loading: boolean;
  onSort: (field: SortField) => void;
  onSelect: (document: SupportDocument) => void;
  onPage: (page: number) => void;
}

/**
 * Tabla de documentos. Toda la paginación y el orden son server-side: la tabla
 * no recorta ni reordena nada en memoria, solo pide y muestra.
 */
export function DocumentList({
  documents,
  pagination,
  sortBy,
  sortDir,
  loading,
  onSort,
  onSelect,
  onPage,
}: Props) {
  if (!loading && documents.length === 0) {
    return (
      <p className="bo-sp__empty">
        No hay documentos que coincidan con el filtro.
      </p>
    );
  }

  const page = pagination?.page ?? 1;
  const totalPages = pagination?.totalPages ?? 1;

  return (
    <>
      <div className="bo-sp__table-wrap">
        <table className="bo-sp__table">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={col.numeric ? 'bo-sp__th--number' : undefined}
                >
                  {col.sort ? (
                    <button
                      type="button"
                      className="bo-sp__th-button"
                      onClick={() => onSort(col.sort as SortField)}
                    >
                      {col.label}
                      {sortBy === col.sort && (
                        <span className="bo-sp__sort-arrow" aria-hidden="true">
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
            {documents.map((doc) => (
              <tr
                key={doc.guid || doc.id}
                className="bo-sp__row"
                onClick={() => onSelect(doc)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(doc);
                  }
                }}
              >
                <td className="bo-sp__cell--strong">
                  {doc.documentNumber ?? '—'}
                </td>
                <td>
                  <span
                    className={`bo-sp__status ${
                      doc.cancelledAt ? 'bo-sp__status--cancelled' : ''
                    }`}
                  >
                    {doc.statusCode ?? '—'}
                  </span>
                  {/*
                    El estado guardado no coincide con el calculado. Sin esta marca el
                    desfasaje es invisible: el vendedor ve un estado que no le
                    corresponde y nadie se entera.
                  */}
                  {doc.statusConsistent === false && (
                    <span
                      className="bo-sp__cell-sub bo-sp__inconsistent"
                      title="El estado guardado no coincide con el que el sistema calcularía"
                    >
                      debería ser {doc.projectedStatus}
                    </span>
                  )}
                </td>
                <td>
                  {doc.customerName ?? '—'}
                  {doc.customerCode && (
                    <span className="bo-sp__cell-sub">{doc.customerCode}</span>
                  )}
                </td>
                <td className="bo-sp__cell--muted">{doc.sellerEmail ?? '—'}</td>
                <td className="bo-sp__cell--number">
                  {formatTotal(doc.total, doc.currency)}
                </td>
                <td className="bo-sp__cell--muted">
                  {formatDateTime(doc.documentDate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && (
        <div className="bo-sp__pager">
          <span className="bo-sp__pager-info">
            {pagination.total.toLocaleString('es-AR')} documentos · página {page}{' '}
            de {totalPages}
          </span>
          <div className="bo-sp__pager-buttons">
            <button
              type="button"
              className="bo-sp__pager-button"
              disabled={page <= 1 || loading}
              onClick={() => onPage(page - 1)}
            >
              Anterior
            </button>
            <button
              type="button"
              className="bo-sp__pager-button"
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
