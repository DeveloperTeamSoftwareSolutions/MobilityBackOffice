import { FormEvent, useState } from 'react';
import axios from 'axios';
import { getTimeline } from './soporte.api';
import { DocumentTimeline as Timeline, DocumentType } from './soporte.types';
import { DocumentHeader } from './DocumentHeader';
import { DocumentTimeline } from './DocumentTimeline';
import './soporte.css';

/** Traduce el fallo HTTP al mensaje que ve soporte. */
function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (err.response?.status === 404) {
      return 'No existe un documento con ese número. Revisá el tipo (orden o cotización) y el número exacto.';
    }
    if (err.response?.status === 403) {
      return 'Tu rol no tiene acceso a la consola de soporte.';
    }
    if (err.response?.status === 503) {
      return 'El middleware no está disponible. Reintentá en unos minutos.';
    }
  }
  return 'No se pudo cargar la bitácora del documento.';
}

/**
 * Consola de soporte (fase 1: solo lectura).
 *
 * Se busca por NÚMERO EXACTO de documento, no por texto libre: el middleware no
 * expone ningún listado que no esté scopeado por vendedor o cliente, y soporte no es
 * el vendedor de nada. El número es además el dato con el que llega el ticket.
 * Ver docs/SPEC_CONSOLA_SOPORTE.md §6.
 */
export function SupportPanel() {
  const [type, setType] = useState<DocumentType>('order');
  const [documentNumber, setDocumentNumber] = useState('');
  const [includeViews, setIncludeViews] = useState(false);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(nextIncludeViews = includeViews) {
    const numero = documentNumber.trim();
    if (!numero) return;

    setLoading(true);
    setError(null);
    try {
      setTimeline(await getTimeline(type, numero, nextIncludeViews));
    } catch (err) {
      setTimeline(null);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void load();
  }

  /** El toggle recarga: las consultas las filtra el middleware, no la UI. */
  function onToggleViews(next: boolean) {
    setIncludeViews(next);
    if (timeline) void load(next);
  }

  return (
    <div className="bo-sp-shell">
      <div className="bo-sp">
        <header className="bo-sp__head">
          <h1 className="bo-sp__title">Consola de soporte</h1>
          <p className="bo-sp__subtitle">
            Trazabilidad completa de una orden o cotización del flujo Mobility: quién
            la creó, qué cambió el comercial, cuándo intervino el gerente, rechazos y
            contraofertas.
          </p>
        </header>

        <form className="bo-sp__search" onSubmit={onSubmit}>
          <label className="bo-sp__field">
            <span className="bo-sp__label">Tipo</span>
            <select
              className="bo-sp__select"
              value={type}
              onChange={(e) => setType(e.target.value as DocumentType)}
            >
              <option value="order">Orden</option>
              <option value="quote">Cotización</option>
            </select>
          </label>

          <label className="bo-sp__field bo-sp__field--grow">
            <span className="bo-sp__label">Número de documento</span>
            <input
              className="bo-sp__input"
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
              placeholder="ORD-00005234"
              autoComplete="off"
            />
          </label>

          <button
            className="bo-sp__button"
            type="submit"
            disabled={loading || !documentNumber.trim()}
          >
            {loading ? 'Buscando…' : 'Buscar'}
          </button>
        </form>

        <label className="bo-sp__toggle">
          <input
            type="checkbox"
            checked={includeViews}
            onChange={(e) => onToggleViews(e.target.checked)}
          />
          <span>Incluir consultas (quién miró el documento)</span>
        </label>

        {error && <p className="bo-sp__error">{error}</p>}

        {timeline && !error && (
          <>
            <DocumentHeader document={timeline.document} />
            <DocumentTimeline
              events={timeline.events}
              includeViews={includeViews}
            />
          </>
        )}

        {!timeline && !error && !loading && (
          <p className="bo-sp__empty">
            Ingresá el número exacto del documento para ver su recorrido completo.
          </p>
        )}
      </div>
    </div>
  );
}
