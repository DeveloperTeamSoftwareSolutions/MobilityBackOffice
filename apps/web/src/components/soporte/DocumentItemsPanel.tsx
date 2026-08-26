import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { listItems, recompute, setItemStatus } from './soporte.api';
import { DocumentItems, DocumentType, SupportItem } from './soporte.types';
import { formatDateTime } from './DocumentHeader';

/** Estados que soporte puede poner. `countered` no está: viaja con un precio. */
const AUTH_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Pendiente' },
  { value: 'approved', label: 'Aprobada' },
  { value: 'rejected', label: 'Rechazada' },
];

const SELLER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Sin responder' },
  { value: 'accepted', label: 'Aceptada' },
  { value: 'rejected', label: 'Rechazada' },
];

function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as { message?: string } | undefined;
    if (body?.message) return body.message;
  }
  return 'No se pudo aplicar el cambio en la línea.';
}

interface Props {
  type: DocumentType;
  guid: string;
  /** Avisa al panel padre que el estado del documento cambió. */
  onDocumentStatusChange: (nuevoEstado: string | null) => void;
}

/**
 * Líneas del documento con su estado editable.
 *
 * Es la "reparación limpia": corregir los hechos que el sistema usa para calcular el
 * estado del documento, en vez de estampar el estado a mano. Después de cada cambio
 * el middleware recalcula la cabecera, así que el resultado queda respaldado por los
 * datos y no se revierte solo.
 *
 * Producto, cantidad y precio se muestran para dar contexto pero **no se editan**:
 * ni siquiera viajan en el pedido.
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

  // Línea que se está editando y el motivo tipeado para ese cambio.
  const [editando, setEditando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [pendiente, setPendiente] = useState<{
    authorizationStatus?: string | null;
    sellerResponse?: string | null;
  }>({});
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

  function empezarEdicion(item: SupportItem) {
    setEditando(item.guid);
    setMotivo('');
    setPendiente({});
    setAviso(null);
    setError(null);
  }

  function cancelar() {
    setEditando(null);
    setMotivo('');
    setPendiente({});
  }

  async function aplicar(item: SupportItem) {
    if (!motivo.trim() || Object.keys(pendiente).length === 0) return;
    setGuardando(true);
    setError(null);
    try {
      const result = await setItemStatus(
        type,
        guid,
        item.guid,
        pendiente,
        motivo.trim(),
      );
      cancelar();
      await cargar();
      onDocumentStatusChange(result.statusAfter);
      setAviso(
        result.statusBefore === result.statusAfter
          ? `Línea ${result.lineNumber} actualizada. El estado del documento no cambió (sigue en ${result.statusAfter ?? 'sin estado'}).`
          : `Línea ${result.lineNumber} actualizada. El documento pasó de ${result.statusBefore} a ${result.statusAfter}.`,
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

  return (
    <section className="bo-sp__card">
      <header className="bo-sp__card-head">
        <h3 className="bo-sp__doc-number">Líneas del documento</h3>
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
      {!data.managerTurn.relevant && (
        <p className="bo-sp__event-actor">
          Este documento no pasa por el gerente: ninguna línea requiere autorización
          y no hay pedido de otra forma de pago.
        </p>
      )}
      {data.managerTurn.relevant && !data.managerTurn.closed && (
        <p className="bo-sp__modal-warning">
          El gerente todavía no cerró su turno. Aunque decidas todas las líneas, el
          documento va a seguir en <strong>ReadyForApprove</strong> hasta que ese
          cierre exista.
        </p>
      )}
      {data.managerTurn.relevant && data.managerTurn.closed && (
        <p className="bo-sp__event-actor">
          Turno del gerente cerrado por{' '}
          {data.managerTurn.resolvedByEmail ?? 'usuario desconocido'} el{' '}
          {formatDateTime(data.managerTurn.resolvedAt)}.
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
              <th>Cant.</th>
              <th>Precio</th>
              <th>Requiere aut.</th>
              <th>Autorización</th>
              <th>Vendedor</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
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
                <td className="bo-sp__cell--number">{item.unitPrice ?? '—'}</td>
                <td className="bo-sp__cell--muted">
                  {item.authorizationRequired ? 'Sí' : 'No'}
                </td>

                {editando === item.guid ? (
                  <>
                    <td>
                      <select
                        className="bo-sp__select"
                        value={
                          pendiente.authorizationStatus !== undefined
                            ? (pendiente.authorizationStatus ?? '')
                            : (item.authorizationStatus ?? '')
                        }
                        onChange={(e) =>
                          setPendiente((p) => ({
                            ...p,
                            authorizationStatus: e.target.value || null,
                          }))
                        }
                      >
                        {AUTH_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="bo-sp__select"
                        value={
                          pendiente.sellerResponse !== undefined
                            ? (pendiente.sellerResponse ?? '')
                            : (item.sellerResponse ?? '')
                        }
                        onChange={(e) =>
                          setPendiente((p) => ({
                            ...p,
                            sellerResponse: e.target.value || null,
                          }))
                        }
                      >
                        {SELLER_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div className="bo-sp__item-edit">
                        <input
                          className="bo-sp__input"
                          value={motivo}
                          onChange={(e) => setMotivo(e.target.value)}
                          placeholder="Motivo (obligatorio)"
                        />
                        <button
                          type="button"
                          className="bo-sp__button"
                          onClick={() => void aplicar(item)}
                          disabled={
                            guardando ||
                            !motivo.trim() ||
                            Object.keys(pendiente).length === 0
                          }
                        >
                          {guardando ? 'Guardando…' : 'Guardar'}
                        </button>
                        <button
                          type="button"
                          className="bo-sp__pager-button"
                          onClick={cancelar}
                          disabled={guardando}
                        >
                          Cancelar
                        </button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td>
                      {item.authorizationStatus ?? 'pendiente'}
                      {item.decidedByEmail && (
                        <span className="bo-sp__cell-sub">
                          {item.decidedByEmail}
                        </span>
                      )}
                    </td>
                    <td>
                      {item.sellerResponse ?? '—'}
                      {item.sellerRespondedByEmail && (
                        <span className="bo-sp__cell-sub">
                          {item.sellerRespondedByEmail}
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="bo-sp__pager-button"
                        onClick={() => empezarEdicion(item)}
                      >
                        Cambiar estado
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.items.length === 0 && (
        <p className="bo-sp__empty">El documento no tiene líneas.</p>
      )}
    </section>
  );
}
