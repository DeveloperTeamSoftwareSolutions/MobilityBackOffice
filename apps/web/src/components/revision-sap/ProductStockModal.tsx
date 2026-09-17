import { useEffect, useRef, useState } from 'react';
import { apiErrorMessage, getProductStock } from './revision-sap.api';
import { cubreLaCantidad, formatQuantity, stockByCenter } from './revision-sap.logic';
import { CenterOption, ProductStock } from './revision-sap.types';

interface Props {
  orderGuid: string;
  productCode: string;
  productDescription: string | null;
  /** Lo que pide la línea, para decir si el centro alcanza. */
  quantity: number | null;
  /** Centro con el que sale hoy la línea, para marcarlo. */
  currentCenter: string | null;
  /** Centros permitidos del cliente: son los únicos elegibles. */
  centers: CenterOption[];
  /** Con esto el modal deja de ser sólo de consulta. Sin esto, es sólo lectura. */
  onSelectCenter?: (centerCode: string) => void;
  onClose: () => void;
}

/**
 * Stock de un producto por centro, para VER y para ELEGIR.
 *
 * Elegir el centro acá en vez de en el selector a ciegas es el punto: se decide mirando
 * cuánto hay. Se agrupa por centro porque es lo que se elige (el almacén no viaja a SAP),
 * con el detalle de almacenes debajo para no perder de dónde sale el número.
 *
 * Un centro sin stock se puede elegir igual, con aviso: SAP revalida con el stock real
 * al enviar, y a veces hay que mandarlo igual. Lo que NO se puede elegir es un centro al
 * que el cliente no accede, aunque tenga stock de sobra.
 */
export function ProductStockModal({
  orderGuid,
  productCode,
  productDescription,
  quantity,
  currentCenter,
  centers,
  onSelectCenter,
  onClose,
}: Props) {
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
  const opciones = stock ? stockByCenter(stock.rows, centers) : [];
  const puedeElegir = typeof onSelectCenter === 'function';

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
        {puedeElegir && (
          <p className="bo-rs__modal-text">
            {quantity != null
              ? `La línea pide ${formatQuantity(quantity)} ${unit}. Elegí desde qué centro sale.`
              : 'Elegí desde qué centro sale la línea.'}
          </p>
        )}

        {error && <p className="bo-rs__error">{error}</p>}
        {!error && !stock && <p className="bo-rs__empty">Consultando stock…</p>}

        {stock && (
          <>
            {stock.errors.length > 0 && (
              <p className="bo-rs__warning">
                No se pudo saber qué almacenes tiene habilitados el cliente:{' '}
                {stock.errors.map((e) => e.message).join(' · ')}
              </p>
            )}

            {opciones.length === 0 ? (
              <p className="bo-rs__empty">Este producto no tiene stock en ningún centro.</p>
            ) : (
              /* Una TABLA, no tarjetas: con 14 centros las tarjetas apiladas hacían el
                 modal larguísimo y dejaban todo angosto. Una fila por centro entra de un
                 vistazo, y el detalle de almacenes se resume en su celda. */
              <div className="bo-rs__table-wrap">
                <table className="bo-rs__table bo-rs__table--compact">
                  <thead>
                    <tr>
                      <th>Centro</th>
                      <th className="bo-rs__th--number">Disponible</th>
                      <th>Almacenes</th>
                      {puedeElegir && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {opciones.map((c) => {
                      const alcanza = cubreLaCantidad(c.available, quantity);
                      const actual = c.centerCode === currentCenter;
                      const detalle = stock.rows.filter((r) => r.centerCode?.trim() === c.centerCode);

                      return (
                        <tr
                          key={c.centerCode}
                          className={`${actual ? 'bo-rs__stock-row--current' : ''}${
                            c.elegible ? '' : ' bo-rs__stock-row--blocked'
                          }`}
                        >
                          <td>
                            <span className="bo-rs__cell--strong">
                              <span className="bo-rs__mono">{c.centerCode}</span>
                              {c.centerName ? ` · ${c.centerName}` : ''}
                            </span>
                            {actual && <span className="bo-rs__chip">Actual</span>}
                            {!c.elegible && (
                              <span className="bo-rs__cell-sub">
                                El cliente no recibe desde este centro
                              </span>
                            )}
                          </td>
                          <td className="bo-rs__cell--number">
                            <span
                              className={
                                alcanza === false ? 'bo-rs__cell--warn' : 'bo-rs__cell--strong'
                              }
                            >
                              {formatQuantity(c.available)} {unit}
                            </span>
                            {alcanza === false && (
                              <span className="bo-rs__cell-sub">
                                Pide {formatQuantity(quantity)}
                              </span>
                            )}
                          </td>
                          <td className="bo-rs__cell--muted bo-rs__stock-warehouses">
                            {detalle.length === 0
                              ? '—'
                              : detalle.map((r) => (
                                  <span key={`${r.centerCode}-${r.warehouseCode}`} className="bo-rs__stock-wh">
                                    <span className="bo-rs__mono">{r.warehouseCode ?? '—'}</span>{' '}
                                    {r.warehouseName ?? ''} · {formatQuantity(r.available)}
                                    {r.allowedForCustomer && (
                                      <span className="bo-rs__chip">Del cliente</span>
                                    )}
                                  </span>
                                ))}
                          </td>
                          {puedeElegir && (
                            <td>
                              {c.elegible && (
                                <button
                                  type="button"
                                  className="bo-rs__button bo-rs__button--ghost"
                                  disabled={actual}
                                  onClick={() => onSelectCenter?.(c.centerCode)}
                                >
                                  {actual ? 'Es el actual' : 'Elegir'}
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
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
