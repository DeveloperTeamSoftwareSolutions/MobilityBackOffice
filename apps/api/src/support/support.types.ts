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

/** Fila del listado de documentos de la consola. */
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

export interface PagedDocuments {
  data: SupportDocument[];
  pagination: Pagination;
}

/** Estado existente en los datos, con su conteo. Alimenta el filtro de la UI. */
export interface StatusCount {
  statusCode: string;
  total: number;
}

/** Parametros del listado. `limit` lo clampea el controller. */
export interface DocumentsQuery {
  type: DocumentType;
  page: number;
  limit: number;
  search: string;
  status: string;
  sortBy: string;
  sortDir: 'ASC' | 'DESC';
}

/**
 * Campos ordenables. Espejo de la whitelist del middleware
 * (`support.repository.SORTABLE`): si se manda otro, el middleware cae al default.
 */
export const SORTABLE_FIELDS: readonly string[] = [
  'documentNumber',
  'statusCode',
  'customerName',
  'sellerEmail',
  'total',
  'documentDate',
  'serverTimestamp',
];

/** Estado valido del vocabulario vigente, con su marca de terminal. */
export interface StatusOption {
  code: string;
  terminal: boolean;
}

/** Pedido de override de estado. `reasonNotes` es obligatorio. */
export interface OverrideRequest {
  type: DocumentType;
  guid: string;
  toCode: string;
  reasonCode: string | null;
  reasonNotes: string;
  actorEmail: string | null;
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

/**
 * Estados de linea que soporte puede escribir. `countered` queda AFUERA: una
 * contraoferta viaja con un precio propuesto, y soporte no toca precios.
 */
export const ALLOWED_AUTH_STATUS = [null, 'approved', 'rejected'] as const;
export const ALLOWED_SELLER_RESPONSE = [null, 'accepted', 'rejected'] as const;

export type AuthorizationStatus = (typeof ALLOWED_AUTH_STATUS)[number];
export type SellerResponse = (typeof ALLOWED_SELLER_RESPONSE)[number];

/** Linea de un documento. Precio y cantidad viajan SOLO para mostrarlos. */
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

/**
 * El turno del gerente. Es un hecho de CABECERA que las lineas no conocen: sin la
 * fila de resolucion el documento se queda en `ReadyForApprove` aunque todas las
 * lineas esten decididas. Se expone para que soporte entienda por que no avanza.
 */
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

/** Cambio de estado de UNA linea. Solo estados. */
export interface ItemStatusRequest {
  type: DocumentType;
  guid: string;
  itemGuid: string;
  authorizationStatus?: AuthorizationStatus;
  sellerResponse?: SellerResponse;
  authorizationRequired?: boolean;
  reasonNotes: string;
  actorEmail: string | null;
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
