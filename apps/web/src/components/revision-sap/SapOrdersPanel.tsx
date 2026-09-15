import { useEffect, useState } from 'react';
import { formatDateTime } from '../soporte/DocumentHeader';
import { apiErrorMessage, listSapOrders } from './revision-sap.api';
import { formatQuantity } from './revision-sap.logic';
import { SapOrder, SapOrderStatus } from './revision-sap.types';

interface Props {
  orderGuid: string;
  /** Cambia cuando la orden se recarga, para volver a pedir las órdenes SAP. */
  refreshKey: number;
}

const STATUS: Record<SapOrderStatus, { label: string; tone: string; hint?: string }> = {
  accepted: { label: 'Aceptada', tone: 'ok' },
  accepted_no_dispatch: {
    label: 'Aceptada sin entrega',
    tone: 'warn',
    hint: 'SAP creó el pedido pero no la entrega: se resuelve en SAP.',
  },
  rejected: { label: 'Rechazada', tone: 'danger' },
  no_response: {
    label: 'Sin respuesta',
    tone: 'warn',
    hint: 'No quedó resultado del envío. Verificá en SAP antes de reenviar: el pedido pudo haberse creado.',
  },
};

/**
 * En cuántas órdenes SAP salió la orden y el estado de cada una. Hoy hay una por
 * intento de envío; cuando el middleware parta la orden por centro, va a haber una por
 * centro, y una orden con una aceptada y otra rechazada se ve "procesada" en MobilityIA.
 */
export function SapOrdersPanel({ orderGuid, refreshKey }: Props) {
  const [orders, setOrders] = useState<SapOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOrders(null);
    setError(null);
    listSapOrders(orderGuid)
      .then((rows) => {
        if (!cancelled) setOrders(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, 'No se pudieron cargar las órdenes SAP.'));
      });
    return () => {
      cancelled = true;
    };
  }, [orderGuid, refreshKey]);

  if (error) return <p className="bo-rs__error">{error}</p>;
  if (!orders) return <p className="bo-rs__empty">Cargando órdenes SAP…</p>;
  if (orders.length === 0) {
    return <p className="bo-rs__empty">Esta orden todavía no tiene órdenes SAP.</p>;
  }

  return (
    <ul className="bo-rs__sap-orders">
      {orders.map((order) => {
        const status = STATUS[order.status];
        return (
          <li key={order.guid} className="bo-rs__sap-order">
            <div className="bo-rs__sap-order-head">
              <span className={`bo-rs__pill bo-rs__pill--${status.tone}`}>{status.label}</span>
              <span className="bo-rs__cell--strong">
                {order.sapOrderNumber ? `Pedido ${order.sapOrderNumber}` : 'Sin número de pedido'}
              </span>
              {order.sapDispatchNumber && (
                <span className="bo-rs__cell--muted">Entrega {order.sapDispatchNumber}</span>
              )}
              <span className="bo-rs__cell--muted bo-rs__sap-order-date">
                {formatDateTime(order.attemptAt)}
              </span>
            </div>
            {order.error && <p className="bo-rs__sap-message">{order.error}</p>}
            {status.hint && <p className="bo-rs__cell--muted bo-rs__sap-order-hint">{status.hint}</p>}
            {order.items.length > 0 && (
              <table className="bo-rs__table bo-rs__table--compact">
                <thead>
                  <tr>
                    <th className="bo-rs__th--number">#</th>
                    <th>Producto</th>
                    <th className="bo-rs__th--number">Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((it) => (
                    <tr key={`${order.guid}-${it.lineNumber}`}>
                      <td className="bo-rs__cell--number bo-rs__cell--muted">{it.lineNumber}</td>
                      <td>
                        <span className="bo-rs__cell--strong">{it.productCode}</span>
                        {it.description && <span className="bo-rs__cell-sub">{it.description}</span>}
                      </td>
                      <td className="bo-rs__cell--number">
                        {formatQuantity(it.quantity)} {it.unitOfMeasure ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </li>
        );
      })}
    </ul>
  );
}
