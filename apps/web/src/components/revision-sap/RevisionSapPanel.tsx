import { useEffect, useRef, useState } from 'react';
import { apiErrorMessage, listReviewQueue } from './revision-sap.api';
import { Pagination, ReviewQueueEntry, SortDir, SortField } from './revision-sap.types';
import { ReviewQueueList } from './ReviewQueueList';
import { ReviewOrderDetail } from './ReviewOrderDetail';
import { PreviewNotice } from './PreviewNotice';
import './revision-sap.css';

/** Alto de fila estimado para calcular cuántas entran en el viewport. */
const ROW_HEIGHT = 58;
const CHROME_HEIGHT = 440;

function pageSizeForViewport(): number {
  const rows = Math.floor((window.innerHeight - CHROME_HEIGHT) / ROW_HEIGHT);
  return Math.min(100, Math.max(10, rows));
}

/**
 * Órdenes rechazadas por SAP.
 *
 * Cuando SAP rechaza una orden, MobilityIA la deja en solo lectura y el control pasa
 * a BackOffice. Dos vistas: la bandeja y, al elegir una orden, su detalle, donde se
 * corrige el destino de cada ítem. Búsqueda, orden y paginación son del servidor.
 */
export function RevisionSapPanel() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('sapLastAttemptAt');
  const [sortDir, setSortDir] = useState<SortDir>('DESC');
  const [page, setPage] = useState(1);
  const [limit] = useState(pageSizeForViewport);

  const [entries, setEntries] = useState<ReviewQueueEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReviewQueueEntry | null>(null);
  const [reload, setReload] = useState(0);

  const searchTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(searchTimer.current);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listReviewQueue({ page, limit, search: debouncedSearch, sortBy, sortDir })
      .then((result) => {
        if (cancelled) return;
        setEntries(result.data);
        setPagination(result.pagination);
      })
      .catch((err) => {
        if (cancelled) return;
        setEntries([]);
        setPagination(null);
        setError(apiErrorMessage(err, 'No se pudo cargar la bandeja de órdenes rechazadas.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, limit, debouncedSearch, sortBy, sortDir, reload]);

  function onSort(field: SortField) {
    if (field === sortBy) {
      setSortDir(sortDir === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(field);
      setSortDir(field === 'sapLastAttemptAt' ? 'DESC' : 'ASC');
    }
    setPage(1);
  }

  if (selected) {
    return (
      <div className="bo-rs-shell">
        <div className="bo-rs">
          <ReviewOrderDetail
            guid={selected.guid}
            onBack={() => {
              setSelected(null);
              setReload((n) => n + 1);
            }}
          />
        </div>
      </div>
    );
  }

  const total = pagination?.total ?? 0;

  return (
    <div className="bo-rs-shell">
      <div className="bo-rs">
        <header className="bo-rs__head">
          <h1 className="bo-rs__title">Órdenes rechazadas por SAP</h1>
          <p className="bo-rs__subtitle">
            Órdenes que SAP no aceptó y esperan revisión. Entrá a una para ver el
            motivo y corregir el destino de entrega de cada ítem.
          </p>
        </header>

        <PreviewNotice />

        <div className="bo-rs__toolbar">
          <label className="bo-rs__field bo-rs__field--grow">
            <span className="bo-rs__label">Buscar por orden, cliente o vendedor</span>
            <input
              className="bo-rs__input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ORD00005724, DEMASA, vendedor@duwest.com"
              autoComplete="off"
            />
          </label>
          {!loading && !error && (
            <p className="bo-rs__count" aria-live="polite">
              {total === 1 ? '1 orden en revisión' : `${total.toLocaleString('es-AR')} órdenes en revisión`}
            </p>
          )}
        </div>

        {error && <p className="bo-rs__error">{error}</p>}
        {loading && entries.length === 0 && !error && (
          <p className="bo-rs__empty">Cargando bandeja…</p>
        )}
        {!error && !(loading && entries.length === 0) && (
          <ReviewQueueList
            entries={entries}
            pagination={pagination}
            sortBy={sortBy}
            sortDir={sortDir}
            loading={loading}
            hasSearch={debouncedSearch !== ''}
            onSort={onSort}
            onSelect={setSelected}
            onPage={setPage}
          />
        )}
      </div>
    </div>
  );
}
