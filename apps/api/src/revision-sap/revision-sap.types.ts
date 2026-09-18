/**
 * Contratos de la revisión de órdenes rechazadas por SAP. Espejo de
 * `/api/mobility/backoffice-review` del middleware (docs/API_BACKOFFICE_REVIEW.md).
 * Ninguno trae precios: BackOffice no los ve.
 */

export interface SalesArea {
  companyCode: string | null;
  channelCode: string | null;
  sectorCode: string | null;
  /** Nombres de los maestros de SAP; `null` si el código no tiene maestro. */
  companyName: string | null;
  channelName: string | null;
  sectorName: string | null;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const REVIEW_SORT_FIELDS = [
  'sapLastAttemptAt',
  'orderNumber',
  'customerName',
  'sellerEmail',
  'orderDate',
] as const;

export type ReviewSortField = (typeof REVIEW_SORT_FIELDS)[number];

export function isReviewSortField(value: string): value is ReviewSortField {
  return (REVIEW_SORT_FIELDS as readonly string[]).includes(value);
}

/**
 * Las dos caras de la bandeja: las que BackOffice tiene que resolver y las que ya
 * resolvió. Las separa `ProcessedBackoffice` (0 / 1) del lado del middleware.
 */
export const REVIEW_VIEWS = ['pending', 'resolved'] as const;

export type ReviewView = (typeof REVIEW_VIEWS)[number];

export function isReviewView(value: string): value is ReviewView {
  return (REVIEW_VIEWS as readonly string[]).includes(value);
}

export interface ReviewQueueQuery {
  page: number;
  limit: number;
  search: string;
  sortBy: ReviewSortField;
  sortDir: 'ASC' | 'DESC';
  view: ReviewView;
}

export interface ReviewQueueEntry {
  guid: string;
  orderNumber: string;
  statusCode: string | null;
  customerCode: string | null;
  customerName: string | null;
  sellerEmail: string | null;
  sellerName: string | null;
  salesArea: SalesArea;
  sapLastError: string | null;
  sapLastAttemptAt: string | null;
  sapOrderNumber: string | null;
  sapDispatchNumber: string | null;
  orderDate: string | null;
  attempts: number;
  itemCount: number;
  /** Quién cerró la revisión y cuándo. En `pending` suelen venir en null. */
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface ReviewQueuePage {
  data: ReviewQueueEntry[];
  pagination: Pagination;
}

export interface ReviewItem {
  guid: string;
  lineNumber: number;
  productCode: string;
  productDescription: string | null;
  quantity: number | null;
  unitOfMeasure: string | null;
  centerCode: string | null;
  deliveryDestinationCode: string | null;
  deliveryDestinationName: string | null;
  destinationExplicit: boolean;
}

export interface SapAttempt {
  guid: string;
  attemptAt: string | null;
  statusCode: string | null;
  error: string | null;
  sapOrderNumber: string | null;
  sapDispatchNumber: string | null;
}

export interface ReviewOrder {
  guid: string;
  orderNumber: string;
  statusCode: string | null;
  customerCode: string | null;
  customerName: string | null;
  sellerEmail: string | null;
  sellerName: string | null;
  salesArea: SalesArea;
  profitCenterCode: string | null;
  profitCenterName: string | null;
  centerCode: string | null;
  centerName: string | null;
  dispatchCenterCode: string | null;
  destination: string | null;
  orderDate: string | null;
  cancelledAt: string | null;
  /** Agrupa factura con la orden de compra del cliente: no puede salir parcial. */
  groupInvoice: boolean;
  sap: {
    orderNumber: string | null;
    dispatchNumber: string | null;
    lastError: string | null;
    lastAttemptAt: string | null;
  };
  backoffice: {
    inReview: boolean;
    processedBackoffice: number | null;
    decidedBy: string | null;
    decidedAt: string | null;
  };
  items: ReviewItem[];
  sapAttempts: SapAttempt[];
}

export interface ReviewOptions {
  orderGuid: string;
  salesArea: SalesArea;
  centers: { centerCode: string; centerName: string | null }[];
  destinations: {
    destinationCode: string;
    destinationName: string | null;
    deliveryAddress: string | null;
  }[];
  /** productCode -> centerCode -> cantidad. `null` si se pidió sin stock. */
  stock: Record<string, Record<string, number>> | null;
  errors: { source: string; productCode?: string; message: string }[];
}

export interface DestinationChangeResult {
  ok: true;
  unchanged: boolean;
  item: ReviewItem;
}

/** El cambio de centro devuelve la misma forma que el de destino. */
export type CenterChangeResult = DestinationChangeResult;

/**
 * Cambio de "agrupa factura". No devuelve una línea: es de cabecera y decide si la
 * orden ENTERA puede salir parcial.
 */
export interface GroupInvoiceChangeResult {
  ok: boolean;
  unchanged: boolean;
  groupInvoice: boolean;
}

/**
 * Una orden SAP del reenvío: un centro de distribución.
 *
 * El envío de BackOffice parte la orden en una orden SAP POR CENTRO (el middleware las
 * llama "buckets"), así que el resultado ya no es uno solo: cada centro se envía, se
 * acepta o se rechaza por su cuenta.
 *
 * `status` usa el MISMO vocabulario que la pestaña "Órdenes SAP" a propósito: lo que
 * pasó al reenviar y lo que quedó registrado son la misma cosa, y llamarlas distinto
 * obligaría al operador a traducir.
 */
export interface ResendBucket {
  /** Centro de distribución: es lo que agrupa esta orden SAP. */
  centerCode: string;
  /** Cuántas líneas de la orden salieron en este centro. */
  itemsCount: number;
  /**
   * `accepted` = pedido creado. `accepted_no_dispatch` = hay pedido pero no entrega: la
   * mercadería no se despacha y eso se resuelve en SAP. `rejected` = SAP lo rechazó.
   * `not_sent` = ni se intentó (falló al registrarlo antes de llamar a SAP).
   */
  status: 'accepted' | 'accepted_no_dispatch' | 'rejected' | 'not_sent';
  /** N° de pedido de SAP, si lo creó. */
  sapOrderNumber: string | null;
  /** N° de entrega. Sin él el pedido existe pero no se despacha. */
  sapDispatchNumber: string | null;
  /** Motivo del rechazo de este centro. */
  error: string | null;
  /** Mensajes de SAP de este centro, con el formato `[TIPO] mensaje`. */
  sapMessages: string[];
}

/**
 * Resultado del reenvío a SAP, que ahora son VARIAS órdenes SAP: una por centro.
 *
 * ⚠️ Tres trampas del contrato del middleware, y las tres están resueltas acá para que
 * quien lea este objeto no tenga que conocerlas:
 *
 * 1. **El `success` de arriba miente.** En algunas ramas viene `false` aunque SAP haya
 *    aceptado todo (avisa de ítems sin stock, no de un rechazo). Lo que vale es el
 *    resultado de los buckets, y eso es lo que informa `accepted`.
 * 2. **Un fallo parcial llega como HTTP 200.** No es un error de transporte: es que un
 *    centro salió y otro no.
 * 3. **Los centros que salieron bien quedan creados en SAP igual.** Por eso existe
 *    `partial`: reintentar a ciegas duplicaría esos pedidos.
 */
export interface ResendResult {
  /** TODOS los centros salieron bien. Es lo único que cierra la revisión. */
  accepted: boolean;
  /**
   * Algunos centros salieron y otros no. **Lo que salió ya existe en SAP**: no se
   * reintenta la orden entera sin mirar qué quedó creado.
   */
  partial: boolean;
  /** No se llegó a llamar a SAP (agrupa factura con faltantes, o ningún ítem vendible). */
  skipped: boolean;
  /** Por qué no se envió, cuando `skipped`. */
  skippedReason: string | null;
  /** Una por centro, en el orden que las devolvió el middleware. */
  buckets: ResendBucket[];
  totalBuckets: number;
  acceptedBuckets: number;
  failedBuckets: number;
  /** Resumen de los errores, ya con el centro de cada uno. */
  error: string | null;
  /** Ítems que el middleware dejó afuera por no tener stock. */
  filteredItemsCount: number;
  itemsSent: number;
  /**
   * La orden sigue en la bandeja. El middleware la deja en revisión si algún centro
   * falló, y la cierra sólo cuando salieron todos.
   */
  stillInReview: boolean;
}

/**
 * Resultado de rechazar la orden.
 *
 * Es TERMINAL: la orden pasa a `Rejected`, sale de la bandeja y no se deshace. El
 * `statusCode` es el que quedó tras el recálculo del middleware — se devuelve en vez de
 * asumirlo porque, si el recompute falla, el hecho quedó estampado igual y el estado se
 * acomoda en el siguiente.
 */
export interface RejectResult {
  ok: boolean;
  statusCode: string;
}

export type SapOrderStatus = 'accepted' | 'accepted_no_dispatch' | 'rejected' | 'no_response';

/** Una orden SAP de la orden (fila de `SAPOrders`), con sus ítems sin precios. */
export interface SapOrder {
  guid: string;
  status: SapOrderStatus;
  statusCode: string | null;
  /** Centro del que sale esta orden SAP: con la orden partida, distingue una de otra. */
  centerCode: string | null;
  centerName: string | null;
  attemptAt: string | null;
  sapOrderNumber: string | null;
  sapDispatchNumber: string | null;
  sapOrderCreatedAt: string | null;
  error: string | null;
  items: SapOrderItem[];
}

/** Ítem de una orden SAP, con la línea de la orden original para poder corregirla. */
export interface SapOrderItem {
  lineNumber: number;
  productCode: string;
  description: string | null;
  quantity: number | null;
  unitOfMeasure: string | null;
  itemGuid: string | null;
  centerCode: string | null;
  deliveryDestinationCode: string | null;
  deliveryDestinationName: string | null;
}

/** Stock de un producto por centro y almacén. */
export interface ProductStock {
  productCode: string;
  companyCode: string | null;
  unitOfMeasure: string | null;
  totals: { available: number; availableForCustomer: number; centers: number };
  rows: {
    centerCode: string | null;
    centerName: string | null;
    warehouseCode: string | null;
    warehouseName: string | null;
    unitOfMeasure: string | null;
    available: number;
    inInspection: number;
    inTransit: number;
    allowedForCustomer: boolean;
  }[];
  errors: { source: string; message: string }[];
}
