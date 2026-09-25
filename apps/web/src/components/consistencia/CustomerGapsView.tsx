import { useEffect, useId, useRef, useState } from 'react';
import { apiErrorMessage, listCustomerGaps } from './consistencia.api';
import { CustomerGap, GapCounts, GapType, Pagination } from './consistencia.types';
import {
  CsvColumn,
  GAP_LABEL,
  GAP_TYPES,
  downloadCsv,
  isoDate,
  pageSizeForViewport,
  toCsv,
} from './consistencia.format';
import { SummaryCards } from './SummaryCards';
import { Pager } from './Pager';

interface Props {
  /** Cambia con "Actualizar" y tras una corrección: vuelve a pedir la página. */
  reloadKey: number;
}

const CSV_COLUMNS: CsvColumn<CustomerGap>[] = [
  { header: 'Situación', value: (g) => GAP_LABEL[g.gapType] ?? 'Otra diferencia' },
  { header: 'Vendedor', value: (g) => g.userName },
  { header: 'Email del vendedor', value: (g) => g.userEmail },
  { header: 'Usuario SAP', value: (g) => g.sapUserId },
  { header: 'Código de cliente', value: (g) => g.customerCode },
  { header: 'Cliente', value: (g) => g.customerName },
  { header: 'Sociedad', value: (g) => g.companyCode },
  { header: 'Nombre de la sociedad', value: (g) => g.companyName },
  { header: 'Cartera', value: (g) => g.portfolioName },
  { header: 'Vendedor asignado en SAP', value: (g) => g.partnerUserId },
];

function countsText(c: GapCounts | undefined): string | undefined {
  if (!c) return undefined;
  return `${c.customers.toLocaleString('es-AR')} clientes · ${c.sellers.toLocaleString('es-AR')} vendedores`;
}

/**
 * Clientes de cartera contra la asignación de SAP. Es de sólo lectura: estas
 * diferencias se corrigen en SAP o en la sincronización, no desde el back-office.
 */
export function CustomerGapsView({ reloadKey }: Props) {
  const [gapType, setGapType] = useState<GapType | null>(null);
  const [companyCode, setCompanyCode] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState({ search: '', companyCode: '' });
  const [page, setPage] = useState(1);
  const [limit] = useState(() => pageSizeForViewport());

  const [available, setAvailable] = useState(true);
  const [rows, setRows] = useState<CustomerGap[]>([]);
  const [summary, setSummary] = useState<Partial<Record<GapType, GapCounts>>>({});
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const companyId = useId();
  const searchId = useId();

  /** Debounce de 300 ms de los textos libres, con vuelta a la página 1. */
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setDebounced({ search: search.trim(), companyCode: companyCode.trim() });
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer.current);
  }, [search, companyCode]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listCustomerGaps({
      gapType,
      companyCode: debounced.companyCode || null,
      search: debounced.search,
      page,
      limit,
    })
      .then((result) => {
        if (cancelled) return;
        setAvailable(result.available);
        setRows(result.data);
        setSummary(result.summary);
        setPagination(result.available ? result.pagination : null);
      })
      .catch((err) => {
        if (cancelled) return;
        setRows([]);
        setPagination(null);
        setError(apiErrorMessage(err, 'No se pudieron cargar los clientes vs SAP.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gapType, debounced, page, limit, reloadKey, retry]);

  async function onExport() {
    setExporting(true);
    setExportError(null);
    try {
      const result = await listCustomerGaps({
        gapType,
        companyCode: debounced.companyCode || null,
        search: debounced.search,
        page: 1,
        limit,
        exportAll: true,
      });
      downloadCsv(
        `consistencia-clientes-sap-${isoDate(new Date())}.csv`,
        toCsv(result.data, CSV_COLUMNS),
      );
    } catch (err) {
      setExportError(apiErrorMessage(err, 'No se pudo generar el archivo para exportar.'));
    } finally {
      setExporting(false);
    }
  }

  if (!loading && !error && !available) {
    return (
      <p className="bo-cn__notice" role="status">
        Todavía no está disponible en este ambiente.
      </p>
    );
  }

  const hasFilters = Boolean(gapType || debounced.companyCode || debounced.search);

  return (
    <>
      <p className="bo-cn__notice">
        Estas diferencias se corrigen en SAP o en la sincronización de clientes, no desde acá.
        La lista sirve para detectarlas y derivarlas.
      </p>

      <SummaryCards
        ariaLabel="Situaciones de clientes vs SAP"
        items={GAP_TYPES.map((t) => ({
          key: t,
          label: GAP_LABEL[t],
          count: summary[t]?.rows ?? 0,
          sub: countsText(summary[t]),
        }))}
        selected={gapType}
        onToggle={(key) => {
          setGapType((prev) => (prev === key ? null : (key as GapType)));
          setPage(1);
        }}
      />

      <div className="bo-cn__toolbar">
        <div className="bo-cn__field">
          <label className="bo-cn__label" htmlFor={companyId}>
            Sociedad
          </label>
          <input
            id={companyId}
            className="bo-cn__input bo-cn__input--short"
            value={companyCode}
            maxLength={10}
            autoComplete="off"
            placeholder="Código"
            onChange={(e) => setCompanyCode(e.target.value)}
          />
        </div>
        <div className="bo-cn__field bo-cn__field--grow">
          <label className="bo-cn__label" htmlFor={searchId}>
            Buscar por vendedor o cliente
          </label>
          <input
            id={searchId}
            className="bo-cn__input"
            value={search}
            autoComplete="off"
            placeholder="Nombre, email, usuario SAP o código de cliente"
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
      ) : loading && rows.length === 0 ? (
        <p className="bo-cn__empty">Cargando clientes vs SAP…</p>
      ) : rows.length === 0 ? (
        <p className="bo-cn__empty">
          {hasFilters
            ? 'No hay diferencias que coincidan con los filtros.'
            : 'No hay diferencias entre las carteras y SAP.'}
        </p>
      ) : (
        <>
          <div className="bo-cn__table-wrap" aria-busy={loading}>
            <table className="bo-cn__table">
              <thead>
                <tr>
                  <th>Vendedor</th>
                  <th>Cliente</th>
                  <th>Sociedad</th>
                  <th>Cartera</th>
                  <th>Situación</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g, i) => (
                  <tr key={`${g.gapType}-${g.guidUsers ?? g.sapUserId ?? ''}-${g.customerCode ?? ''}-${g.companyCode ?? ''}-${g.guidPortfolios ?? ''}-${i}`}>
                    <td>
                      {g.userName ?? 'Sin nombre'}
                      {g.userEmail && <span className="bo-cn__cell-sub">{g.userEmail}</span>}
                      {g.sapUserId && (
                        <span className="bo-cn__cell-sub">Usuario SAP {g.sapUserId}</span>
                      )}
                    </td>
                    <td>
                      {g.customerName ?? 'Sin nombre'}
                      {g.customerCode && <span className="bo-cn__cell-sub">{g.customerCode}</span>}
                    </td>
                    <td>
                      {g.companyCode ?? '—'}
                      {g.companyName && <span className="bo-cn__cell-sub">{g.companyName}</span>}
                    </td>
                    <td>{g.portfolioName ?? '—'}</td>
                    <td className="bo-cn__cell--detail">{GAP_LABEL[g.gapType] ?? 'Otra diferencia'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination && (
            <Pager pagination={pagination} loading={loading} noun="diferencias" onPage={setPage} />
          )}
        </>
      )}
    </>
  );
}
