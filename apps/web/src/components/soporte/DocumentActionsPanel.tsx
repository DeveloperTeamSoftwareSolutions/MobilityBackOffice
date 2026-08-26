import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { listActions, runAction } from './soporte.api';
import { DocumentActions, DocumentType, SupportAction } from './soporte.types';
import { InfoTip } from './InfoTip';

function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as { message?: string } | undefined;
    if (body?.message) return body.message;
  }
  return 'No se pudo ejecutar la acción.';
}

interface Props {
  type: DocumentType;
  guid: string;
  onDocumentStatusChange: (nuevoEstado: string | null) => void;
}

/**
 * Acciones con intención — el camino recomendado para corregir un documento.
 *
 * El usuario elige QUÉ QUIERE QUE PASE, no a qué estado ir. Cada acción escribe
 * hechos (decisiones de línea, turno del gerente, anulación) y deja que el sistema
 * calcule el estado. Por eso no puede producir un estado inalcanzable, que es lo que
 * sí puede pasar forzando el estado a mano.
 *
 * Las acciones que no aplican se muestran deshabilitadas CON el motivo, en vez de
 * ocultarse: saber por qué no se puede es tan útil como poder.
 */
export function DocumentActionsPanel({
  type,
  guid,
  onDocumentStatusChange,
}: Props) {
  const [data, setData] = useState<DocumentActions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [elegida, setElegida] = useState<SupportAction | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ejecutando, setEjecutando] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      setData(await listActions(type, guid));
    } catch (err) {
      setData(null);
      setError(errorMessage(err));
    }
  }, [type, guid]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function ejecutar() {
    if (!elegida || !motivo.trim()) return;
    setEjecutando(true);
    setError(null);
    try {
      const r = await runAction(type, guid, elegida.action, motivo.trim(), elegida.target);
      setElegida(null);
      setMotivo('');
      await cargar();
      onDocumentStatusChange(r.statusAfter);
      setAviso(
        r.achieved
          ? `Listo. El documento quedó en ${r.statusAfter}.`
          : `La acción se aplicó, pero el documento quedó en ${r.statusAfter} y no en ${r.expected}. Suele ser porque otra instancia todavía lo retiene — por ejemplo el motor de crédito. Revisá las líneas para ver qué falta.`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setEjecutando(false);
    }
  }

  if (error && !data) return <p className="bo-sp__error">{error}</p>;
  if (!data) return null;

  return (
    <section className="bo-sp__card">
      <header className="bo-sp__card-head">
        <h3 className="bo-sp__doc-number">
          ¿Qué querés hacer?
          <InfoTip texto="Cada acción corrige los datos del documento y deja que el sistema recalcule el estado. Por eso el resultado siempre queda firme: el documento no puede terminar en un estado que nadie vea." />
        </h3>
      </header>

      {aviso && <p className="bo-sp__modal-warning">{aviso}</p>}
      {error && <p className="bo-sp__error">{error}</p>}

      <div className="bo-sp__actions">
        {data.actions.map((a) => (
          <div
            key={a.action + (a.target ?? "")}
            className={`bo-sp__action ${a.available ? '' : 'bo-sp__action--off'}`}
          >
            <span className="bo-sp__action-label">{a.label}</span>
            {/*
              El efecto y el motivo de indisponibilidad van al globo, no a la
              pantalla: eran tres bloques de texto por accion compitiendo entre si.
            */}
            <InfoTip
              texto={
                a.available
                  ? a.effect
                  : `No disponible: ${a.reason ?? 'no aplica a este documento.'}`
              }
            />
            <button
              type="button"
              className={`bo-sp__button bo-sp__button--sm ${a.warning ? 'bo-sp__button--danger' : ''}`}
              disabled={!a.available || ejecutando}
              onClick={() => {
                setElegida(a);
                setMotivo('');
                setAviso(null);
              }}
            >
              Aplicar
            </button>
          </div>
        ))}
      </div>

      {elegida && (
        <div className="bo-sp__modal-backdrop" role="dialog" aria-modal="true">
          <div className="bo-sp__modal">
            <h2 className="bo-sp__modal-title">{elegida.label}</h2>
            <p className="bo-sp__modal-doc">
              {data.documentNumber} · estado actual{' '}
              <strong>{data.statusCode ?? 'sin estado'}</strong>
            </p>

            <div className="bo-sp__modal-form">
              <p className="bo-sp__modal-warning">{elegida.effect}</p>

              {elegida.warning && (
                <p className="bo-sp__modal-danger">
                  El documento ya está en el circuito de SAP y este cambio{' '}
                  <strong>no se propaga</strong>: los dos sistemas van a quedar
                  diciendo cosas distintas.
                </p>
              )}

              <label className="bo-sp__field">
                <span className="bo-sp__label">
                  Motivo (obligatorio — queda en la línea de tiempo)
                </span>
                <textarea
                  className="bo-sp__textarea"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={3}
                  placeholder="Ticket #1234: el vendedor reporta que no puede avanzar."
                  disabled={ejecutando}
                />
              </label>

              <div className="bo-sp__modal-actions">
                <button
                  type="button"
                  className="bo-sp__pager-button"
                  onClick={() => setElegida(null)}
                  disabled={ejecutando}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className={`bo-sp__button ${elegida.warning ? 'bo-sp__button--danger' : ''}`}
                  onClick={() => void ejecutar()}
                  disabled={!motivo.trim() || ejecutando}
                >
                  {ejecutando ? 'Aplicando…' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
