import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDateTime } from '../soporte/DocumentHeader';
import {
  apiErrorMessage,
  changeItemDestination,
  getReviewCatalogs,
  getReviewOrder,
} from './revision-sap.api';
import {
  blockingItemCount,
  destinationChanges,
  formatSalesArea,
  initialDrafts,
} from './revision-sap.logic';
import {
  DestinationDrafts,
  ReviewCatalogs,
  ReviewOrderDetail as Detail,
} from './revision-sap.types';
import { ReviewItemsTable } from './ReviewItemsTable';
import { ResendConfirmModal } from './ResendConfirmModal';
import { PreviewNotice } from './PreviewNotice';

interface Props {
  guid: string;
  onBack: () => void;
}

type StockState = 'idle' | 'loading' | 'done' | 'failed';

/** Detalle de una orden en revisión: cabecera, motivo del rechazo e ítems. */
export function ReviewOrderDetail({ guid, onBack }: Props) {
  const [order, setOrder] = useState<Detail | null>(null);
  const [catalogs, setCatalogs] = useState<ReviewCatalogs | null>(null);
  const [drafts, setDrafts] = useState<DestinationDrafts>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stockState, setStockState] = useState<StockState>('idle');
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Primero la orden y las opciones SIN stock, que responden enseguida. El stock sale de
  // SAP, una consulta por producto, y puede tardar: se pide aparte y no traba la pantalla.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStockState('idle');
    Promise.all([getReviewOrder(guid), getReviewCatalogs(guid, false)])
      .then(([detail, options]) => {
        if (cancelled) return;
        setOrder(detail);
        setCatalogs(options);
        setDrafts(initialDrafts(detail.items));
        setStockState('loading');
        getReviewCatalogs(guid, true)
          .then((withStock) => {
            if (cancelled) return;
            setCatalogs((prev) => ({
              ...(prev ?? withStock),
              stock: withStock.stock,
              errors: withStock.errors,
            }));
            setStockState('done');
          })
          .catch(() => {
            if (!cancelled) setStockState('failed');
          });
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

  const changes = useMemo(
    () => (order ? destinationChanges(order.items, drafts) : []),
    [order, drafts],
  );
  const blocking = useMemo(
    () =>
      order && catalogs ? blockingItemCount(order.items, drafts, order.centerCode, catalogs) : 0,
    [order, catalogs, drafts],
  );

  const onDestination = useCallback((itemGuid: string, code: string | null) => {
    setDrafts((prev) => ({ ...prev, [itemGuid]: code }));
    setSaveMessage(null);
    setSaveErrors((prev) => {
      if (!(itemGuid in prev)) return prev;
      const next = { ...prev };
      delete next[itemGuid];
      return next;
    });
  }, []);

  function onDiscard() {
    if (!order) return;
    setDrafts(initialDrafts(order.items));
    setSaveErrors({});
    setSaveMessage(null);
  }

  /**
   * Guarda línea por línea. Una que falla no frena a las demás: su error queda al lado
   * de la línea y su cambio sigue pendiente para corregirlo y volver a guardar.
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
        await changeItemDestination(order.guid, change.item.guid, change.after);
        saved += 1;
      } catch (err) {
        errors[change.item.guid] = apiErrorMessage(err, 'No se pudo guardar el destino.');
      }
    }
    try {
      const fresh = await getReviewOrder(order.guid);
      setOrder(fresh);
      setDrafts((prev) => {
        const next = initialDrafts(fresh.items);
        for (const itemGuid of Object.keys(errors)) next[itemGuid] = prev[itemGuid] ?? null;
        return next;
      });
    } catch (err) {
      setError(apiErrorMessage(err, 'Se guardaron los cambios, pero no se pudo recargar la orden.'));
    }
    setSaveErrors(errors);
    const failed = Object.keys(errors).length;
    if (saved > 0) {
      setSaveMessage(
        (saved === 1 ? 'Se guardó 1 destino.' : `Se guardaron ${saved} destinos.`) +
          (failed > 0 ? ` ${failed} no se pudieron guardar.` : ''),
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
  const stockErrors = catalogs.errors.filter((e) => e.source === 'stock');
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
            <dt>Área de venta</dt>
            <dd className="bo-rs__mono">{formatSalesArea(order.salesArea)}</dd>
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
            {order.sapAttempts.length === 1
              ? '1 intento'
              : `${order.sapAttempts.length} intentos`}
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

      <section className="bo-rs__card" aria-labelledby="bo-rs-items-title">
        <header className="bo-rs__card-head">
          <h3 id="bo-rs-items-title" className="bo-rs__card-title">
            Ítems de la orden
          </h3>
          <span className="bo-rs__cell--muted" aria-live="polite">
            Destinos del área {formatSalesArea(order.salesArea)} ·{' '}
            {stockState === 'loading' && 'consultando stock en SAP…'}
            {stockState === 'done' &&
              (stockErrors.length === 0
                ? 'stock actualizado'
                : `sin stock de ${stockErrors.length} producto${stockErrors.length === 1 ? '' : 's'}: SAP no respondió`)}
            {stockState === 'failed' && 'no se pudo consultar el stock'}
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
          onDestination={onDestination}
        />
      </section>

      <div className="bo-rs__actions">
        <p className="bo-rs__actions-status" aria-live="polite">
          {saveMessage ??
            (changes.length === 0
              ? 'Sin cambios'
              : changes.length === 1
                ? '1 destino sin guardar'
                : `${changes.length} destinos sin guardar`)}
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

      {confirmOpen && (
        <ResendConfirmModal
          orderNumber={order.orderNumber}
          itemCount={order.items.length}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </>
  );
}
