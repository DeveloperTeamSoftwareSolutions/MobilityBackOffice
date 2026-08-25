/** Espejo de `DocumentType` del backend (apps/api/src/support/support.types.ts). */
export type DocumentType = 'order' | 'quote';

/** Cabecera del documento que devuelve la bitácora del middleware. */
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
 * Un hito de la bitácora. `kind` es string abierto a propósito: el middleware puede
 * sumar fuentes nuevas y la UI no debe romperse por eso — los kinds conocidos se
 * colorean y el resto cae en el estilo neutro.
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

export interface DocumentTimeline {
  document: TimelineDocument;
  events: TimelineEvent[];
}
