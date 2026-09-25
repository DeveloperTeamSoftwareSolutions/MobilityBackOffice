import { IconSortArrow } from '../layout/icons';
import { Finding, FindingSortField, Pagination, SortDir } from './consistencia.types';
import { RESOLUTION_LABEL, SEVERITY_LABEL } from './consistencia.format';
import { Pager } from './Pager';

/** Columnas. `sort` null = no ordenable. */
const COLUMNS: { key: string; label: string; sort: FindingSortField | null }[] = [
  { key: 'severity', label: 'Severidad', sort: 'severity' },
  { key: 'group', label: 'Situación', sort: 'group' },
  { key: 'person', label: 'Persona', sort: 'personName' },
  { key: 'sapUserId', label: 'Usuario SAP', sort: 'sapUserId' },
  { key: 'companyCode', label: 'Sociedad', sort: 'companyCode' },
  { key: 'detail', label: 'Detalle', sort: null },
  { key: 'resolution', label: 'Resolución', sort: null },
];

interface Props {
  findings: Finding[];
  pagination: Pagination | null;
  sortBy: FindingSortField;
  sortDir: SortDir;
  loading: boolean;
  onSort: (field: FindingSortField) => void;
  onSelect: (finding: Finding) => void;
  onPage: (page: number) => void;
}

/** Tabla de hallazgos. Orden y paginación son del servidor: acá sólo se muestra. */
export function FindingsTable({
  findings,
  pagination,
  sortBy,
  sortDir,
  loading,
  onSort,
  onSelect,
  onPage,
}: Props) {
  return (
    <>
      <div className="bo-cn__table-wrap" aria-busy={loading}>
        <table className="bo-cn__table">
          <thead>
            <tr>
              {COLUMNS.map((col) => {
                const active = col.sort !== null && sortBy === col.sort;
                return (
                  <th
                    key={col.key}
                    aria-sort={
                      col.sort === null
                        ? undefined
                        : active
                          ? sortDir === 'ASC'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                    }
                  >
                    {col.sort ? (
                      <button
                        type="button"
                        className="bo-cn__sortbtn"
                        onClick={() => onSort(col.sort as FindingSortField)}
                      >
                        <span>{col.label}</span>
                        {active && <IconSortArrow dir={sortDir} />}
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                );
              })}
              <th>
                <span className="bo-cn__sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => (
              <tr key={f.key}>
                <td>
                  <span className={`bo-cn__sev bo-cn__sev--${f.severity}`}>
                    <span className="bo-cn__sev-dot" aria-hidden="true" />
                    {SEVERITY_LABEL[f.severity]}
                  </span>
                </td>
                <td className="bo-cn__cell--strong">{f.label}</td>
                <td>
                  {f.personName ?? 'Sin nombre'}
                  {f.email && <span className="bo-cn__cell-sub">{f.email}</span>}
                </td>
                <td className="bo-cn__cell--mono">{f.sapUserId ?? '—'}</td>
                <td>{f.companyCode ?? '—'}</td>
                <td className="bo-cn__cell--detail">{f.detail ?? '—'}</td>
                <td>
                  <span className={`bo-cn__badge bo-cn__badge--${f.resolution.toLowerCase()}`}>
                    {RESOLUTION_LABEL[f.resolution]}
                  </span>
                </td>
                <td className="bo-cn__cell--action">
                  <button
                    type="button"
                    className="bo-cn__button bo-cn__button--ghost bo-cn__button--small"
                    aria-label={`Ver ${f.label}${f.personName ? ` de ${f.personName}` : ''}`}
                    onClick={() => onSelect(f)}
                  >
                    Ver
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination && (
        <Pager pagination={pagination} loading={loading} noun="hallazgos" onPage={onPage} />
      )}
    </>
  );
}
