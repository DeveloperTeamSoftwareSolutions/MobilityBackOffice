import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage, getSummary, listCustomerGaps } from './consistencia.api';
import { Category, Summary } from './consistencia.types';
import { CATEGORY_TABS, formatAgo } from './consistencia.format';
import { FindingsView, ReloadRequest } from './FindingsView';
import { CustomerGapsView } from './CustomerGapsView';
import './consistencia.css';

type Tab = Category | 'CLIENTES';

/** Cuánto queda visible el aviso de una corrección guardada. */
const NOTICE_MS = 6000;

/**
 * Consistencia de datos comerciales: jerarquía, carteras y usuarios que no cierran
 * entre sí, y su corrección cuando se puede hacer desde acá.
 */
export function ConsistencyPanel() {
  const [tab, setTab] = useState<Tab>('JERARQUIA');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [reload, setReload] = useState<ReloadRequest>({ key: 0, refresh: false });
  const [gapsTotal, setGapsTotal] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const loadSummary = useCallback(async (refresh: boolean) => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      setSummary(await getSummary(refresh));
      setNow(Date.now());
    } catch (err) {
      setSummaryError(apiErrorMessage(err, 'No se pudo cargar el resumen de consistencia.'));
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary(false);
  }, [loadSummary]);

  /** El total de la pestaña de clientes vs SAP; `null` si no está disponible o falló. */
  useEffect(() => {
    let cancelled = false;
    listCustomerGaps({ page: 1, limit: 1 })
      .then((r) => {
        if (cancelled) return;
        setGapsTotal(
          r.available
            ? Object.values(r.summary).reduce((acc, c) => acc + (c?.rows ?? 0), 0)
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setGapsTotal(null);
      });
    return () => {
      cancelled = true;
    };
  }, [reload.key]);

  /** "Generado hace X" se mantiene al día sin volver a pedir nada. */
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(id);
  }, [notice]);

  /** Recalcula en el servidor el resumen y la página que se está mirando. */
  const refreshAll = useCallback(() => {
    void loadSummary(true);
    setReload((prev) => ({ key: prev.key + 1, refresh: true }));
  }, [loadSummary]);

  const onChanged = useCallback(
    (message: string) => {
      setNotice(message);
      refreshAll();
    },
    [refreshAll],
  );

  const groups = summary?.groups ?? [];

  return (
    <div className="bo-cn-shell">
      <div className="bo-cn">
        <header className="bo-cn__head">
          <div className="bo-cn__head-text">
            <h1 className="bo-cn__title">Consistencia de datos</h1>
            <p className="bo-cn__subtitle">
              Jerarquía comercial, carteras y usuarios que no cierran entre sí, y su
              corrección cuando se puede hacer desde acá.
            </p>
          </div>
          <div className="bo-cn__head-actions">
            {summary && (
              <span className="bo-cn__generated" title={new Date(summary.generatedAt).toLocaleString('es-AR')}>
                Generado {formatAgo(summary.generatedAt, now)}
              </span>
            )}
            <button
              type="button"
              className="bo-cn__button"
              disabled={summaryLoading}
              onClick={refreshAll}
            >
              {summaryLoading ? 'Actualizando…' : 'Actualizar'}
            </button>
          </div>
        </header>

        {notice && (
          <p className="bo-cn__success" role="status">
            {notice}
          </p>
        )}

        {summaryError && (
          <div className="bo-cn__error" role="alert">
            <span>{summaryError}</span>
            <button
              type="button"
              className="bo-cn__link-button"
              onClick={() => void loadSummary(false)}
            >
              Reintentar
            </button>
          </div>
        )}

        <div className="bo-cn__tabs" role="tablist" aria-label="Categorías">
          {CATEGORY_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`bo-cn__tab ${tab === t.key ? 'bo-cn__tab--active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {summary && (
                <span className="bo-cn__tab-count">
                  {(summary.categories[t.key] ?? 0).toLocaleString('es-AR')}
                </span>
              )}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'CLIENTES'}
            className={`bo-cn__tab ${tab === 'CLIENTES' ? 'bo-cn__tab--active' : ''}`}
            onClick={() => setTab('CLIENTES')}
          >
            Clientes vs SAP
            {gapsTotal !== null && (
              <span className="bo-cn__tab-count">{gapsTotal.toLocaleString('es-AR')}</span>
            )}
          </button>
        </div>

        <div className="bo-cn__tab-panel" role="tabpanel">
          {tab === 'CLIENTES' ? (
            <CustomerGapsView reloadKey={reload.key} />
          ) : (
            <>
              {tab === 'USUARIOS_SAP' && summary && !summary.sapAccountsAvailable && (
                <p className="bo-cn__notice" role="status">
                  Los datos de usuarios de SAP no están cargados en este ambiente: las
                  situaciones que dependen de ellos no se pueden evaluar todavía.
                </p>
              )}
              <FindingsView
                key={tab}
                category={tab}
                groups={groups.filter((g) => g.category === tab)}
                reload={reload}
                onChanged={onChanged}
                onReloadRequested={refreshAll}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
