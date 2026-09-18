import { Fragment, useEffect, useRef, useState } from 'react';
import { getWarehousesOfCenter } from './warehouses.api';
import { WarehouseReservations } from './WarehouseReservations';
import { Center, Pagination, Warehouse } from './warehouses.types';
import { reservationsLabel } from './warehouses.format';
import { apiErrorMessage } from '../../api/authApi';

const PAGE_SIZE = 50;
const EMPTY: Pagination = { total: 0, page: 1, limit: PAGE_SIZE, totalPages: 0 };

/**
 * Almacenes de un centro. La restricción NACE de las reservas: un almacén disponible se
 * reserva asignándole el primer cliente o grupo, y vuelve a quedar disponible al quitar la
 * última. El filtro "Ver solo restringidos" deja los reservados; el drill expandible lista
 * y gestiona sus reservas.
 */
export function CenterWarehouses({
  center,
  onBack,
}: {
  center: Center;
  onBack: () => void;
}) {
  const [rows, setRows] = useState<Warehouse[]>([]);
  const [pagination, setPagination] = useState<Pagination>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onlyRestricted, setOnlyRestricted] = useState(false);
  const [page, setPage] = useState(1);

  const [expandedGuid, setExpandedGuid] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  /** La próxima recarga viene de un cambio en las reservas: no ocultar la tabla. */
  const silentReload = useRef(false);

  const cc = center.companyCode ?? '';
  const ce = center.centerCode ?? '';

  useEffect(() => {
    setPage(1);
  }, [search, onlyRestricted]);

  useEffect(() => {
    let active = true;
    // Una recarga por un cambio en las reservas no vacía la tabla: el drill abierto sigue
    // montado y el usuario no pierde dónde estaba.
    if (!silentReload.current) setLoading(true);
    silentReload.current = false;
    setError(null);
    const t = setTimeout(
      () => {
        getWarehousesOfCenter(cc, ce, { search, onlyRestricted, page, limit: PAGE_SIZE })
          .then((r) => {
            if (!active) return;
            setRows(r.data);
            setPagination(r.pagination);
          })
          .catch((e) => {
            if (active) setError(apiErrorMessage(e, 'No se pudieron cargar los almacenes'));
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      },
      search ? 300 : 0,
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [cc, ce, page, search, onlyRestricted, refreshKey]);

  const reloadWarehouses = () => {
    silentReload.current = true;
    setRefreshKey((k) => k + 1);
  };

  const from = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const to = Math.min(pagination.page * pagination.limit, pagination.total);

  return (
    <div className="bo-wh">
      <header className="bo-wh__head">
        <button type="button" className="bo-wh__back" onClick={onBack}>
          Volver a centros
        </button>
        <h1 className="bo-wh__title">{center.centerName || center.centerCode}</h1>
        <p className="bo-wh__subtitle">
          Almacenes del centro {center.centerCode} · Sociedad {center.companyCode}. Los
          restringidos están reservados a clientes o a grupos de clientes.
        </p>
      </header>

      <div className="bo-wh__toolbar">
        <input
          type="search"
          className="bo-wh__search"
          placeholder="Buscar por almacén o dirección…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="bo-wh__toggle">
          <input
            type="checkbox"
            checked={onlyRestricted}
            onChange={(e) => setOnlyRestricted(e.target.checked)}
          />
          <span>Ver solo restringidos</span>
        </label>
      </div>

      {error && <p className="bo-wh__error">{error}</p>}

      <div className="bo-wh__tablewrap">
        <table className="bo-wh__table">
          <thead>
            <tr>
              <th>Almacén</th>
              <th>Dirección</th>
              <th>Reservado a</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {!loading &&
              rows.map((w) => {
                const open = expandedGuid === w.guid;
                return (
                  <Fragment key={w.guid}>
                    <tr className={w.restricted ? 'bo-wh__row--restricted' : ''}>
                      <td>
                        <span className="bo-wh__code">{w.warehouseCode || '—'}</span>
                        {w.warehouseName && (
                          <span className="bo-wh__sub">{w.warehouseName}</span>
                        )}
                      </td>
                      <td>{w.warehouseAddress || '—'}</td>
                      <td>{reservationsLabel(w.customerCount, w.groupCount) ?? '—'}</td>
                      <td className="bo-wh__statecell">
                        {w.restricted ? (
                          <span className="bo-wh__badge bo-wh__badge--restricted">
                            Restringido
                          </span>
                        ) : (
                          <span className="bo-wh__badge bo-wh__badge--available">
                            Disponible
                          </span>
                        )}
                        <button
                          type="button"
                          className="bo-wh__ghostbtn"
                          aria-expanded={open}
                          onClick={() => setExpandedGuid(open ? null : w.guid)}
                        >
                          {open ? 'Cerrar' : w.restricted ? 'Ver reservas' : 'Reservar'}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bo-wh__drillrow">
                        <td colSpan={4}>
                          <WarehouseReservations warehouse={w} onChanged={reloadWarehouses} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
          </tbody>
        </table>

        {loading && <p className="bo-wh__hint">Cargando…</p>}
        {!loading && !error && rows.length === 0 && (
          <p className="bo-wh__hint">
            {onlyRestricted
              ? 'No hay almacenes restringidos en este centro.'
              : 'No hay almacenes para mostrar.'}
          </p>
        )}
      </div>

      <footer className="bo-wh__pager">
        <span className="bo-wh__count">
          {pagination.total > 0 ? `${from}–${to} de ${pagination.total}` : 'Sin resultados'}
        </span>
        <div className="bo-wh__pagerbtns">
          <button
            type="button"
            disabled={loading || pagination.page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </button>
          <span className="bo-wh__pageinfo">
            Página {pagination.page} de {Math.max(1, pagination.totalPages)}
          </span>
          <button
            type="button"
            disabled={loading || pagination.page >= pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </button>
        </div>
      </footer>
    </div>
  );
}
