import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { apiErrorMessage, listFindings } from './consistencia.api';
import {
  Category,
  Finding,
  FindingSortField,
  FindingsQuery,
  GroupKey,
  GroupSummary,
  Pagination,
  Resolution,
  SortDir,
} from './consistencia.types';
import {
  CATEGORY_FILE,
  CsvColumn,
  RESOLUTION_LABEL,
  RESOLUTION_OPTIONS,
  SEVERITY_LABEL,
  downloadCsv,
  humanizeRole,
  isoDate,
  pageSizeForViewport,
  toCsv,
} from './consistencia.format';
import { SummaryCards } from './SummaryCards';
import { FindingsTable } from './FindingsTable';
import { FindingDetail } from './FindingDetail';

/** Pedido de recarga del panel. `refresh` = recalcular en el servidor, no leer lo último. */
export interface ReloadRequest {
  key: number;
  refresh: boolean;
}

interface Props {
  category: Category;
  /** Grupos de esta categoría, del resumen. */
  groups: GroupSummary[];
  reload: ReloadRequest;
  /** Una corrección se guardó: el panel avisa y recarga todo. */
  onChanged: (message: string) => void;
  /** Recarga pedida tras un conflicto. */
  onReloadRequested: () => void;
}

const CSV_COLUMNS: CsvColumn<Finding>[] = [
  { header: 'Severidad', value: (f) => SEVERITY_LABEL[f.severity] },
  { header: 'Situación', value: (f) => f.label },
  { header: 'Persona', value: (f) => f.personName },
  { header: 'Usuario SAP', value: (f) => f.sapUserId },
  { header: 'Email', value: (f) => f.email },
  { header: 'Sociedad', value: (f) => f.companyCode },
  { header: 'Roles', value: (f) => f.roles.map(humanizeRole) },
  {
    header: 'Jerarquía comercial',
    value: (f) =>
      f.members.map((m) =>
        [m.nodeName, m.nodeCountry, m.role, m.sapUserId].filter(Boolean).join(' / '),
      ),
  },
  {
    header: 'Carteras',
    value: (f) =>
      f.portfolios.map((p) => [p.name, p.companyCode].filter(Boolean).join(' / ')),
  },
  { header: 'Cuenta SAP', value: (f) => f.sapAccount?.employeeStatus ?? '' },
  { header: 'Sugerencia', value: (f) => f.suggestion?.sapUserId ?? '' },
  { header: 'Detalle', value: (f) => f.detail },
  { header: 'Resolución', value: (f) => RESOLUTION_LABEL[f.resolution] },
];

/**
 * Hallazgos de una categoría: tarjetas por situación (que filtran), filtros, tabla
 * paginada en el servidor, exportación y el panel de detalle con sus correcciones.
 */
export function FindingsView({ category, groups, reload, onChanged, onReloadRequested }: Props) {
  const [group, setGroup] = useState<GroupKey | null>(null);
  const [resolution, setResolution] = useState<Resolution | ''>('');
  const [companyCode, setCompanyCode] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState<FindingSortField>('severity');
  const [sortDir, setSortDir] = useState<SortDir>('ASC');
  const [page, setPage] = useState(1);
  const [limit] = useState(() => pageSizeForViewport());

  const [findings, setFindings] = useState<Finding[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Finding | null>(null);

  const companyId = useId();
  const resolutionId = useId();
  const searchId = useId();

  /** Debounce de la búsqueda: 300 ms y vuelta a la página 1. */
  const searchTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(searchTimer.current);
  }, [search]);

  // El `refresh` viaja sólo en el primer pedido después de "Actualizar" o de una
  // corrección; cambiar de página después vuelve a leer lo ya calculado.
  const lastReloadKey = useRef(reload.key);

  useEffect(() => {
    let cancelled = false;
    const refresh = reload.refresh && lastReloadKey.current !== reload.key;
    lastReloadKey.current = reload.key;
    setLoading(true);
    setError(null);
    listFindings({
      category,
      group,
      resolution: resolution || null,
      companyCode: companyCode || null,
      search: debouncedSearch,
      page,
      limit,
      sortBy,
      sortDir,
      refresh,
    })
      .then((result) => {
        if (cancelled) return;
        // Una corrección puede vaciar la última página: se vuelve a la última que existe.
        if (result.data.length === 0 && page > 1 && result.pagination.totalPages < page) {
          setPage(Math.max(1, result.pagination.totalPages));
          return;
        }
        setFindings(result.data);
        setCompanies(result.companies);
        setPagination(result.pagination);
      })
      .catch((err) => {
        if (cancelled) return;
        setFindings([]);
        setPagination(null);
        setError(apiErrorMessage(err, 'No se pudieron cargar los hallazgos.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category, group, resolution, companyCode, debouncedSearch, page, limit, sortBy, sortDir, reload, retry]);

  function onSort(field: FindingSortField) {
    if (field === sortBy) {
      setSortDir(sortDir === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(field);
      setSortDir('ASC');
    }
    setPage(1);
  }

  async function onExport() {
    setExporting(true);
    setExportError(null);
    const query: FindingsQuery = {
      category,
      group,
      resolution: resolution || null,
      companyCode: companyCode || null,
      search: debouncedSearch,
      page: 1,
      limit,
      sortBy,
      sortDir,
      exportAll: true,
    };
    try {
      const result = await listFindings(query);
      downloadCsv(
        `consistencia-${CATEGORY_FILE[category]}-${isoDate(new Date())}.csv`,
        toCsv(result.data, CSV_COLUMNS),
      );
    } catch (err) {
      setExportError(apiErrorMessage(err, 'No se pudo generar el archivo para exportar.'));
    } finally {
      setExporting(false);
    }
  }

  const closeDetail = useCallback(() => setSelected(null), []);
  const onDone = useCallback(
    (message: string) => {
      setSelected(null);
      onChanged(message);
    },
    [onChanged],
  );
  const onConflictReload = useCallback(() => {
    setSelected(null);
    onReloadRequested();
  }, [onReloadRequested]);

  const selectedGroup = groups.find((g) => g.group === group) ?? null;
  // La sociedad elegida sigue en la lista aunque el servidor ya no la devuelva.
  const companyOptions =
    companyCode && !companies.includes(companyCode) ? [companyCode, ...companies] : companies;
  const hasFilters = Boolean(group || resolution || companyCode || debouncedSearch);

  return (
    <>
      <SummaryCards
        ariaLabel="Situaciones de la categoría"
        items={groups.map((g) => ({
          key: g.group,
          label: g.label,
          count: g.count,
          severity: g.severity,
          badge: RESOLUTION_LABEL[g.resolution],
        }))}
        selected={group}
        onToggle={(key) => {
          setGroup((prev) => (prev === key ? null : (key as GroupKey)));
          setPage(1);
        }}
      />

      {selectedGroup && (
        <p className="bo-cn__hint-box">
          <strong>{selectedGroup.label}.</strong> {selectedGroup.hint}
        </p>
      )}

      <div className="bo-cn__toolbar">
        <div className="bo-cn__field">
          <label className="bo-cn__label" htmlFor={companyId}>
            Sociedad
          </label>
          <select
            id={companyId}
            className="bo-cn__select"
            value={companyCode}
            onChange={(e) => {
              setCompanyCode(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas</option>
            {companyOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="bo-cn__field">
          <label className="bo-cn__label" htmlFor={resolutionId}>
            Resolución
          </label>
          <select
            id={resolutionId}
            className="bo-cn__select"
            value={resolution}
            onChange={(e) => {
              setResolution(e.target.value as Resolution | '');
              setPage(1);
            }}
          >
            <option value="">Todas</option>
            {RESOLUTION_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {RESOLUTION_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="bo-cn__field bo-cn__field--grow">
          <label className="bo-cn__label" htmlFor={searchId}>
            Buscar por nombre, usuario SAP o email
          </label>
          <input
            id={searchId}
            className="bo-cn__input"
            value={search}
            autoComplete="off"
            placeholder="Nombre, usuario SAP o email"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="bo-cn__button bo-cn__button--ghost"
          disabled={exporting || loading || (pagination?.total ?? 0) === 0}
          onClick={() => void onExport()}
        >
          {exporting ? 'Exportando…' : 'Exportar'}
        </button>
      </div>

      {exportError && (
        <p className="bo-cn__error" role="alert">
          {exportError}
        </p>
      )}

      {error ? (
        <div className="bo-cn__error" role="alert">
          <span>{error}</span>
          <button type="button" className="bo-cn__link-button" onClick={() => setRetry((n) => n + 1)}>
            Reintentar
          </button>
        </div>
      ) : loading && findings.length === 0 ? (
        <p className="bo-cn__empty">Cargando hallazgos…</p>
      ) : findings.length === 0 ? (
        <p className="bo-cn__empty">
          {hasFilters
            ? 'No hay hallazgos que coincidan con los filtros.'
            : 'No hay hallazgos en esta categoría. Los datos cierran entre sí.'}
        </p>
      ) : (
        <FindingsTable
          findings={findings}
          pagination={pagination}
          sortBy={sortBy}
          sortDir={sortDir}
          loading={loading}
          onSort={onSort}
          onSelect={setSelected}
          onPage={setPage}
        />
      )}

      {selected && (
        <FindingDetail
          finding={selected}
          onClose={closeDetail}
          onDone={onDone}
          onReload={onConflictReload}
        />
      )}
    </>
  );
}
