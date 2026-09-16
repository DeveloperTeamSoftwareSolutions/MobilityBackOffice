import { formatDateTime } from '../soporte/DocumentHeader';
import { formatQuantity } from './revision-sap.logic';
import { SapOrder, SapOrderStatus } from './revision-sap.types';
import { SapErrorMessage } from './SapErrorMessage';

interface Props {
  sapOrders: SapOrder[];
}

const STATUS: Record<SapOrderStatus, { label: string; tone: string; hint?: string }> = {
  accepted: { label: 'Aceptada', tone: 'ok' },
  accepted_no_dispatch: {
    label: 'Aceptada sin entrega',
    tone: 'warn',
    hint: 'SAP creó el pedido pero no la entrega: eso se resuelve en SAP.',
  },
  rejected: { label: 'Rechazada', tone: 'danger' },
  no_response: {
    label: 'Sin respuesta',
    tone: 'warn',
    hint: 'No quedó resultado del envío. Verificá en SAP antes de reenviar: el pedido pudo haberse creado.',
  },
};

/**
 * Las órdenes SAP de la orden, con sus productos y su estado. Solo consulta.
 *
 * Una orden SAP por centro: es la unidad que SAP acepta o rechaza, y por eso el reenvío
 * vive acá y no en la orden entera. Lo que se corrige —centro y destino de cada línea—
 * se edita en la pestaña de productos, que es la orden tal como se va a volver a enviar;
 * esta vista muestra cómo salió cada intento.
 */
export function SapOrdersPanel({ sapOrders }: Props) {
  if (sapOrders.length === 0) {
    return <p className="bo-rs__empty">Esta orden todavía no generó ninguna orden SAP.</p>;
  }

  return (
    <ul className="bo-rs__sap-orders">
      {sapOrders.map((sapOrder) => {
        const status = STATUS[sapOrder.status];
        const rechazada = sapOrder.status === 'rejected';

        return (
          <li
            key={sapOrder.guid}
            className={`bo-rs__sap-order${rechazada ? ' bo-rs__sap-order--rejected' : ''}`}
          >
            <div className="bo-rs__sap-order-head">
              <span className={`bo-rs__pill bo-rs__pill--${status.tone}`}>{status.label}</span>
              <span className="bo-rs__cell--strong">
                {sapOrder.centerCode
                  ? `Centro ${sapOrder.centerCode}${sapOrder.centerName ? ` · ${sapOrder.centerName}` : ''}`
                  : 'Centro sin informar'}
              </span>
              <span className="bo-rs__cell--muted">
                {sapOrder.sapOrderNumber ? `Pedido ${sapOrder.sapOrderNumber}` : 'Sin número de pedido'}
              </span>
              {sapOrder.sapDispatchNumber && (
                <span className="bo-rs__cell--muted">Entrega {sapOrder.sapDispatchNumber}</span>
              )}
              <span className="bo-rs__cell--muted bo-rs__sap-order-date">
                {formatDateTime(sapOrder.attemptAt)}
              </span>
            </div>

            {sapOrder.error && <SapErrorMessage error={sapOrder.error} />}
            {status.hint && <p className="bo-rs__cell--muted bo-rs__sap-order-hint">{status.hint}</p>}

            <div className="bo-rs__table-wrap">
              <table className="bo-rs__table bo-rs__table--compact">
                <thead>
                  <tr>
                    <th className="bo-rs__th--number">#</th>
                    <th>Producto</th>
                    <th className="bo-rs__th--number">Cantidad</th>
                    <th>Centro</th>
                    <th>Destino de entrega</th>
                  </tr>
                </thead>
                <tbody>
                  {sapOrder.items.map((sapItem) => (
                    <tr key={`${sapOrder.guid}-${sapItem.lineNumber}`}>
                      <td className="bo-rs__cell--number bo-rs__cell--muted">{sapItem.lineNumber}</td>
                      <td>
                        <span className="bo-rs__cell--strong">{sapItem.productCode}</span>
                        {sapItem.description && (
                          <span className="bo-rs__cell-sub">{sapItem.description}</span>
                        )}
                      </td>
                      <td className="bo-rs__cell--number">
                        {formatQuantity(sapItem.quantity)} {sapItem.unitOfMeasure ?? ''}
                      </td>
                      <td>
                        <span className="bo-rs__mono">
                          {sapItem.centerCode ?? sapOrder.centerCode ?? '—'}
                        </span>
                      </td>
                      <td>
                        <span className="bo-rs__mono">{sapItem.deliveryDestinationCode ?? '—'}</span>
                        {sapItem.deliveryDestinationName && (
                          <span className="bo-rs__cell-sub">{sapItem.deliveryDestinationName}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {rechazada && (
              <div className="bo-rs__sap-order-actions">
                <span className="bo-rs__cell--muted">
                  Se reenvía solo esta orden SAP, con los productos de este centro. Corregí antes el
                  centro y el destino en la pestaña de productos.
                </span>
                <button
                  type="button"
                  className="bo-rs__button"
                  disabled
                  title="El reenvío a SAP todavía no está conectado"
                >
                  Reenviar esta orden SAP
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
