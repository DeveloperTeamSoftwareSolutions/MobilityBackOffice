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

/** Fila del listado de documentos. */
export interface SupportDocument {
  id: number;
  guid: string;
  documentNumber: string | null;
  statusCode: string | null;
  customerCode: string | null;
  customerName: string | null;
  sellerEmail: string | null;
  sellerName: string | null;
  total: number | null;
  currency: string | null;
  companyCode: string | null;
  documentDate: string | null;
  sentAt: string | null;
  cancelledAt: string | null;
  serverTimestamp: number | null;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface Paged<T> {
  data: T[];
  pagination: Pagination;
}

/** Estado presente en los datos, con su conteo. Alimenta el filtro. */
export interface StatusCount {
  statusCode: string;
  total: number;
}

/** Campos por los que la tabla puede ordenar (espejo de la whitelist del backend). */
export type SortField =
  | 'documentNumber'
  | 'statusCode'
  | 'customerName'
  | 'sellerEmail'
  | 'total'
  | 'documentDate';

export type SortDir = 'ASC' | 'DESC';
