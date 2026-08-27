import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { decideItem, listItems, recompute, respondItem } from './soporte.api';
import {
  DocumentItems,
  DocumentType,
  ItemDecision,
  ItemResponse,
  SupportItem,
} from './soporte.types';
import { formatDateTime } from './DocumentHeader';
import { InfoTip } from './InfoTip';
import { PaymentTermsPanel } from './PaymentTermsPanel';

/** Cómo se lee cada estado de línea en pantalla. */
const ETIQUETA_AUTORIZACION: Record<string, string> = {
  approved: 'Aprobada',
  rejected: 'Rechazada',
  countered: 'Contraofertada',
  pending: 'Pendiente',
};

const ETIQUETA_VENDEDOR: Record<string, string> = {
  accepted: 'Aceptó',
  rejected: 'Rechazó',
};

function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as { message?: string } | undefined;
    if (body?.message) return body.message;
  }
  return 'No se pudo aplicar la decisión sobre la línea.';
}

/** Formulario abierto sobre una línea: quién decide y qué. */
interface Edicion {
  productCode: string;
  modo: 'gerente' | 'vendedor';
}

interface Props {
  type: DocumentType;
  guid: string;
  /** Avisa al panel padre que el estado del documento cambió. */
  onDocumentStatusChange: (nuevoEstado: string | null) => void;
}

/**
 * Líneas del documento y las decisiones que soporte puede ejecutar sobre ellas.
 *
 * Soporte **no tiene un camino propio**: aprobar, rechazar o contraofertar una línea
 * llama exactamente a lo mismo que llama el gerente desde su app, y responder una
 * contraoferta a lo mismo que llama el vendedor. Por eso cada decisión deja su
 * comentario en el hilo, dispara el aviso correspondiente y recalcula el estado del
 * documento, igual que si la hubiera hecho su dueño.
 *
 * Lo único que cambia es quién la ejecuta y por qué, y eso va en el motivo — que acá
 * es obligatorio siempre, aunque el flujo solo lo exija al rechazar.
 *
 * Cantidad, descuento y producto no se editan: no viajan en ningún pedido. El único
 * número que se escribe es el precio de una contraoferta, que es una propuesta, no
 * una edición de la línea.
 */
export function DocumentItemsPanel({
  type,
  guid,
  onDocumentStatusChange,
}: Props) {
  const [data, setData] = useState<DocumentItems | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [decision, setDecision] = useState<ItemDecision>('approved');
  const [respuesta, setRespuesta] = useState<ItemResponse>('accept');
  const [precio, setPrecio] = useState('');
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await listItems(type, guid));
    } catch (err) {
      setData(null);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [type, guid]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function abrir(item: SupportItem, modo: 'gerente' | 'vendedor') {
    setEdicion({ productCode: item.productCode ?? '', modo });
    setDecision('approved');
    setRespuesta('accept');
    setPrecio('');
    setMotivo('');
    setAviso(null);
    setError(null);
  }

  function cerrar() {
    setEdicion(null);
    setMotivo('');
    setPrecio('');
  }

  /** Mensaje común: el estado puede no moverse, y eso no es un fallo. */
  function avisoDe(
    statusBefore: string | null,
    statusAfter: string | null,
    prefijo: string,
  ): string {
    return statusBefore === statusAfter
      ? `${prefijo} El estado del documento no cambió (sigue en ${statusAfter ?? 'sin estado'}).`
      : `${prefijo} El documento pasó de ${statusBefore} a ${statusAfter}.`;
  }

  async function tras(statusAfter: string | null, texto: string) {
    cerrar();
    await cargar();
    onDocumentStatusChange(statusAfter);
    setAviso(texto);
  }

  async function aplicarDecision(item: SupportItem) {
    const code = item.productCode;
    if (!code || !motivo.trim()) return;
    if (decision === 'countered' && !(Number(precio) > 0)) return;

    setGuardando(true);
    setError(null);
    try {
      const result = await decideItem(
        type,
        guid,
        code,
        decision,
        motivo.trim(),
        decision === 'countered' ? Number(precio) : null,
      );
      await tras(
        result.statusAfter,
        avisoDe(
          result.statusBefore,
          result.statusAfter,
          `Línea ${item.lineNumber} decidida.`,
        ),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  async function aplicarRespuesta(item: SupportItem) {
    const code = item.productCode;
    if (!code || !motivo.trim()) return;

    setGuardando(true);
    setError(null);
    try {
      const result = await respondItem(type, guid, code, respuesta, motivo.trim());
      await tras(
        result.statusAfter,
        avisoDe(
          result.statusBefore,
          result.statusAfter,
          `Respuesta registrada en la línea ${item.lineNumber}.`,
        ),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  async function recalcular() {
    setGuardando(true);
    setError(null);
    try {
      const result = await recompute(type, guid);
      await cargar();
      onDocumentStatusChange(result.statusAfter);
      setAviso(
        result.statusBefore === result.statusAfter
          ? `El estado ya era el correcto (${result.statusAfter ?? 'sin estado'}).`
          : `El documento pasó de ${result.statusBefore} a ${result.statusAfter}.`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  if (loading && !data) {
    return <p className="bo-sp__empty">Cargando líneas…</p>;
  }
  if (error && !data) {
    return <p className="bo-sp__error">{error}</p>;
  }
  if (!data) return null;

  const turno = data.managerTurn;

  /**
   * Estados en los que el flujo todavía admite responder una contraoferta; fuera de
   * ellos devuelve `not_negotiable`. Espejo de `NEGOTIABLE_ORDER_STATUSES` y
   * `NEGOTIABLE_QUOTE_STATUSES` del middleware — la cotización suma `Sent`.
   *
   * Un `statusCode` vacío NO bloquea: es un espejo viejo y el middleware tampoco corta
   * ahí, porque no habría con qué juzgar.
   */
  const NEGOCIABLES =
    type === 'quote'
      ? ['ReadyForApprove', 'Sent', 'Processed']
      : ['ReadyForApprove', 'Processed'];
  const negociable =
    !data.document.statusCode || NEGOCIABLES.includes(data.document.statusCode);

  /**
   * El aviso del turno pendiente solo es cierto mientras el documento SIGA esperando
   * al gerente. Antes se mostraba con solo mirar `closed`, y aparecía sobre
   * documentos que ya estaban en `Processed`: decía que iban a quedarse en
   * `ReadyForApprove` cuando ya habían salido de ahí (ORD-00005419).
   */
  const enTurnoDelGerente = data.document.statusCode === 'ReadyForApprove';
  const esperaAlGerente = turno.relevant && !turno.closed && enTurnoDelGerente;
  const avanzoSinCierre = turno.relevant && !turno.closed && !enTurnoDelGerente;

  /**
   * ¿Qué se puede hacer con esta línea, y si no se puede nada, por qué?
   *
   * Se calcula con las mismas condiciones que aplica el middleware. Ofrecer un botón
   * que después falla ya nos pasó con las acciones de cabecera: el usuario no
   * distingue "no corresponde" de "está roto".
   */
  function disponibilidad(item: SupportItem): {
    decidir: boolean;
    responder: boolean;
    motivo: string | null;
  } {
    if (!item.authorizationRequired) {
      return { decidir: false, responder: false, motivo: 'No requiere autorización.' };
    }
    if (item.sellerResponse) {
      return {
        decidir: false,
        responder: false,
        motivo: 'El vendedor ya respondió y la ronda es una sola.',
      };
    }
    if (item.authorizationStatus === 'countered' && item.proposedPrice == null) {
      // El flujo exige que la contraoferta tenga precio para poder responderla; sin
      // él no hay nada que aceptar. Pasa con líneas viejas anteriores a `ProposedPrice`.
      return {
        decidir: false,
        responder: false,
        motivo: 'La contraoferta no tiene precio: el vendedor no puede responderla.',
      };
    }
    if (item.authorizationStatus === 'countered' && turno.closed) {
      if (!negociable) {
        return {
          decidir: false,
          responder: false,
          motivo: `El documento está en ${data?.document.statusCode ?? 'un estado'} y ya no admite respuestas sobre sus líneas.`,
        };
      }
      return { decidir: false, responder: true, motivo: null };
    }
    if (turno.closed) {
      return {
        decidir: false,
        responder: false,
        motivo:
          'El gerente ya cerró su turno. Para volver a decidir hay que reabrirlo desde las acciones del documento.',
      };
    }
    return { decidir: true, responder: false, motivo: null };
  }

  return (
    <>
      <PaymentTermsPanel
        type={type}
        guid={guid}
        paymentTerms={data.paymentTerms}
        managerTurn={turno}
        documentStatus={data.document.statusCode}
        onAplicado={async (estadoNuevo, texto) => {
          await cargar();
          onDocumentStatusChange(estadoNuevo);
          setAviso(texto);
        }}
      />

      <section className="bo-sp__card">
        <header className="bo-sp__card-head">
          <h3 className="bo-sp__doc-number">
            Líneas del documento
            <InfoTip texto="Las decisiones de acá llaman a lo mismo que llama el gerente o el vendedor desde su app: dejan el comentario en el hilo, avisan a quien corresponde y recalculan el estado. Soporte queda registrado como autor; el motivo dice quién lo pidió." />
          </h3>
          <button
            type="button"
            className="bo-sp__pager-button"
            onClick={() => void recalcular()}
            disabled={guardando}
          >
            Recalcular estado
          </button>
        </header>

        {/*
          El turno del gerente solo importa si el documento PASA por el gerente: al
          menos una línea escalada, o un pedido de otra forma de pago. Si no, nunca
          hubo turno que cerrar y avisar sobre él confunde (ORD-00005414: 0 líneas
          escaladas, estado Processed, y la consola avisaba igual).
          `relevant` lo calcula el middleware con la misma condición que la proyección.
        */}
        {!turno.relevant && (
          <p className="bo-sp__event-actor">
            Este documento no pasa por el gerente: ninguna línea requiere autorización
            y no hay pedido de otra forma de pago.
          </p>
        )}
        {esperaAlGerente && (
          <p className="bo-sp__modal-warning">
            El gerente todavía no cerró su turno. Aunque decidas todas las líneas, el
            documento va a seguir en <strong>ReadyForApprove</strong> hasta que ese
            cierre exista. <strong>El cierre no se puede hacer desde acá</strong>: lo
            confirma el gerente desde su app.
          </p>
        )}
        {/*
          Un documento SOLO-CABECERA (pedido de plazo de pago, sin líneas escaladas)
          avanza sin fila de resolución: decidido el plazo, el gerente ya no tiene
          nada pendiente. Es una regla del middleware, igual para él que para acá.
          Sin esta explicación la consola avisaba "el gerente no cerró su turno"
          sobre un documento que ya estaba en Processed, y parecía una incoherencia.
        */}
        {avanzoSinCierre && (
          <p className="bo-sp__event-actor">
            El documento avanzó a <strong>{data.document.statusCode}</strong> sin fila
            de cierre de turno
            {turno.escalatedLines === 0
              ? ': no tenía ninguna línea escalada, así que decidido el plazo de pago el gerente ya no tenía nada pendiente.'
              : '. Revisá el histórico para ver qué lo movió.'}
          </p>
        )}
        {turno.relevant && turno.closed && (
          <p className="bo-sp__event-actor">
            Turno del gerente cerrado por{' '}
            {turno.resolvedByEmail ?? 'usuario desconocido'} el{' '}
            {formatDateTime(turno.resolvedAt)}.
          </p>
        )}

        {aviso && <p className="bo-sp__modal-warning">{aviso}</p>}
        {error && <p className="bo-sp__error">{error}</p>}

        <div className="bo-sp__table-wrap">
          <table className="bo-sp__table">
            <thead>
              <tr>
                <th>#</th>
                <th>Producto</th>
                <th className="bo-sp__th--number">Cant.</th>
                <th className="bo-sp__th--number">Precio</th>
                <th>Autorización</th>
                <th>Vendedor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const puede = disponibilidad(item);
                const abierta = edicion?.productCode === item.productCode;

                return (
                  <tr key={item.guid}>
                    <td className="bo-sp__cell--strong">{item.lineNumber}</td>
                    <td>
                      {item.productCode ?? '—'}
                      {item.productDescription && (
                        <span className="bo-sp__cell-sub">
                          {item.productDescription}
                        </span>
                      )}
                    </td>
                    <td className="bo-sp__cell--number">{item.quantity ?? '—'}</td>
                    <td className="bo-sp__cell--number">
                      {item.unitPrice ?? '—'}
                      {item.proposedPrice != null && (
                        <span className="bo-sp__cell-sub">
                          Contraoferta: {item.proposedPrice}{' '}
                          {item.proposedPriceCurrency ?? ''}
                        </span>
                      )}
                    </td>
                    <td>
                      {item.authorizationRequired
                        ? (ETIQUETA_AUTORIZACION[item.authorizationStatus ?? 'pending'] ??
                          item.authorizationStatus)
                        : 'No requiere'}
                      {item.decidedByEmail && (
                        <span className="bo-sp__cell-sub">{item.decidedByEmail}</span>
                      )}
                    </td>
                    <td>
                      {item.sellerResponse
                        ? (ETIQUETA_VENDEDOR[item.sellerResponse] ?? item.sellerResponse)
                        : '—'}
                      {item.sellerRespondedByEmail && (
                        <span className="bo-sp__cell-sub">
                          {item.sellerRespondedByEmail}
                        </span>
                      )}
                    </td>
                    <td>
                      {!abierta && (
                        <div className="bo-sp__item-edit">
                          {puede.decidir && (
                            <button
                              type="button"
                              className="bo-sp__pager-button"
                              onClick={() => abrir(item, 'gerente')}
                            >
                              Decidir por el gerente
                            </button>
                          )}
                          {puede.responder && (
                            <button
                              type="button"
                              className="bo-sp__pager-button"
                              onClick={() => abrir(item, 'vendedor')}
                            >
                              Responder por el vendedor
                            </button>
                          )}
                          {puede.motivo && (
                            <span className="bo-sp__cell--muted">
                              {puede.motivo}
                              <InfoTip texto={puede.motivo} alineacion="derecha" />
                            </span>
                          )}
                        </div>
                      )}

                      {abierta && edicion?.modo === 'gerente' && (
                        <div className="bo-sp__item-edit">
                          <select
                            className="bo-sp__select"
                            value={decision}
                            onChange={(e) =>
                              setDecision(e.target.value as ItemDecision)
                            }
                          >
                            <option value="approved">Aprobar</option>
                            <option value="rejected">Rechazar</option>
                            <option value="countered">Contraofertar</option>
                          </select>
                          {decision === 'countered' && (
                            <input
                              className="bo-sp__input"
                              type="number"
                              min="0"
                              step="0.0001"
                              value={precio}
                              onChange={(e) => setPrecio(e.target.value)}
                              placeholder="Precio unitario propuesto"
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
                            onClick={() => void aplicarDecision(item)}
                            disabled={
                              guardando ||
                              !motivo.trim() ||
                              (decision === 'countered' && !(Number(precio) > 0))
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

                      {abierta && edicion?.modo === 'vendedor' && (
                        <div className="bo-sp__item-edit">
                          <select
                            className="bo-sp__select"
                            value={respuesta}
                            onChange={(e) =>
                              setRespuesta(e.target.value as ItemResponse)
                            }
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
                            onClick={() => void aplicarRespuesta(item)}
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {data.items.length === 0 && (
          <p className="bo-sp__empty">El documento no tiene líneas.</p>
        )}
      </section>
    </>
  );
}
