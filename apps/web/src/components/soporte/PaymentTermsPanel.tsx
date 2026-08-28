import { useState } from 'react';
import axios from 'axios';
import { decidePaymentTerms, respondPaymentTerms } from './soporte.api';
import {
  DocumentType,
  ManagerTurn,
  PaymentDecision,
  PaymentTerms,
} from './soporte.types';
import { formatDateTime } from './DocumentHeader';
import { InfoTip } from './InfoTip';

function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as { message?: string } | undefined;
    if (body?.message) return body.message;
  }
  return 'No se pudo aplicar la decisión sobre el plazo de pago.';
}

/** Cómo se lee cada estado del plazo de pago en pantalla, y con qué color. */
const ESTADO: Record<string, { label: string; modificador: string }> = {
  approved: { label: 'Aprobado', modificador: '' },
  rejected: { label: 'Rechazado', modificador: 'bo-sp__status--cancelled' },
  observed: {
    label: 'Contraofertado por el gerente',
    modificador: 'bo-sp__status--pending',
  },
};

/** Sin decidir es un estado más, y el que más importa: bloquea el cierre del turno. */
const SIN_DECIDIR = {
  label: 'Sin decidir',
  modificador: 'bo-sp__status--pending',
};

interface Props {
  type: DocumentType;
  guid: string;
  paymentTerms: PaymentTerms;
  managerTurn: ManagerTurn;
  /** Estado del documento: el flujo corta por el al responder (`not_negotiable`). */
  documentStatus: string | null;
  /** Recarga los datos y avisa el estado nuevo del documento. */
  onAplicado: (estadoNuevo: string | null, aviso: string) => Promise<void> | void;
}

/**
 * Plazo de pago pedido en la cabecera.
 *
 * Es un requisito de CABECERA, no de una línea: manda el documento al gerente aunque
 * ninguna línea lo pida, y mientras siga sin decidir bloquea el cierre del turno. Por
 * eso el panel aparece aunque todas las líneas estén resueltas.
 *
 * Las dos decisiones que ofrece son las mismas del flujo normal, ejecutadas por
 * soporte a pedido de quien no puede hacerlas desde su app.
 */
export function PaymentTermsPanel({
  type,
  guid,
  paymentTerms,
  managerTurn,
  documentStatus,
  onAplicado,
}: Props) {
  const [modo, setModo] = useState<'gerente' | 'vendedor' | null>(null);
  const [decision, setDecision] = useState<PaymentDecision>('approved');
  const [plazo, setPlazo] = useState('');
  const [respuesta, setRespuesta] = useState<'accept' | 'reject'>('accept');
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sin pedido no hay nada que decidir y el panel no se dibuja.
  if (!paymentTerms.requested) return null;

  // El gerente decide mientras su turno siga abierto. Cerrado el turno, el
  // middleware responde `already_resolved`: ofrecerlo sería prometer algo que falla.
  const puedeDecidir = !managerTurn.closed;
  // El vendedor solo responde una contraoferta VIGENTE, recién cuando el gerente cerró
  // su turno (antes ni siquiera la ve) y mientras el documento siga siendo negociable.
  // Espejo de las tres guardas del middleware: `not_observed`, `turn_not_closed` y
  // `not_negotiable`. Un `statusCode` vacío no bloquea, igual que allá.
  const NEGOCIABLES =
    type === 'quote'
      ? ['ReadyForApprove', 'Sent', 'Processed']
      : ['ReadyForApprove', 'Processed'];
  const negociable = !documentStatus || NEGOCIABLES.includes(documentStatus);
  const puedeResponder =
    paymentTerms.status === 'observed' && managerTurn.closed && negociable;

  const estado = paymentTerms.status
    ? (ESTADO[paymentTerms.status] ?? {
        label: paymentTerms.status,
        modificador: '',
      })
    : SIN_DECIDIR;

  function cerrar() {
    setModo(null);
    setMotivo('');
    setPlazo('');
    setError(null);
  }

  async function aplicarDecision() {
    if (!motivo.trim()) return;
    if (decision === 'observed' && !plazo.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      const result = await decidePaymentTerms(
        type,
        guid,
        decision,
        motivo.trim(),
        decision === 'observed' ? plazo.trim() : null,
      );
      cerrar();
      await onAplicado(
        result.statusAfter,
        result.statusBefore === result.statusAfter
          ? `Plazo de pago actualizado. El documento sigue en ${result.statusAfter ?? 'sin estado'}.`
          : `Plazo de pago actualizado. El documento pasó de ${result.statusBefore} a ${result.statusAfter}.`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  async function aplicarRespuesta() {
    if (!motivo.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      const result = await respondPaymentTerms(type, guid, respuesta, motivo.trim());
      cerrar();
      await onAplicado(
        result.statusAfter,
        result.statusBefore === result.statusAfter
          ? `Respuesta registrada. El documento sigue en ${result.statusAfter ?? 'sin estado'}.`
          : `Respuesta registrada. El documento pasó de ${result.statusBefore} a ${result.statusAfter}.`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="bo-sp__card">
      <header className="bo-sp__card-head">
        <h3 className="bo-sp__doc-number">
          Plazo de pago
          <InfoTip texto="El vendedor pidió una forma de pago distinta de la estándar. Es un pedido de cabecera: manda el documento al gerente aunque ninguna línea lo requiera, y bloquea el cierre del turno hasta que se decida." />
        </h3>
        {/*
          El estado va como chip en la cabecera, igual que en la ficha del documento:
          es el dato que se busca primero y así se lee sin bajar la vista.
        */}
        <span className={`bo-sp__status ${estado.modificador}`}>{estado.label}</span>
      </header>

      {/*
        `bo-sp__fact` en cada bloque no es decorativo: sin esa clase el `dd` sale con
        la sangría de 40px que le pone el navegador y la lista queda desalineada.
      */}
      <dl className="bo-sp__facts">
        <div className="bo-sp__fact">
          <dt>Lo que pidió el vendedor</dt>
          <dd>{paymentTerms.requested}</dd>
        </div>
        {paymentTerms.approved && (
          <div className="bo-sp__fact">
            <dt>
              {paymentTerms.status === 'observed'
                ? 'Lo que contrapropuso el gerente'
                : 'Lo concedido'}
            </dt>
            <dd>{paymentTerms.approved}</dd>
          </div>
        )}
        {paymentTerms.decidedByEmail && (
          <div className="bo-sp__fact">
            <dt>Decidido por</dt>
            <dd>
              {paymentTerms.decidedByEmail}
              <span className="bo-sp__cell-sub">
                {formatDateTime(paymentTerms.decidedAt)}
              </span>
            </dd>
          </div>
        )}
      </dl>

      {error && <p className="bo-sp__error">{error}</p>}

      {/*
        El área de acción va separada de los datos por una línea. Antes los botones
        colgaban del último dato y no se distinguía qué era información del documento
        y qué era algo que uno podía apretar.
      */}
      {modo === null && (
        <div className="bo-sp__pay-form">
          {puedeDecidir && (
            <button
              type="button"
              className="bo-sp__pager-button"
              onClick={() => setModo('gerente')}
            >
              Decidir por el gerente
            </button>
          )}
          {puedeResponder && (
            <button
              type="button"
              className="bo-sp__pager-button"
              onClick={() => setModo('vendedor')}
            >
              Responder por el vendedor
            </button>
          )}
          {!puedeDecidir && !puedeResponder && (
            <p className="bo-sp__event-actor">
              {managerTurn.closed
                ? 'El gerente ya cerró su turno y no hay contraoferta pendiente de respuesta. Para volver a decidir hay que reabrir el turno desde las acciones del documento.'
                : 'No hay nada pendiente sobre el plazo de pago.'}
            </p>
          )}
        </div>
      )}

      {modo === 'gerente' && (
        <div className="bo-sp__pay-form">
          <span className="bo-sp__pay-form-title">Decisión del gerente</span>
          <select
            className="bo-sp__select"
            value={decision}
            onChange={(e) => setDecision(e.target.value as PaymentDecision)}
          >
            <option value="approved">Aprobar el plazo pedido</option>
            <option value="rejected">Rechazar</option>
            <option value="observed">Contraofertar otro plazo</option>
          </select>
          {decision === 'observed' && (
            <input
              className="bo-sp__input"
              value={plazo}
              onChange={(e) => setPlazo(e.target.value)}
              placeholder="Plazo que se contrapropone"
            />
          )}
          <input
            className="bo-sp__input"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo: quién lo pidió y por qué"
          />
          <button
            type="button"
            className="bo-sp__button"
            onClick={() => void aplicarDecision()}
            disabled={
              guardando ||
              !motivo.trim() ||
              (decision === 'observed' && !plazo.trim())
            }
          >
            {guardando ? 'Guardando…' : 'Aplicar'}
          </button>
          <button
            type="button"
            className="bo-sp__pager-button"
            onClick={cerrar}
            disabled={guardando}
          >
            Cancelar
          </button>
        </div>
      )}

      {modo === 'vendedor' && (
        <div className="bo-sp__pay-form">
          <span className="bo-sp__pay-form-title">Respuesta del vendedor</span>
          <select
            className="bo-sp__select"
            value={respuesta}
            onChange={(e) => setRespuesta(e.target.value as 'accept' | 'reject')}
          >
            <option value="accept">Aceptar la contraoferta</option>
            <option value="reject">Rechazarla</option>
          </select>
          <input
            className="bo-sp__input"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo: quién lo pidió y por qué"
          />
          <button
            type="button"
            className="bo-sp__button"
            onClick={() => void aplicarRespuesta()}
            disabled={guardando || !motivo.trim()}
          >
            {guardando ? 'Guardando…' : 'Aplicar'}
          </button>
          <button
            type="button"
            className="bo-sp__pager-button"
            onClick={cerrar}
            disabled={guardando}
          >
            Cancelar
          </button>
        </div>
      )}
    </section>
  );
}
