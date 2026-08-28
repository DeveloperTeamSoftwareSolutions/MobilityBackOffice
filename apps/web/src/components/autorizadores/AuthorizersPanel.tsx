import { useCallback, useEffect, useState } from 'react';
import { getCountryManagers, getMatrix } from './autorizadores.api';
import {
  AuthorizersPage,
  AvailableCompany,
  CountryManagersResult,
  MatrixFilter,
  SortableField,
} from './autorizadores.types';
import { CompanySelect } from './CompanySelect';
import { MatrixSummaryBar } from './MatrixSummaryBar';
import { AuthorizersTable } from './AuthorizersTable';
import { CountryManagersPanel } from './CountryManagersPanel';
import { MatrixOrigin } from './MatrixOrigin';
import './autorizadores.css';

const PAGE_SIZE = 25;

/**
 * Matriz de autorizadores — consulta.
 *
 * Reemplaza tener que entrar a la base para saber quién autoriza. Es SOLO LECTURA: las
 * tablas se replican de SAP, así que una fila cargada a mano la pisa la próxima
 * sincronización. Si hay que cambiar la matriz, es un pedido a SAP.
 *
 * Arranca sin sociedad elegida porque el endpoint del middleware exige `companyCode` y no
 * hay “matriz completa” en una llamada.
 */
export function AuthorizersPanel() {
  const [company, setCompany] = useState<AvailableCompany | null>(null);
  const [page, setPage] = useState<AuthorizersPage | null>(null);
  const [countryManagers, setCountryManagers] = useState<CountryManagersResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [pageNum, setPageNum] = useState(1);
  const [sortBy, setSortBy] = useState<SortableField>('userEmail');
  const [sortDir, setSortDir] = useState<'ASC' | 'DESC'>('ASC');
  const [filter, setFilter] = useState<MatrixFilter>('all');
  const [activeOnly, setActiveOnly] = useState(false);

  // Debounce del buscador: 300ms, y toda búsqueda vuelve a la primera página.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPageNum(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    if (!company) return;
    let active = true;
    setLoading(true);
    setError(null);

    getMatrix({
      companyCode: company.code,
      page: pageNum,
      limit: PAGE_SIZE,
      search: debounced,
      sortBy,
      sortDir,
      filter,
      activeOnly,
    })
      .then((res) => active && setPage(res))
      .catch(() => {
        if (!active) return;
        setPage(null);
        setError('No se pudo cargar la matriz de esta sociedad.');
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [company, pageNum, debounced, sortBy, sortDir, filter, activeOnly]);

  useEffect(() => load(), [load]);

  // Los Country Managers dependen solo de la sociedad: no se recargan al filtrar ni al
  // paginar la matriz.
  useEffect(() => {
    if (!company) {
      setCountryManagers(null);
      return;
    }
    let active = true;
    setCountryManagers(null);
    getCountryManagers(company.code)
      .then((res) => active && setCountryManagers(res))
      .catch(
        () =>
          active && setCountryManagers({ available: false, diagnosis: 'unavailable', nodes: [] }),
      );
    return () => {
      active = false;
    };
  }, [company]);

  const pickCompany = (picked: AvailableCompany) => {
    setCompany(picked);
    setPageNum(1);
    setFilter('all');
    setSearch('');
    setDebounced('');
  };

  const sort = (field: SortableField) => {
    if (field === sortBy) {
      setSortDir((d) => (d === 'ASC' ? 'DESC' : 'ASC'));
    } else {
      setSortBy(field);
      setSortDir('ASC');
    }
    setPageNum(1);
  };

  const changeFilter = (next: MatrixFilter) => {
    setFilter(next);
    setPageNum(1);
  };

  return (
    <>
      <h1 className="bo-page__title">Matriz de autorizadores</h1>
      <p className="bo-page__subtitle">
        Quién puede autorizar en cada sociedad y con qué límites de descuento. Es una consulta:
        la matriz se replica de SAP y no se edita desde acá.
      </p>

      <div className="bo-card bo-az__toolbar">
        <CompanySelect selected={company} onPick={pickCompany} disabled={loading} />

        {company && (
          <>
            <div className="bo-az__searchbox">
              <label className="bo-az__pickerlabel" htmlFor="bo-az-search">
                Buscar
              </label>
              <input
                id="bo-az-search"
                type="search"
                className="bo-az__pickerinput"
                placeholder="Correo, usuario SAP o CEBE…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <label className="bo-az__check">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(e) => {
                  setActiveOnly(e.target.checked);
                  setPageNum(1);
                }}
              />
              <span>Solo asignaciones vigentes</span>
            </label>
          </>
        )}
      </div>

      {!company && (
        <div className="bo-card">
          <p className="bo-az__empty">
            Elegí una sociedad para ver su matriz. La consulta se hace por sociedad porque es
            el eje por el que se define el alcance de cada autorizador.
          </p>
        </div>
      )}

      {company && error && (
        <div className="bo-card">
          <p className="bo-az__warn">{error}</p>
        </div>
      )}

      {company && !error && page && (
        <>
          <MatrixSummaryBar summary={page.summary} filter={filter} onFilter={changeFilter} />

          <div className="bo-card">
            {loading && <p className="bo-az__empty">Cargando…</p>}

            {!loading && page.data.length === 0 && (
              <p className="bo-az__empty">
                {page.summary.total === 0
                  ? `La sociedad ${company.code} no tiene ningún autorizador cargado en la matriz.`
                  : 'Ningún autorizador coincide con la búsqueda o el filtro elegido.'}
              </p>
            )}

            {!loading && page.data.length > 0 && (
              <>
                <AuthorizersTable
                  rows={page.data}
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={sort}
                />

                <div className="bo-az__pager">
                  <span className="bo-az__pagerinfo">
                    {page.pagination.total} autorizador(es) · página {page.pagination.page} de{' '}
                    {page.pagination.totalPages}
                  </span>
                  <div className="bo-az__pagerbtns">
                    <button
                      type="button"
                      className="bo-az__pagerbtn"
                      disabled={page.pagination.page <= 1}
                      onClick={() => setPageNum((p) => Math.max(1, p - 1))}
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      className="bo-az__pagerbtn"
                      disabled={page.pagination.page >= page.pagination.totalPages}
                      onClick={() => setPageNum((p) => p + 1)}
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              </>
            )}

            <MatrixOrigin />
          </div>
        </>
      )}

      {company && (
        <div className="bo-card">
          <CountryManagersPanel result={countryManagers} />
        </div>
      )}
    </>
  );
}
