/**
 * Tipos de la sección. Espejo de `/api/revision-sap` (apps/api/src/revision-sap).
 * Ninguno trae precios: BackOffice no los ve.
 */

/** Área de venta de la orden. Define qué destinos de entrega acepta SAP. */
export interface SalesArea {
  companyCode: string | null;
  channelCode: string | null;
  sectorCode: string | null;
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
  | 'orderDate';

export type SortDir = 'ASC' | 'DESC';

/** Una orden en la bandeja: SAP la rechazó y quedó esperando a BackOffice. */
export interface ReviewQueueEntry {
  guid: string;
  orderNumber: string;
  customerCode: string | null;
  customerName: string | null;
  sellerEmail: string | null;
  salesArea: SalesArea;
  /** Motivo del último rechazo, tal como lo devolvió SAP. */
  sapLastError: string | null;
  sapLastAttemptAt: string | null;
  orderDate: string | null;
  attempts: number;
  itemCount: number;
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
export interface SapOrder {
  guid: string;
  status: SapOrderStatus;
  statusCode: string | null;
  attemptAt: string | null;
  sapOrderNumber: string | null;
  sapDispatchNumber: string | null;
  error: string | null;
  items: {
    lineNumber: number;
    productCode: string;
    description: string | null;
    quantity: number | null;
    unitOfMeasure: string | null;
  }[];
}
