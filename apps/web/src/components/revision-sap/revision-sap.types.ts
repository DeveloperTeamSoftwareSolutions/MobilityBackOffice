/**
 * Tipos de la sección. Espejo de `/api/revision-sap` (apps/api/src/revision-sap).
 * Ninguno trae precios: BackOffice no los ve.
 */

/** Área de venta de la orden. Define qué destinos de entrega acepta SAP. */
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

export type SortField =
  | 'sapLastAttemptAt'
  | 'orderNumber'
  | 'customerName'
  | 'sellerEmail'
  | 'orderDate'
  /** Sólo tiene sentido en la pestaña de resueltas. */
  | 'decidedAt';

export type SortDir = 'ASC' | 'DESC';

/**
 * Las dos pestañas de la bandeja: lo que hay que resolver y lo que ya se resolvió.
 * Quedan afuera de las dos las órdenes que nunca pasaron por BackOffice.
 */
export type ReviewView = 'pending' | 'resolved';

/** Una orden en la bandeja: SAP la rechazó y quedó esperando a BackOffice. */
export interface ReviewQueueEntry {
  guid: string;
  orderNumber: string;
  statusCode: string | null;
  customerCode: string | null;
  customerName: string | null;
  sellerEmail: string | null;
  salesArea: SalesArea;
  /** Motivo del último rechazo, tal como lo devolvió SAP. */
  sapLastError: string | null;
  sapLastAttemptAt: string | null;
  /** Con número de pedido salió a SAP; sin número, se cerró sin enviar. */
  sapOrderNumber: string | null;
  sapDispatchNumber: string | null;
  orderDate: string | null;
  attempts: number;
  itemCount: number;
  /** Quién cerró la revisión y cuándo. Es lo que cuenta cómo se resolvió. */
  decidedBy: string | null;
  decidedAt: string | null;
}

/** Línea de la orden, sin precios ni descuentos. */
export interface ReviewItem {
  guid: string;
  lineNumber: number;
  productCode: string;
  productDescription: string | null;
  quantity: number | null;
  unitOfMeasure: string | null;
  /** Centro propio de la línea. Sin él, la línea sale con el de la cabecera. */
  centerCode: string | null;
  deliveryDestinationCode: string | null;
  deliveryDestinationName: string | null;
}

export interface SapAttempt {
  guid: string;
  attemptAt: string | null;
  statusCode: string | null;
  error: string | null;
}

export interface ReviewOrderDetail {
  guid: string;
  orderNumber: string;
  statusCode: string | null;
  customerCode: string | null;
  customerName: string | null;
  sellerEmail: string | null;
  sellerName: string | null;
  salesArea: SalesArea;
  centerCode: string | null;
  centerName: string | null;
  destination: string | null;
  orderDate: string | null;
  cancelledAt: string | null;
  /** Agrupa factura con la orden de compra del cliente: no puede salir parcial. */
  groupInvoice: boolean;
  sap: {
    orderNumber: string | null;
    lastError: string | null;
    lastAttemptAt: string | null;
  };
  backoffice: {
    inReview: boolean;
    decidedBy: string | null;
    decidedAt: string | null;
  };
  items: ReviewItem[];
  /** Intentos de envío, del más reciente al más viejo. */
  sapAttempts: SapAttempt[];
}

export interface CenterOption {
  centerCode: string;
  centerName: string | null;
}

export interface DestinationOption {
  destinationCode: string;
  destinationName: string | null;
  deliveryAddress: string | null;
}

/** Stock disponible: productCode -> centerCode -> cantidad. */
export type StockByCenter = Record<string, Record<string, number>>;

export interface OptionsError {
  source: string;
  productCode?: string;
  message: string;
}

/**
 * Lo que se puede elegir para una orden: los centros permitidos del cliente y los
 * destinos del área de venta de la orden, con el stock si ya se consultó.
 */
export interface ReviewCatalogs {
  centers: CenterOption[];
  destinations: DestinationOption[];
  /** `null` mientras el stock no se consultó. */
  stock: StockByCenter | null;
  errors: OptionsError[];
}

/** Centro y destino elegidos para una línea. */
export interface LineDraft {
  centerCode: string | null;
  destinationCode: string | null;
}

/** Lo elegido para cada línea, por guid de la línea. */
export type LineDrafts = Record<string, LineDraft>;

export type LineField = 'center' | 'destination';

export interface LineChange {
  item: ReviewItem;
  field: LineField;
  before: string | null;
  after: string | null;
}

export type ItemWarningKind =
  | 'sin-destino'
  | 'destino-fuera-del-area'
  | 'centro-no-permitido'
  | 'centro-de-cabecera-no-permitido'
  | 'sin-stock'
  | 'stock-insuficiente';

export interface ItemWarning {
  kind: ItemWarningKind;
  /** `true` impide guardar y reenviar; lo demás solo avisa. */
  blocking: boolean;
  message: string;
}

export type SapOrderStatus = 'accepted' | 'accepted_no_dispatch' | 'rejected' | 'no_response';

/** Una orden SAP de la orden, con sus ítems sin precios. */
/**
 * Desde qué aplicación salió el envío que creó esta orden SAP.
 *
 * Lo **deduce** el middleware del número interno de la orden SAP: la tabla no guarda el
 * origen. El envío de BackOffice numera `ORD…S<id>` —porque crea una orden SAP por
 * centro— y el del vendedor deja el número tal cual.
 */
export type SapOrderSource = 'mobilityia' | 'backoffice';

export interface SapOrder {
  guid: string;
  status: SapOrderStatus;
  statusCode: string | null;
  /** Número INTERNO de la orden SAP (no el que devuelve SAP). */
  orderNumber: string | null;
  /** Qué app disparó el envío. Deducido, no guardado. */
  source: SapOrderSource;
  /** Centro del que sale esta orden SAP: con la orden partida, distingue una de otra. */
  centerCode: string | null;
  centerName: string | null;
  attemptAt: string | null;
  sapOrderNumber: string | null;
  sapDispatchNumber: string | null;
  error: string | null;
  items: SapOrderItem[];
}

/**
 * Un ENVÍO: las órdenes SAP que salieron juntas, desde la misma app.
 *
 * Es lo que separa la pestaña "Órdenes SAP" con una línea divisoria. Sin esto, tres
 * órdenes SAP de dos envíos distintos se leen como una sola tanda.
 *
 * ⚠️ No confundir con `SapAttempt`, que es otra cosa: los intentos registrados en la
 * cabecera de la orden (`sapAttempts`), sin las órdenes SAP que produjeron.
 */
export interface SapSendAttempt {
  /** Cuándo se hizo el envío: el más reciente de sus órdenes SAP. */
  attemptAt: string | null;
  source: SapOrderSource;
  /** Una por centro, en el orden en que las devolvió el servidor. */
  orders: SapOrder[];
}

/**
 * Producto de una orden SAP. Trae además la línea de la orden original, que es lo que
 * permite corregir centro y destino sin salir de la orden SAP rechazada.
 */
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

/** Una fila del stock: un almacén de un centro. */
export interface ProductStockRow {
  centerCode: string | null;
  centerName: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  unitOfMeasure: string | null;
  available: number;
  inInspection: number;
  inTransit: number;
  /** El cliente puede recibir desde este almacén. */
  allowedForCustomer: boolean;
}

/**
 * Un centro como opción elegible desde el modal de stock: el disponible sumado de sus
 * almacenes, y si el cliente puede recibir desde ahí.
 */
export interface StockCenterOption {
  centerCode: string;
  centerName: string | null;
  /** Suma del disponible de todos sus almacenes. */
  available: number;
  warehouses: number;
  /** Está entre los centros permitidos del cliente. El stock NO decide esto. */
  elegible: boolean;
}

export interface ProductStock {
  productCode: string;
  companyCode: string | null;
  unitOfMeasure: string | null;
  totals: { available: number; availableForCustomer: number; centers: number };
  rows: ProductStockRow[];
  errors: { source: string; message: string }[];
}

/**
 * Resultado de cambiar "agrupa factura": es de cabecera, así que no devuelve una línea.
 */
export interface GroupInvoiceChangeResult {
  ok: boolean;
  unchanged: boolean;
  groupInvoice: boolean;
}

/**
 * Una orden SAP del reenvío: un centro de distribución.
 *
 * El envío de BackOffice parte la orden en una orden SAP POR CENTRO, así que el
 * resultado ya no es uno solo. `status` usa el mismo vocabulario que la pestaña
 * "Órdenes SAP": lo que pasó al enviar y lo que queda registrado son la misma cosa, y
 * llamarlas distinto obligaría al operador a traducir.
 */
export interface ResendBucket {
  centerCode: string;
  itemsCount: number;
  status: 'accepted' | 'accepted_no_dispatch' | 'rejected' | 'not_sent';
  sapOrderNumber: string | null;
  sapDispatchNumber: string | null;
  error: string | null;
  sapMessages: string[];
}

/**
 * Resultado del reenvío a SAP, que son VARIAS órdenes SAP: una por centro.
 *
 * `accepted` es "salieron todos". `skipped` es que ni se intentó, y no hay que mostrarlo
 * como rechazo. Y `partial` es el caso nuevo y el más delicado: **algunos pedidos ya
 * existen en SAP y otros no**, así que reintentar la orden entera duplicaría los que
 * salieron.
 */
export interface ResendResult {
  accepted: boolean;
  partial: boolean;
  skipped: boolean;
  skippedReason: string | null;
  buckets: ResendBucket[];
  totalBuckets: number;
  acceptedBuckets: number;
  failedBuckets: number;
  error: string | null;
  filteredItemsCount: number;
  itemsSent: number;
  /** La orden sigue en la bandeja: algún centro no salió. */
  stillInReview: boolean;
}

/**
 * Resultado de rechazar la orden desde BackOffice.
 *
 * Es TERMINAL: la orden pasa a `Rejected`, sale de la bandeja y no se deshace. El
 * vendedor la ve como "Rechazada" y sólo puede copiarla. El motivo NO viaja acá: quedó
 * en el hilo de comentarios, que es donde él lo lee.
 */
export interface RejectResult {
  ok: boolean;
  /** El estado que quedó tras el recálculo del middleware. */
  statusCode: string;
}

/** Una línea del motivo del rechazo: el tipo que devolvió SAP y su mensaje. */
export interface SapErrorLine {
  /** `E`, `W`, … tal como lo manda SAP. `null` si el mensaje no traía tipo. */
  type: string | null;
  message: string;
}
