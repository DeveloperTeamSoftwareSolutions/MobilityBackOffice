/** Tipos de documento que cubre la consola de soporte (flujo Mobility). */
export type DocumentType = 'order' | 'quote';

/** Los dos unicos valores validos; se usa para validar el parametro de ruta. */
export const DOCUMENT_TYPES: readonly DocumentType[] = ['order', 'quote'];

export function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

/**
 * Cabecera del documento tal como la publica `GET /mobility/document-timeline`
 * del middleware. Es un resumen: la consola no necesita el detalle de lineas
 * para auditar el recorrido.
 */
export interface TimelineDocument {
  guid: string;
  documentNumber: string | null;
  sellerEmail: string | null;
  customerCode: string | null;
  customerName: string | null;
  statusCode: string | null;
  sentAt: string | null;
  cancelledAt: string | null;
  cancelledByEmail: string | null;
  cancellationReasonCode: string | null;
  cancellationReasonNotes: string | null;
}

/**
 * Un hito de la bitacora.
 *
 * `kind` se deja como string y no como union cerrada a proposito: el middleware
 * lo deriva de varias fuentes (hitos de cabecera, `Auditories.Action`, pagos,
 * credito, resoluciones) y agregar una fuente nueva alla no debe romper la UI
 * de aca. La UI mapea los kinds que conoce y degrada al titulo para el resto.
 */
export interface TimelineEvent {
  at: string;
  kind: string;
  title: string;
  detail: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  source: string | null;
}

/** Respuesta completa de la bitacora: cabecera + hitos ordenados. */
export interface DocumentTimeline {
  document: TimelineDocument;
  events: TimelineEvent[];
}

/** Opciones de lectura de la bitacora. */
export interface TimelineQuery {
  type: DocumentType;
  number: string;
  /** Suma los eventos de "quien MIRO el documento". Fuera por default: es ruido. */
  includeViews?: boolean;
  includeMessages?: boolean;
}
