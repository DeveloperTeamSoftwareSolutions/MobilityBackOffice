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
  /** Estado que la proyeccion daria hoy. null si no se pudo calcular. */
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

/**
 * Vocabulario de las decisiones. Sale del middleware (`GET /item-statuses`) y se
 * declara acá como tipo para que el compilador atrape un valor mal escrito.
 *
 * `countered` ahora SÍ está: la contraoferta viaja con su precio propuesto, así que
 * ya no deja la línea "contraofertada sin precio" que hizo excluirla antes.
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

/**
 * Plazo de pago pedido en la cabecera. `requested` en null = el vendedor no pidió
 * nada y no hay panel que mostrar.
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
  /** El documento ya es de SAP: la consola no ofrece ninguna decisión. */
  sap?: SapLock;
  document: { guid: string; documentNumber: string | null; statusCode: string | null };
  paymentTerms: PaymentTerms;
  managerTurn: ManagerTurn;
  items: SupportItem[];
}

/** Decisión del gerente sobre una línea, ejecutada por soporte a su pedido. */
export interface ItemDecisionRequest {
  type: DocumentType;
  guid: string;
  /** El flujo identifica la línea por código de producto, no por Guid. */
  productCode: string;
  status: ItemDecision;
  /** Solo en la contraoferta. El middleware lo exige ahí y lo ignora en el resto. */
  proposedPrice?: number | null;
  reasonNotes: string;
  actorEmail: string | null;
}

/** Respuesta del vendedor a una contraoferta de línea. */
export interface ItemResponseRequest {
  type: DocumentType;
  guid: string;
  productCode: string;
  action: ItemResponse;
  reasonNotes: string;
  actorEmail: string | null;
}

/** Decisión del gerente sobre el plazo de pago pedido en la cabecera. */
export interface PaymentDecisionRequest {
  type: DocumentType;
  guid: string;
  status: PaymentDecision;
  /** El plazo que se contrapropone. Obligatorio con `observed`. */
  value?: string | null;
  reasonNotes: string;
  actorEmail: string | null;
}

/** Respuesta del vendedor a una contraoferta de plazo de pago. */
export interface PaymentResponseRequest {
  type: DocumentType;
  guid: string;
  action: PaymentResponse;
  reasonNotes: string;
  actorEmail: string | null;
}

/**
 * Resultado común de las cuatro decisiones.
 *
 * `statusAfter` no es decorativo: el estado del documento es una proyección de los
 * hechos, así que decidir una línea puede moverlo o no. Devolverlo evita que la UI
 * tenga que adivinar si hizo falta algo más.
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

/** Que estado daria el recalculo hoy. Es una ESTIMACION: no re-evalua el credito. */
export interface ProjectedStatus {
  ok: true;
  current: string | null;
  projected: string;
  matches: boolean;
  estimated: boolean;
}

/**
 * Diagnostico de documentos con el estado desfasado. `truncated` avisa que el
 * scan llego al tope: sin eso, una lista corta se leeria como "no hay mas".
 */
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

/**
 * El documento ya es de SAP: la consola no lo toca de ninguna forma.
 *
 * Se marca por dos señales, y hacen falta las dos: el identificador que estampa SAP
 * al crear el documento, y el estado dentro del tramo de SAP —que el vendedor
 * escribe al entregarlo, antes de que SAP conteste—. Con solo el identificador
 * quedaba abierta toda la ventana entre la entrega y la respuesta.
 */
export interface SapLock {
  locked: boolean;
  sapId?: string | null;
  sapNumber?: string | null;
  /** Entregado a SAP pero todavía sin identificador: SAP no contestó aún. */
  entregadoSinId?: boolean;
  message?: string;
}

export interface DocumentActions {
  sap?: SapLock;
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
