import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Lo que la orden tiene hoy. Se confirma pasarlo al valor contrario. */
  current: boolean;
  saving: boolean;
  error: string | null;
  onConfirm: (reasonNotes: string | null) => void;
  onCancel: () => void;
}

/**
 * Confirmación de "agrupa factura".
 *
 * No alcanza con un selector: este campo no corrige una línea, cambia cómo se comporta
 * el envío entero. Lo que se explica acá es exactamente lo que hace el Middleware
 * (`orderBusiness2Sap`) y lo que ve el vendedor en MobilityIA (`sapDispatchFlow`), no
 * una interpretación: con factura agrupada, una sola línea sin stock impide que la
 * orden salga, y no se crea ninguna orden SAP.
 */
export function GroupInvoiceModal({ current, saving, error, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const next = !current;

  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, saving]);

  return (
    <div
      className="bo-rs__modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bo-rs-gi-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onCancel();
      }}
    >
      <div className="bo-rs__modal">
        <h2 id="bo-rs-gi-title" className="bo-rs__modal-title">
          {next ? 'Poner agrupa factura en Sí' : 'Poner agrupa factura en No'}
        </h2>

        <p className="bo-rs__modal-text">
          Agrupa factura no cambia una línea: cambia cómo se envía la orden entera.
        </p>

        <ul className="bo-rs__gi-effects">
          {next ? (
            <>
              <li className="bo-rs__gi-effect bo-rs__gi-effect--warn">
                <strong>La orden deja de poder salir parcial.</strong> Si al enviarla
                alguna línea no tiene stock, no se manda nada a SAP: rebota completa y no
                se crea ninguna orden SAP.
              </li>
              <li className="bo-rs__gi-effect">
                El vendedor tampoco va a poder elegir seguir sin los faltantes: MobilityIA
                le bloquea el envío en lugar de preguntarle.
              </li>
              <li className="bo-rs__gi-effect">
                Si más adelante se cae una línea, la orden queda <strong>rechazada</strong>{' '}
                y hay que rehacerla con lo que sí haya.
              </li>
            </>
          ) : (
            <>
              <li className="bo-rs__gi-effect bo-rs__gi-effect--warn">
                <strong>La orden va a poder salir parcial.</strong> Las líneas sin stock se
                dejan afuera y el resto se envía a SAP igual.
              </li>
              <li className="bo-rs__gi-effect">
                La factura deja de coincidir con la orden de compra del cliente. Confirmá
                que el cliente acepta recibir y facturar en partes.
              </li>
            </>
          )}
        </ul>

        <label className="bo-rs__field">
          <span className="bo-rs__label">Motivo (opcional)</span>
          <input
            type="text"
            className="bo-rs__input"
            maxLength={500}
            value={reason}
            disabled={saving}
            placeholder={next ? 'Por qué debe salir completa' : 'Por qué puede salir parcial'}
            onChange={(e) => setReason(e.target.value)}
          />
          <span className="bo-rs__cell-sub">
            Queda en la auditoría y en el hilo de la orden, donde lo ve el vendedor.
          </span>
        </label>

        {error && <p className="bo-rs__error">{error}</p>}

        <div className="bo-rs__modal-actions">
          <button
            ref={cancelRef}
            type="button"
            className="bo-rs__button bo-rs__button--ghost"
            disabled={saving}
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="bo-rs__button"
            disabled={saving}
            onClick={() => onConfirm(reason.trim() || null)}
          >
            {saving ? 'Guardando…' : next ? 'Sí, agrupar factura' : 'Sí, permitir parcial'}
          </button>
        </div>
      </div>
    </div>
  );
}
