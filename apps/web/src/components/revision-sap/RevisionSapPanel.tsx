import { useEffect, useMemo, useState } from 'react';
import { listReviewQueue } from './revision-sap.api';
import { filterQueue } from './revision-sap.logic';
import { ReviewQueueEntry } from './revision-sap.types';
import { ReviewQueueList } from './ReviewQueueList';
import { ReviewOrderDetail } from './ReviewOrderDetail';
import { PreviewNotice } from './PreviewNotice';
import './revision-sap.css';

/**
 * Órdenes rechazadas por SAP.
 *
 * Cuando SAP rechaza una orden, MobilityIA la deja en solo lectura y el control pasa
 * a BackOffice. Dos vistas: la bandeja y, al elegir una orden, su detalle, donde se
 * reasigna centro y destino por línea y se reenvía a SAP.
 */
export function RevisionSapPanel() {
  const [entries, setEntries] = useState<ReviewQueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ReviewQueueEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listReviewQueue()
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch(() => {
        if (!cancelled) {
          setEntries([]);
          setError('No se pudo cargar la bandeja de órdenes rechazadas.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => filterQueue(entries, search), [entries, search]);

  if (selected) {
    return (
      <div className="bo-rs-shell">
        <div className="bo-rs">
          <ReviewOrderDetail guid={selected.guid} onBack={() => setSelected(null)} />
        </div>
      </div>
    );
  }

  return (
    <div className="bo-rs-shell">
      <div className="bo-rs">
        <header className="bo-rs__head">
          <h1 className="bo-rs__title">Órdenes rechazadas por SAP</h1>
          <p className="bo-rs__subtitle">
            Órdenes que SAP no aceptó y esperan revisión. Entrá a una para ver el
            motivo, reasignar el centro de distribución y el destino de cada ítem, y
            reenviarla.
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
              placeholder="ORD-00005241, Finca La Esperanza, vendedor@duwest.com"
              autoComplete="off"
            />
          </label>
          {!loading && !error && (
            <p className="bo-rs__count" aria-live="polite">
              {visible.length === 1
                ? '1 orden en revisión'
                : `${visible.length} órdenes en revisión`}
            </p>
          )}
        </div>

        {error && <p className="bo-rs__error">{error}</p>}
        {loading && <p className="bo-rs__empty">Cargando bandeja…</p>}
        {!loading && !error && (
          <ReviewQueueList
            entries={visible}
            hasSearch={search.trim() !== ''}
            onSelect={setSelected}
          />
        )}
      </div>
    </div>
  );
}
