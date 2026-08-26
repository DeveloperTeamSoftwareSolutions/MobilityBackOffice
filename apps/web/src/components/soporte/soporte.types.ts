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
  /** Estado que la proyección daría hoy. */
  projectedStatus?: string | null;
  /** false = el estado guardado no coincide con el calculado. */
  statusConsistent?: boolean | null;
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

/**
 * Vocabulario de las decisiones. Lo define el middleware; acá se declara como tipo
 * para que el compilador atrape un valor mal escrito antes de que viaje.
 */
export const ITEM_DECISIONS = ['approved', 'rejected', 'countered'] as const;
export const ITEM_RESPONSES = ['accept', 'reject'] as const;

/** En el plazo de pago, `observed` ES la contraoferta y viaja con `value`. */
export const PAYMENT_DECISIONS = ['approved', 'rejected', 'observed'] as const;
export const PAYMENT_RESPONSES = ['accept', 'reject'] as const;

export type ItemDecision = (typeof ITEM_DECISIONS)[number];
export type ItemResponse = (typeof ITEM_RESPONSES)[number];
export type PaymentDecision = (typeof PAYMENT_DECISIONS)[number];
export type PaymentResponse = (typeof PAYMENT_RESPONSES)[number];

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

/**
 * Plazo de pago pedido en la cabecera. `requested` en null = el vendedor no pidió
 * nada y el panel no se muestra.
 */
export interface PaymentTerms {
  requested: string | null;
  /** `null` = sin decidir. `observed` es la contraoferta del gerente. */
  status: string | null;
  /** Lo concedido; con `observed`, el plazo que el gerente contrapropone. */
  approved: string | null;
  decidedByEmail: string | null;
  decidedAt: string | null;
}

export interface DocumentItems {
  document: { guid: string; documentNumber: string | null; statusCode: string | null };
  paymentTerms: PaymentTerms;
  managerTurn: ManagerTurn;
  items: SupportItem[];
}

/**
 * Resultado común de las cuatro decisiones.
 *
 * `statusBefore`/`statusAfter` iguales NO es un fallo: el estado es una proyección
 * de los hechos y puede faltar decidir otra línea o cerrar el turno del gerente.
 */
export interface DecisionResult {
  ok: true;
  documentNumber: string | null;
  statusBefore: string | null;
  statusAfter: string | null;
}

export interface RecomputeResult {
  ok: true;
  documentNumber: string | null;
  statusBefore: string | null;
  statusAfter: string | null;
}

/** Qué estado daría el recálculo hoy. Es una estimación: no re-evalúa el crédito. */
export interface ProjectedStatus {
  ok: true;
  current: string | null;
  projected: string;
  matches: boolean;
  estimated: boolean;
}

/** Diagnóstico de documentos con el estado desfasado. */
export interface InconsistentReport {
  data: SupportDocument[];
  scanned: number;
  total: number;
  truncated: boolean;
}

/** Accion con intencion: escribe hechos y deja que el estado se calcule. */
export interface SupportAction {
  action: string;
  /** Estado destino, solo para volver atras. */
  target: string | null;
  label: string;
  available: boolean;
  reason: string | null;
  effect: string;
  expects?: string | null;
  warning?: boolean;
}

export interface DocumentActions {
  documentNumber: string | null;
  statusCode: string | null;
  actions: SupportAction[];
}

/**
 * Resultado de una accion. `achieved` es false cuando el estado final no es el
 * esperado: hay compuertas fuera del alcance de soporte (el motor de credito, por
 * ejemplo) que pueden retener el documento. Se informa en vez de ocultarse.
 */
export interface ActionResult {
  ok: true;
  action: string;
  documentNumber: string | null;
  statusBefore: string | null;
  statusAfter: string | null;
  expected: string | null;
  achieved: boolean;
  itemsTouched: number;
}
