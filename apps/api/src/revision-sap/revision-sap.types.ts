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

export interface ReviewQueueQuery {
  page: number;
  limit: number;
  search: string;
  sortBy: ReviewSortField;
  sortDir: 'ASC' | 'DESC';
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
  orderDate: string | null;
  attempts: number;
  itemCount: number;
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
 * Resultado del reenvío a SAP. Espejo de `data.sap` de `businessorders2sap`.
 *
 * `accepted` NO es "la llamada salió bien": el middleware exige que SAP haya devuelto
 * número de pedido y que su log no traiga errores. Un 200 con `accepted: false` es un
 * rechazo de SAP, con el motivo en `error`.
 */
export interface ResendResult {
  /** SAP aceptó el pedido: hay número y el log no trae errores. */
  accepted: boolean;
  /** No se llegó a llamar a SAP (agrupa factura con faltantes, o ningún ítem vendible). */
  skipped: boolean;
  /** Por qué no se envió, cuando `skipped`. */
  skippedReason: string | null;
  /** Número de pedido de SAP, si lo creó. */
  sapOrderNumber: string | null;
  /** Número de entrega. Sin él, el pedido existe pero no se despacha: sigue en revisión. */
  sapDispatchNumber: string | null;
  /** Motivo del rechazo, con el mismo formato `[TIPO] mensaje` que el resto. */
  error: string | null;
  /** Mensajes que devolvió SAP, ya separados. */
  sapMessages: string[];
  /** Ítems que el middleware dejó afuera por no tener stock. */
  filteredItemsCount: number;
  itemsSent: number;
  /** La orden salió de revisión: con SAP aceptando, el envío exitoso la cierra. */
  stillInReview: boolean;
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
