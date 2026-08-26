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

/** Estado válido del vocabulario vigente, con su marca de terminal. */
export interface StatusOption {
  code: string;
  terminal: boolean;
}

/** Resultado del override. `noop` = ya estaba en ese estado. */
export interface OverrideResult {
  ok: true;
  noop: boolean;
  documentNumber: string | null;
  fromCode: string | null;
  toCode: string;
  isTerminal?: boolean;
}

/** Línea de un documento. Precio y cantidad se muestran, nunca se editan. */
export interface SupportItem {
  guid: string;
  lineNumber: number;
  productCode: string | null;
  productDescription: string | null;
  unitOfMeasure: string | null;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
  authorizationRequired: boolean;
  authorizationStatus: string | null;
  authorizationReason: string | null;
  authTriggerReason: string | null;
  proposedPrice: number | null;
  proposedPriceCurrency: string | null;
  decidedByEmail: string | null;
  decidedAt: string | null;
  sellerResponse: string | null;
  sellerResponseReason: string | null;
  sellerRespondedByEmail: string | null;
  sellerRespondedAt: string | null;
}

/** El turno del gerente: hecho de cabecera que las líneas no conocen. */
export interface ManagerTurn {
  /** `false` = el documento nunca pasa por el gerente; el turno no aplica. */
  relevant: boolean;
  /** Cuantas lineas requieren autorizacion. */
  escalatedLines: number;
  /** La cabecera pidio otra forma de pago. */
  headerRequires: boolean;
  closed: boolean;
  resolvedAt: string | null;
  resolvedByEmail: string | null;
}

export interface DocumentItems {
  document: { guid: string; documentNumber: string | null; statusCode: string | null };
  managerTurn: ManagerTurn;
  items: SupportItem[];
}

export interface ItemStatusResult {
  ok: true;
  documentNumber: string | null;
  lineNumber: number;
  statusBefore: string | null;
  statusAfter: string | null;
  recomputed: boolean;
}

export interface RecomputeResult {
  ok: true;
  documentNumber: string | null;
  statusBefore: string | null;
  statusAfter: string | null;
}
