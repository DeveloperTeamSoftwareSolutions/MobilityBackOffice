/**
 * Tipos de Centros y Almacenes. Espejo del contrato que publica MobilityMiddleWare en
 * `/api/mobility/warehouse-customers/*`, que es el dueño de las tablas y de la regla.
 * BackOffice no define entidades propias acá: no hay SQL ni tablas de esta sección.
 */

/** Paginación estándar del ecosistema. */
export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Un centro de distribución (agrupa almacenes). */
export interface Center {
  companyCode: string | null;
  centerCode: string | null;
  centerName: string | null;
  /** Cantidad de almacenes del centro (excluye los en tránsito 'R'). */
  warehouseCount: number;
  /** Almacenes del centro reservados a cliente/s o grupo/s (`Availability = 'C'`). */
  restrictedCount: number;
  /**
   * El CENTRO ENTERO está fuera de circulación, para todos.
   *
   * ⚠️ NO es lo mismo que `restrictedCount`: eso cuenta almacenes reservados a clientes
   * puntuales. Esto es el CDI apagado, sin reserva de por medio. Los dos conviven.
   */
  restricted: boolean;
  restrictionReason: string | null;
  restrictedByEmail: string | null;
  restrictedAt: string | null;
}

export interface CentersResult {
  data: Center[];
  pagination: Pagination;
}

/** Un almacén de un centro. */
export interface Warehouse {
  guid: string;
  companyCode: string | null;
  centerCode: string | null;
  centerName: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  warehouseAddress: string | null;
  /** Cantidad de clientes que lo tienen reservado con nombre y apellido. */
  customerCount: number;
  /**
   * Cantidad de grupos de clientes de SAP a los que está reservado (MW ≥ 1.357.0).
   * Un middleware anterior no lo informa: llega como 0, que es lo cierto para él.
   */
  groupCount: number;
  /** Restringido = reservado a ≥1 cliente o ≥1 grupo (`Availability = 'C'`). */
  restricted: boolean;
}

export interface WarehousesResult {
  data: Warehouse[];
  pagination: Pagination;
}

/** Un cliente reservado a un almacén restringido. */
export interface ReservedCustomer {
  customerCode: string | null;
  customerName: string | null;
  guidCustomers: string | null;
}

/**
 * Un grupo de clientes de SAP reservado a un almacén (`GET /groups` del MW).
 *
 * Se guarda el CÓDIGO del grupo, nunca la lista de clientes: un cliente que SAP agregue al
 * grupo queda habilitado sin tocar el almacén. `customerCount` son los clientes del grupo en
 * la sociedad del almacén, calculados al momento de la consulta.
 */
export interface ReservedCustomerGroup {
  guid: string;
  customerGroupCode: string;
  customerGroupName: string | null;
  customerCount: number;
  userId: string | null;
  userEmail: string | null;
  timeStamp: number;
  serverTimestamp: number;
}

/** Una opción del buscador de grupos (`GET /group-search` del MW). */
export interface CustomerGroupOption {
  customerGroupCode: string;
  customerGroupName: string | null;
  /** Clientes del grupo en la sociedad consultada (siempre ≥ 1). */
  customerCount: number;
  /** `false` para el 37 ("Clientes Terceros"): se muestra, pero no se puede reservar. */
  assignable: boolean;
}

/** Un cliente de un grupo en una sociedad (`GET /groups/customers` del MW). */
export interface GroupCustomer {
  customerCode: string | null;
  customerName: string | null;
}

export interface GroupCustomersResult {
  data: GroupCustomer[];
  pagination: Pagination;
}

/** Resultado de reservar un almacén a un grupo (`POST /groups` del MW). */
export interface AddCustomerGroupResult {
  warehouse: {
    guid: string;
    companyCode: string;
    centerCode: string;
    warehouseCode: string;
  };
  customerGroupCode: string;
  customerGroupName: string | null;
  customerCount: number;
  /** Estaba reservado y dado de baja: se reactivó. */
  reactivated: boolean;
  /** Ya estaba reservado y activo: no cambió nada. */
  alreadyExisted: boolean;
}

/** Resultado de quitar la reserva de un grupo (`DELETE /groups` del MW). */
export interface RemoveCustomerGroupResult {
  /** Había una reserva activa y se dio de baja. */
  removed: boolean;
  /** Al almacén le quedan clientes o grupos: sigue restringido. */
  stillRestricted: boolean;
}

/** Clave de un almacén por códigos. */
export interface WarehouseKey {
  companyCode: string;
  centerCode: string;
  warehouseCode: string;
}
