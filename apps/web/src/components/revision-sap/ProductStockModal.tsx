import { useEffect, useRef, useState } from 'react';
import { apiErrorMessage, getProductStock } from './revision-sap.api';
import { formatQuantity } from './revision-sap.logic';
import { ProductStock } from './revision-sap.types';

interface Props {
  orderGuid: string;
  productCode: string;
  productDescription: string | null;
  onClose: () => void;
}

/**
 * Stock de un producto por centro y almacén, como lo ve el vendedor en MobilityIA.
 *
 * Muestra TODOS los almacenes y marca los del cliente, en vez de esconder el resto:
 * saber que hay stock en un almacén al que el cliente no accede también sirve para
 * decidir. El total del cliente va aparte, arriba.
 */
export function ProductStockModal({ orderGuid, productCode, productDescription, onClose }: Props) {
  const [stock, setStock] = useState<ProductStock | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setStock(null);
    setError(null);
    getProductStock(orderGuid, productCode)
      .then((data) => {
        if (!cancelled) setStock(data);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, 'No se pudo consultar el stock.'));
      });
    return () => {
      cancelled = true;
    };
  }, [orderGuid, productCode]);

  const unit = stock?.unitOfMeasure ?? '';

  return (
    <div
      className="bo-rs__modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bo-rs-stock-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bo-rs__modal bo-rs__modal--wide">
        <h2 id="bo-rs-stock-title" className="bo-rs__modal-title">
          Stock de {productCode}
        </h2>
        {productDescription && <p className="bo-rs__modal-text">{productDescription}</p>}

        {error && <p className="bo-rs__error">{error}</p>}
        {!error && !stock && <p className="bo-rs__empty">Consultando stock…</p>}

        {stock && (
          <>
            <dl className="bo-rs__stock-kpis">
              <div>
                <dt>Disponible total</dt>
                <dd>
                  {formatQuantity(stock.totals.available)} {unit}
                </dd>
              </div>
              <div>
                <dt>En almacenes del cliente</dt>
                <dd>
                  {formatQuantity(stock.totals.availableForCustomer)} {unit}
                </dd>
              </div>
              <div>
                <dt>Centros con stock</dt>
                <dd>{stock.totals.centers}</dd>
              </div>
            </dl>

            {stock.errors.length > 0 && (
              <p className="bo-rs__warning">
                No se pudo saber qué almacenes tiene habilitados el cliente:{' '}
                {stock.errors.map((e) => e.message).join(' · ')}
              </p>
            )}

            {stock.rows.length === 0 ? (
              <p className="bo-rs__empty">Este producto no tiene stock en ningún centro.</p>
            ) : (
              <div className="bo-rs__table-wrap">
                <table className="bo-rs__table bo-rs__table--compact">
                  <thead>
                    <tr>
                      <th>Centro</th>
                      <th>Almacén</th>
                      <th className="bo-rs__th--number">Disponible</th>
                      <th className="bo-rs__th--number">En inspección</th>
                      <th className="bo-rs__th--number">En tránsito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stock.rows.map((row) => (
                      <tr
                        key={`${row.centerCode}-${row.warehouseCode}`}
                        className={row.allowedForCustomer ? 'bo-rs__stock-row--customer' : undefined}
                      >
                        <td>
                          <span className="bo-rs__mono">{row.centerCode ?? '—'}</span>
                          {row.allowedForCustomer && (
                            <span className="bo-rs__chip">Del cliente</span>
                          )}
                          {row.centerName && <span className="bo-rs__cell-sub">{row.centerName}</span>}
                        </td>
                        <td>
                          <span className="bo-rs__mono">{row.warehouseCode ?? '—'}</span>
                          {row.warehouseName && (
                            <span className="bo-rs__cell-sub">{row.warehouseName}</span>
                          )}
                        </td>
                        <td className="bo-rs__cell--number bo-rs__cell--strong">
                          {formatQuantity(row.available)}
                        </td>
                        <td className="bo-rs__cell--number bo-rs__cell--muted">
                          {formatQuantity(row.inInspection)}
                        </td>
                        <td className="bo-rs__cell--number bo-rs__cell--muted">
                          {formatQuantity(row.inTransit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <div className="bo-rs__modal-actions">
          <button
            ref={closeRef}
            type="button"
            className="bo-rs__button bo-rs__button--ghost"
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
