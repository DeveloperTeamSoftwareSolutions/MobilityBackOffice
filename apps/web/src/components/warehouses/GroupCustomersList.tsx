import { useEffect, useState } from 'react';
import { getGroupCustomers } from './warehouses.api';
import { GroupCustomer, Pagination } from './warehouses.types';
import { apiErrorMessage } from '../../api/authApi';

const PAGE_SIZE = 20;
const EMPTY: Pagination = { total: 0, page: 1, limit: PAGE_SIZE, totalPages: 0 };

/**
 * Clientes de un grupo en la sociedad del almacén, paginados **en el servidor** (un grupo
 * como `T3` Ingenio El Ángel tiene 715). Es sólo lectura: la pertenencia al grupo la decide
 * SAP, no esta pantalla.
 */
export function GroupCustomersList({
  companyCode,
  customerGroupCode,
}: {
  companyCode: string;
  customerGroupCode: string;
}) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<GroupCustomer[]>([]);
  const [pagination, setPagination] = useState<Pagination>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getGroupCustomers(companyCode, customerGroupCode, page, PAGE_SIZE)
      .then((r) => {
        if (!active) return;
        setRows(r.data);
        setPagination(r.pagination);
      })
      .catch((e) => {
        if (active) {
          setError(apiErrorMessage(e, 'No se pudieron cargar los clientes del grupo'));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [companyCode, customerGroupCode, page]);

  if (error) return <p className="bo-wh__drillhint">{error}</p>;

  return (
    <div className="bo-wh__groupcustomers">
      {loading && <p className="bo-wh__drillhint">Cargando clientes del grupo…</p>}
      {!loading && rows.length === 0 && (
        <p className="bo-wh__drillhint">El grupo no tiene clientes en esta sociedad.</p>
      )}
      {!loading && rows.length > 0 && (
        <ul className="bo-wh__customers" aria-label={`Clientes del grupo ${customerGroupCode}`}>
          {rows.map((c, i) => (
            <li key={`${c.customerCode ?? ''}-${i}`}>
              <span className="bo-wh__custinfo">
                <span className="bo-wh__code">{c.customerCode || '—'}</span>
                {c.customerName && <span className="bo-wh__sub">{c.customerName}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {pagination.totalPages > 1 && (
        <div className="bo-wh__pagerbtns bo-wh__grouppager">
          <button
            type="button"
            disabled={loading || pagination.page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </button>
          <span className="bo-wh__pageinfo">
            Página {pagination.page} de {pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={loading || pagination.page >= pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
