import { FormEvent, useEffect, useState } from 'react';
import axios from 'axios';
import { getVocabulary, overrideStatus } from './soporte.api';
import { DocumentType, StatusOption, SupportDocument } from './soporte.types';

interface Props {
  document: SupportDocument;
  type: DocumentType;
  onClose: () => void;
  /** Se dispara cuando el cambio se aplicó, para refrescar la vista. */
  onApplied: (nuevoEstado: string) => void;
}

function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as { message?: string } | undefined;
    if (body?.message) return body.message;
    if (err.response?.status === 403) {
      return 'Tu rol no puede forzar estados.';
    }
    if (err.response?.status === 404) {
      return 'El documento ya no existe.';
    }
  }
  return 'No se pudo aplicar el cambio de estado.';
}

/**
 * Modal de override de estado.
 *
 * Dos pasos deliberados: el formulario y, si el estado de origen o destino es
 * terminal, una confirmación extra. Un terminal (facturada, anulada, rechazada) ya
 * se comunicó fuera del sistema y no se propaga a SAP, así que sacar o meter un
 * documento ahí merece una pausa, no un clic.
 */
export function StatusOverrideModal({
  document,
  type,
  onClose,
  onApplied,
}: Props) {
  const [options, setOptions] = useState<StatusOption[]>([]);
  const [toCode, setToCode] = useState('');
  const [reasonNotes, setReasonNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVocabulary(type)
      .then((rows) => {
        if (!cancelled) setOptions(rows);
      })
      .catch(() => {
        if (!cancelled) setError('No se pudo cargar la lista de estados.');
      });
    return () => {
      cancelled = true;
    };
  }, [type]);

  const destino = options.find((o) => o.code === toCode);
  const origen = options.find((o) => o.code === document.statusCode);
  const tocaTerminal = Boolean(destino?.terminal || origen?.terminal);
  const listo = Boolean(toCode) && reasonNotes.trim().length > 0;

  async function aplicar() {
    setSaving(true);
    setError(null);
    try {
      const result = await overrideStatus(
        type,
        document.guid,
        toCode,
        reasonNotes.trim(),
        'SUPPORT_OVERRIDE',
      );
      onApplied(result.toCode);
    } catch (err) {
      setError(errorMessage(err));
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!listo) return;
    if (tocaTerminal && !confirming) {
      setConfirming(true);
      return;
    }
    void aplicar();
  }

  return (
    <div className="bo-sp__modal-backdrop" role="dialog" aria-modal="true">
      <div className="bo-sp__modal">
        <h2 className="bo-sp__modal-title">Forzar estado</h2>
        <p className="bo-sp__modal-doc">
          {document.documentNumber} · estado actual{' '}
          <strong>{document.statusCode ?? 'sin estado'}</strong>
        </p>

        <form onSubmit={onSubmit} className="bo-sp__modal-form">
          <label className="bo-sp__field">
            <span className="bo-sp__label">Nuevo estado</span>
            <select
              className="bo-sp__select"
              value={toCode}
              onChange={(e) => {
                setToCode(e.target.value);
                setConfirming(false);
              }}
              disabled={saving}
            >
              <option value="">Elegí un estado…</option>
              {options
                .filter((o) => o.code !== document.statusCode)
                .map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.code}
                    {o.terminal ? ' (terminal)' : ''}
                  </option>
                ))}
            </select>
          </label>

          <label className="bo-sp__field">
            <span className="bo-sp__label">
              Motivo (obligatorio — queda en la línea de tiempo)
            </span>
            <textarea
              className="bo-sp__textarea"
              value={reasonNotes}
              onChange={(e) => {
                setReasonNotes(e.target.value);
                setConfirming(false);
              }}
              rows={3}
              placeholder="Ticket #1234: la orden quedó trabada tras el rechazo del gerente."
              disabled={saving}
            />
          </label>

          {/*
            El texto anterior decía solo que el estado "se calcula a partir de los
            ítems". Se reportó que confundía: se leía como si forzar el estado
            ajustara esos datos. Ahora dice explícitamente qué NO hace y cuál es la
            alternativa, que es la información que faltaba.
          */}
          <p className="bo-sp__modal-warning">
            <strong>Forzar el estado no cambia los datos del documento.</strong>{' '}
            Escribe el estado y nada más: los ítems, el pago y el crédito quedan
            exactamente como están. Y como el sistema recalcula el estado a partir de
            esos datos, si no respaldan lo que forzás, la próxima acción sobre el
            documento lo va a revertir.
          </p>
          <p className="bo-sp__modal-warning">
            Para un arreglo que quede firme, corregí el estado de las líneas en la
            sección <strong>Líneas del documento</strong>. Eso sí cambia los datos, y
            el estado se recalcula solo.
          </p>

          {tocaTerminal && confirming && (
            <p className="bo-sp__modal-danger">
              Estás por {destino?.terminal ? 'llevar a' : 'sacar de'} un estado
              terminal. Ese cambio <strong>no se propaga a SAP</strong>: los dos
              sistemas van a quedar diciendo cosas distintas. Confirmá solo si sabés
              lo que estás haciendo.
            </p>
          )}

          {error && <p className="bo-sp__error">{error}</p>}

          <div className="bo-sp__modal-actions">
            <button
              type="button"
              className="bo-sp__pager-button"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={`bo-sp__button ${
                tocaTerminal && confirming ? 'bo-sp__button--danger' : ''
              }`}
              disabled={!listo || saving}
            >
              {saving
                ? 'Aplicando…'
                : tocaTerminal && confirming
                  ? 'Sí, forzar igual'
                  : 'Forzar estado'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
