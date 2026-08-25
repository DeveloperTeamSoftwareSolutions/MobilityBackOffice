import { TimelineDocument } from './soporte.types';

/** Fecha ISO → `dd/mm/aaaa hh:mm`. Devuelve un guion si no hay dato. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface Props {
  document: TimelineDocument;
}

/**
 * Ficha del documento: identidad, cliente, vendedor y estado actual. Es el contexto
 * que soporte necesita antes de leer la línea de tiempo.
 */
export function DocumentHeader({ document }: Props) {
  const anulado = Boolean(document.cancelledAt);
  const motivo =
    document.cancellationReasonNotes || document.cancellationReasonCode || null;

  return (
    <section className="bo-sp__card">
      <header className="bo-sp__card-head">
        <h2 className="bo-sp__doc-number">{document.documentNumber ?? '—'}</h2>
        <span
          className={`bo-sp__status ${anulado ? 'bo-sp__status--cancelled' : ''}`}
        >
          {document.statusCode ?? 'Sin estado'}
        </span>
      </header>

      <dl className="bo-sp__facts">
        <div className="bo-sp__fact">
          <dt>Cliente</dt>
          <dd>
            {document.customerName ?? '—'}
            {document.customerCode ? ` (${document.customerCode})` : ''}
          </dd>
        </div>
        <div className="bo-sp__fact">
          <dt>Vendedor</dt>
          <dd>{document.sellerEmail ?? '—'}</dd>
        </div>
        <div className="bo-sp__fact">
          <dt>Enviado a aprobación</dt>
          <dd>{formatDateTime(document.sentAt)}</dd>
        </div>
        <div className="bo-sp__fact">
          <dt>Anulado</dt>
          <dd>{formatDateTime(document.cancelledAt)}</dd>
        </div>
      </dl>

      {anulado && (
        <p className="bo-sp__cancel-note">
          Anulado por {document.cancelledByEmail ?? 'usuario desconocido'}.{' '}
          {motivo ? `Motivo: ${motivo}` : 'Sin motivo registrado.'}
        </p>
      )}
    </section>
  );
}
