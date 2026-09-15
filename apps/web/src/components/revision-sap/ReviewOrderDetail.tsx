import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDateTime } from '../soporte/DocumentHeader';
import {
  apiErrorMessage,
  changeItemCenter,
  changeItemDestination,
  getReviewCatalogs,
  getReviewOrder,
} from './revision-sap.api';
import {
  blockingItemCount,
  initialDrafts,
  lineChanges,
  salesAreaParts,
  sapOrdersByCenter,
} from './revision-sap.logic';
import {
  LineDraft,
  LineDrafts,
  ReviewCatalogs,
  ReviewOrderDetail as Detail,
} from './revision-sap.types';
import { ReviewItemsTable } from './ReviewItemsTable';
import { ResendConfirmModal } from './ResendConfirmModal';
import { PreviewNotice } from './PreviewNotice';
import { SapOrdersPanel } from './SapOrdersPanel';

interface Props {
  guid: string;
  onBack: () => void;
}

type Tab = 'items' | 'sap-orders';

/** Detalle de una orden en revisión: cabecera, motivo del rechazo, ítems y órdenes SAP. */
export function ReviewOrderDetail({ guid, onBack }: Props) {
  const [order, setOrder] = useState<Detail | null>(null);
  const [catalogs, setCatalogs] = useState<ReviewCatalogs | null>(null);
  const [drafts, setDrafts] = useState<LineDrafts>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('items');
  const [refreshKey, setRefreshKey] = useState(0);

  // La orden y sus opciones (centros permitidos y destinos del área). El stock de SAP no
  // se consulta desde esta pantalla: SAP lo revalida al enviar.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getReviewOrder(guid), getReviewCatalogs(guid, false)])
      .then(([detail, options]) => {
        if (cancelled) return;
        setOrder(detail);
        setCatalogs(options);
        setDrafts(initialDrafts(detail.items));
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, 'No se pudo cargar la orden.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [guid]);

  const changes = useMemo(() => (order ? lineChanges(order.items, drafts) : []), [order, drafts]);
  const blocking = useMemo(
    () =>
      order && catalogs ? blockingItemCount(order.items, drafts, order.centerCode, catalogs) : 0,
    [order, catalogs, drafts],
  );
  const groups = useMemo(
    () => (order ? sapOrdersByCenter(order.items, drafts, order.centerCode) : []),
    [order, drafts],
  );

  const onChange = useCallback((itemGuid: string, next: LineDraft) => {
    setDrafts((prev) => ({ ...prev, [itemGuid]: next }));
    setSaveMessage(null);
    setSaveErrors((prev) => {
      if (!(itemGuid in prev)) return prev;
      const rest = { ...prev };
      delete rest[itemGuid];
      return rest;
    });
  }, []);

  function onDiscard() {
    if (!order) return;
    setDrafts(initialDrafts(order.items));
    setSaveErrors({});
    setSaveMessage(null);
  }

  /**
   * Guarda cambio por cambio. Uno que falla no frena a los demás: su error queda al lado
   * de la línea y ese cambio sigue pendiente para corregirlo y volver a guardar.
   */
  async function onSave() {
    if (!order || changes.length === 0) return;
    setSaving(true);
    setSaveMessage(null);
    const errors: Record<string, string> = {};
    let saved = 0;
    for (const change of changes) {
      if (!change.after) continue;
      try {
        if (change.field === 'center') {
          await changeItemCenter(order.guid, change.item.guid, change.after);
        } else {
          await changeItemDestination(order.guid, change.item.guid, change.after);
        }
        saved += 1;
      } catch (err) {
        const fallback =
          change.field === 'center' ? 'No se pudo guardar el centro.' : 'No se pudo guardar el destino.';
        errors[change.item.guid] = apiErrorMessage(err, fallback);
      }
    }
    try {
      const fresh = await getReviewOrder(order.guid);
      setOrder(fresh);
      setDrafts((prev) => {
        const next = initialDrafts(fresh.items);
        for (const itemGuid of Object.keys(errors)) {
          if (prev[itemGuid]) next[itemGuid] = prev[itemGuid];
        }
        return next;
      });
      setRefreshKey((n) => n + 1);
    } catch (err) {
      setError(apiErrorMessage(err, 'Se guardaron los cambios, pero no se pudo recargar la orden.'));
    }
    setSaveErrors(errors);
    const failed = Object.keys(errors).length;
    if (saved > 0) {
      setSaveMessage(
        (saved === 1 ? 'Se guardó 1 cambio.' : `Se guardaron ${saved} cambios.`) +
          (failed > 0 ? ` ${failed === 1 ? '1 línea no' : `${failed} líneas no`} se pudo guardar.` : ''),
      );
    }
    setSaving(false);
  }

  const backBar = (
    <div className="bo-rs__detail-bar">
      <button type="button" className="bo-rs__back" onClick={onBack}>
        ← Volver a la bandeja
      </button>
    </div>
  );

  if (loading || error || !order || !catalogs) {
    return (
      <>
        {backBar}
        {error ? (
          <p className="bo-rs__error">{error}</p>
        ) : (
          <p className="bo-rs__empty">Cargando orden…</p>
        )}
      </>
    );
  }

  const editable = order.backoffice.inReview && !saving;
  const lastError = order.sap.lastError ?? order.sapAttempts.find((a) => a.error)?.error ?? null;
  const previousAttempts = order.sapAttempts.filter((a) => a.error).slice(1);
  const otherErrors = catalogs.errors.filter((e) => e.source !== 'stock');

  return (
    <>
      {backBar}
      <PreviewNotice />

      {!order.backoffice.inReview && (
        <p className="bo-rs__error" role="status">
          Esta orden ya no está en revisión de BackOffice
          {order.backoffice.decidedBy
            ? ` (la cerró ${order.backoffice.decidedBy} el ${formatDateTime(order.backoffice.decidedAt)})`
            : ''}
          . Se muestra en solo lectura.
        </p>
      )}

      <section className="bo-rs__card" aria-labelledby="bo-rs-order-title">
        <header className="bo-rs__card-head">
          <h2 id="bo-rs-order-title" className="bo-rs__doc-number">
            {order.orderNumber}
          </h2>
          {order.backoffice.inReview && (
            <span className="bo-rs__status">En revisión por BackOffice</span>
          )}
        </header>
        <dl className="bo-rs__facts">
          <div className="bo-rs__fact">
            <dt>Cliente</dt>
            <dd>
              {order.customerName ?? '—'}
              {order.customerCode && <span className="bo-rs__cell-sub">{order.customerCode}</span>}
            </dd>
          </div>
          <div className="bo-rs__fact">
            <dt>Vendedor</dt>
            <dd>{order.sellerName ?? order.sellerEmail ?? '—'}</dd>
          </div>
          <div className="bo-rs__fact">
            <dt title="Organización de ventas de SAP: sociedad / canal de distribución / sector">
              Área de venta
            </dt>
            <dd>
              <ul className="bo-rs__area">
                {salesAreaParts(order.salesArea).map((p) => (
                  <li key={p.label}>
                    <span className="bo-rs__area-label">{p.label}</span> {p.value}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div className="bo-rs__fact">
            <dt>Fecha de la orden</dt>
            <dd>{formatDateTime(order.orderDate)}</dd>
          </div>
          <div className="bo-rs__fact">
            <dt>Centro de cabecera</dt>
            <dd>
              <span className="bo-rs__mono">{order.centerCode ?? '—'}</span>
              {order.centerName && <span className="bo-rs__cell-sub">{order.centerName}</span>}
            </dd>
          </div>
          <div className="bo-rs__fact">
            <dt>Destino de cabecera</dt>
            <dd className="bo-rs__mono">{order.destination ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="bo-rs__card bo-rs__card--sap" aria-labelledby="bo-rs-sap-title">
        <header className="bo-rs__card-head">
          <h3 id="bo-rs-sap-title" className="bo-rs__card-title">
            Motivo del rechazo de SAP
          </h3>
          <span className="bo-rs__cell--muted">
            {order.sapAttempts.length === 1 ? '1 intento' : `${order.sapAttempts.length} intentos`}
            {order.sap.lastAttemptAt ? ` · último ${formatDateTime(order.sap.lastAttemptAt)}` : ''}
          </span>
        </header>
        <p className="bo-rs__sap-message">{lastError ?? 'SAP no devolvió un motivo.'}</p>
        {previousAttempts.length > 0 && (
          <details className="bo-rs__attempts">
            <summary>Intentos anteriores ({previousAttempts.length})</summary>
            <ol className="bo-rs__attempt-list">
              {previousAttempts.map((attempt) => (
                <li key={attempt.guid}>
                  <span className="bo-rs__cell--muted">{formatDateTime(attempt.attemptAt)}</span>{' '}
                  {attempt.error}
                </li>
              ))}
            </ol>
          </details>
        )}
      </section>

      <div className="bo-rs__tabs" role="tablist" aria-label="Contenido de la orden">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'items'}
          className={`bo-rs__tab${tab === 'items' ? ' bo-rs__tab--active' : ''}`}
          onClick={() => setTab('items')}
        >
          Ítems
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'sap-orders'}
          className={`bo-rs__tab${tab === 'sap-orders' ? ' bo-rs__tab--active' : ''}`}
          onClick={() => setTab('sap-orders')}
        >
          Órdenes SAP
        </button>
      </div>

      {tab === 'sap-orders' ? (
        <section className="bo-rs__card" aria-label="Órdenes SAP">
          <SapOrdersPanel orderGuid={order.guid} refreshKey={refreshKey} />
        </section>
      ) : (
        <>
          <section className="bo-rs__card" aria-labelledby="bo-rs-items-title">
            <header className="bo-rs__card-head">
              <h3 id="bo-rs-items-title" className="bo-rs__card-title">
                Ítems de la orden
              </h3>
              <span className="bo-rs__cell--muted" aria-live="polite">
                {groups.length === 1
                  ? 'Si se reenvía así, sale en 1 orden SAP'
                  : `Si se reenvía así, sale en ${groups.length} órdenes SAP, una por centro`}
              </span>
            </header>
            {otherErrors.length > 0 && (
              <p className="bo-rs__error">
                No se pudo cargar todo lo necesario para corregir la orden:{' '}
                {otherErrors.map((e) => e.message).join(' · ')}
              </p>
            )}
            <ReviewItemsTable
              items={order.items}
              headerCenterCode={order.centerCode}
              drafts={drafts}
              catalogs={catalogs}
              editable={editable}
              saveErrors={saveErrors}
              onChange={onChange}
            />
          </section>

          <div className="bo-rs__actions">
            <p className="bo-rs__actions-status" aria-live="polite">
              {saveMessage ??
                (changes.length === 0
                  ? 'Sin cambios'
                  : changes.length === 1
                    ? '1 cambio sin guardar'
                    : `${changes.length} cambios sin guardar`)}
              {blocking > 0 && (
                <span className="bo-rs__actions-blocking">
                  {' '}
                  · {blocking === 1 ? '1 ítem necesita corrección' : `${blocking} ítems necesitan corrección`}
                </span>
              )}
            </p>
            <div className="bo-rs__actions-buttons">
              <button
                type="button"
                className="bo-rs__button bo-rs__button--ghost"
                disabled={changes.length === 0 || saving}
                onClick={onDiscard}
              >
                Descartar cambios
              </button>
              <button
                type="button"
                className="bo-rs__button bo-rs__button--ghost"
                disabled={changes.length === 0 || blocking > 0 || !editable}
                onClick={() => void onSave()}
              >
                {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
              <button
                type="button"
                className="bo-rs__button"
                disabled={changes.length > 0 || blocking > 0 || !order.backoffice.inReview}
                title={changes.length > 0 ? 'Guardá los cambios antes de reenviar' : undefined}
                onClick={() => setConfirmOpen(true)}
              >
                Reenviar a SAP
              </button>
            </div>
          </div>
        </>
      )}

      {confirmOpen && (
        <ResendConfirmModal
          orderNumber={order.orderNumber}
          itemCount={order.items.length}
          sapOrderCount={groups.length}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </>
  );
}
