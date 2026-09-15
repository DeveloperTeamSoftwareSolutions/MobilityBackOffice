/** Área de venta de la orden. Define qué destinos de entrega acepta SAP. */
export interface SalesArea {
  companyCode: string;
  channelCode: string;
  sectorCode: string;
}

/** Una orden en la bandeja: SAP la rechazó y quedó esperando a BackOffice. */
export interface ReviewQueueEntry {
  guid: string;
  orderNumber: string;
  customerCode: string;
  customerName: string;
  sellerEmail: string;
  salesArea: SalesArea;
  /** Motivo del último rechazo, tal como lo devolvió SAP. */
  sapError: string;
  rejectedAt: string;
  attempts: number;
  itemCount: number;
}

/** Línea de la orden, sin precios ni descuentos: BackOffice no los ve. */
export interface ReviewItem {
  guid: string;
  lineNumber: number;
  productCode: string;
  productName: string;
  quantity: number;
  unitOfMeasure: string;
  centerCode: string | null;
  destinationCode: string | null;
}

export interface SapAttempt {
  attemptAt: string;
  message: string;
}

export interface ReviewOrderDetail extends ReviewQueueEntry {
  orderDate: string;
  headerCenterCode: string | null;
  headerDestinationCode: string | null;
  /** Intentos de envío rechazados, del más reciente al más viejo. */
  sapAttempts: SapAttempt[];
  items: ReviewItem[];
}

export interface CenterOption {
  centerCode: string;
  centerName: string;
}

export interface DestinationOption {
  destinationCode: string;
  destinationName: string;
  deliveryAddress: string | null;
}

/** Stock disponible: productCode -> centerCode -> cantidad. */
export type StockByCenter = Record<string, Record<string, number>>;

/**
 * Lo que se puede elegir para una orden: los centros permitidos del cliente y los
 * destinos del área de venta de la orden.
 */
export interface ReviewCatalogs {
  centers: CenterOption[];
  destinations: DestinationOption[];
  stock: StockByCenter;
}

export interface ItemAssignment {
  centerCode: string | null;
  destinationCode: string | null;
}

/** Asignación vigente de cada línea, por guid de la línea. */
export type Assignments = Record<string, ItemAssignment>;

export interface ItemChange {
  item: ReviewItem;
  before: ItemAssignment;
  after: ItemAssignment;
}

export type ItemWarningKind =
  | 'sin-centro'
  | 'sin-destino'
  | 'centro-no-permitido'
  | 'destino-fuera-del-area'
  | 'sin-stock'
  | 'stock-insuficiente';

export interface ItemWarning {
  kind: ItemWarningKind;
  /** `true` impide reenviar; el stock solo avisa, porque SAP lo revalida. */
  blocking: boolean;
  message: string;
}
