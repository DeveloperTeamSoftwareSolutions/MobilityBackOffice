import { useEffect, useMemo, useState } from 'react';
import { formatDateTime } from '../soporte/DocumentHeader';
import {
  getReviewCatalogs,
  getReviewOrder,
  ReviewOrderNotFoundError,
} from './revision-sap.api';
import {
  blockingItemCount,
  changedItems,
  formatSalesArea,
  initialAssignments,
} from './revision-sap.logic';
import {
  Assignments,
  ItemAssignment,
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

/** Detalle de una orden en revisión: cabecera, motivo del rechazo e ítems. */
export function ReviewOrderDetail({ guid, onBack }: Props) {
  const [order, setOrder] = useState<Detail | null>(null);
  const [catalogs, setCatalogs] = useState<ReviewCatalogs | null>(null);
  const [assignments, setAssignments] = useState<Assignments>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getReviewOrder(guid), getReviewCatalogs(guid)])
      .then(([detail, options]) => {
        if (cancelled) return;
        setOrder(detail);
        setCatalogs(options);
        setAssignments(initialAssignments(detail.items));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ReviewOrderNotFoundError
            ? 'La orden ya no está en revisión.'
            : 'No se pudo cargar la orden.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [guid]);

  const changes = useMemo(
    () => (order ? changedItems(order.items, assignments) : []),
    [order, assignments],
  );
  const blocking = useMemo(
    () => (order && catalogs ? blockingItemCount(order.items, assignments, catalogs) : 0),
    [order, catalogs, assignments],
  );

  function onAssign(itemGuid: string, next: ItemAssignment) {
    setAssignments((prev) => ({ ...prev, [itemGuid]: next }));
  }

  function onDiscard() {
    if (order) setAssignments(initialAssignments(order.items));
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

  const [lastAttempt, ...previousAttempts] = order.sapAttempts;

  return (
    <>
      {backBar}
      <PreviewNotice />

      <section className="bo-rs__card" aria-labelledby="bo-rs-order-title">
        <header className="bo-rs__card-head">
          <h2 id="bo-rs-order-title" className="bo-rs__doc-number">
            {order.orderNumber}
          </h2>
          <span className="bo-rs__status">En revisión por BackOffice</span>
        </header>
        <dl className="bo-rs__facts">
          <div className="bo-rs__fact">
            <dt>Cliente</dt>
            <dd>
              {order.customerName}
              <span className="bo-rs__cell-sub">{order.customerCode}</span>
            </dd>
          </div>
          <div className="bo-rs__fact">
            <dt>Vendedor</dt>
            <dd>{order.sellerEmail}</dd>
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
            <dd className="bo-rs__mono">{order.headerCenterCode ?? '—'}</dd>
          </div>
          <div className="bo-rs__fact">
            <dt>Destino de cabecera</dt>
            <dd className="bo-rs__mono">{order.headerDestinationCode ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="bo-rs__card bo-rs__card--sap" aria-labelledby="bo-rs-sap-title">
        <header className="bo-rs__card-head">
          <h3 id="bo-rs-sap-title" className="bo-rs__card-title">
            Motivo del rechazo de SAP
          </h3>
          <span className="bo-rs__cell--muted">
            {order.attempts === 1 ? '1 intento' : `${order.attempts} intentos`} ·
            último {formatDateTime(lastAttempt?.attemptAt ?? order.rejectedAt)}
          </span>
        </header>
        <p className="bo-rs__sap-message">{lastAttempt?.message ?? order.sapError}</p>
        {previousAttempts.length > 0 && (
          <details className="bo-rs__attempts">
            <summary>Intentos anteriores ({previousAttempts.length})</summary>
            <ol className="bo-rs__attempt-list">
              {previousAttempts.map((attempt) => (
                <li key={attempt.attemptAt}>
                  <span className="bo-rs__cell--muted">
                    {formatDateTime(attempt.attemptAt)}
                  </span>{' '}
                  {attempt.message}
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
          <span className="bo-rs__cell--muted">
            Centros permitidos para el cliente · destinos del área{' '}
            {formatSalesArea(order.salesArea)}
          </span>
        </header>
        <ReviewItemsTable
          items={order.items}
          assignments={assignments}
          catalogs={catalogs}
          onAssign={onAssign}
        />
      </section>

      <div className="bo-rs__actions">
        <p className="bo-rs__actions-status" aria-live="polite">
          {changes.length === 0
            ? 'Sin cambios'
            : changes.length === 1
              ? '1 ítem modificado'
              : `${changes.length} ítems modificados`}
          {blocking > 0 && (
            <span className="bo-rs__actions-blocking">
              {' '}
              ·{' '}
              {blocking === 1
                ? '1 ítem necesita corrección'
                : `${blocking} ítems necesitan corrección`}
            </span>
          )}
        </p>
        <div className="bo-rs__actions-buttons">
          <button
            type="button"
            className="bo-rs__button bo-rs__button--ghost"
            disabled={changes.length === 0}
            onClick={onDiscard}
          >
            Descartar cambios
          </button>
          <button
            type="button"
            className="bo-rs__button"
            disabled={blocking > 0}
            onClick={() => setConfirmOpen(true)}
          >
            Reenviar a SAP
          </button>
        </div>
      </div>

      {confirmOpen && (
        <ResendConfirmModal
          orderNumber={order.orderNumber}
          changes={changes}
          catalogs={catalogs}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </>
  );
}
