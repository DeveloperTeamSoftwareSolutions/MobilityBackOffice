/**
 * Tipos de la sección Centros y Almacenes. Espeja el contrato de
 * `apps/api/src/warehouses/warehouses.types.ts`, que a su vez espeja al MobilityMiddleWare,
 * dueño de las tablas y de la regla. Acá no se define ninguna entidad propia.
 */

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

/** Un centro de distribución (agrupa almacenes). */
export interface Center {
  companyCode: string | null;
  centerCode: string | null;
  centerName: string | null;
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

/** Un almacén de un centro. */
export interface Warehouse {
  guid: string;
  companyCode: string | null;
  centerCode: string | null;
  centerName: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  warehouseAddress: string | null;
  /** Clientes que lo tienen reservado con nombre y apellido. */
  customerCount: number;
  /**
   * Grupos de clientes de SAP a los que está reservado (MW ≥ 1.357.0).
   * Un middleware anterior no lo informa: llega como 0, que es lo cierto para él.
   */
  groupCount: number;
  /** Reservado a ≥1 cliente o ≥1 grupo. */
  restricted: boolean;
}

/** Un cliente reservado a un almacén restringido. */
export interface ReservedCustomer {
  customerCode: string | null;
  customerName: string | null;
  guidCustomers: string | null;
}

/**
 * Un grupo de clientes de SAP reservado a un almacén.
 *
 * Se guarda el CÓDIGO del grupo, nunca la lista de clientes: si SAP suma una empresa al
 * grupo, queda habilitada sin tocar el almacén. `customerCount` son los clientes del grupo
 * en la sociedad del almacén, calculados al momento de la consulta.
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

/** Opción del buscador de grupos. El 37 llega con `assignable: false`. */
export interface CustomerGroupOption {
  customerGroupCode: string;
  customerGroupName: string | null;
  /** Clientes del grupo en la sociedad consultada (siempre ≥ 1). */
  customerCount: number;
  /** `false` para el 37 ("Clientes Terceros"): se muestra, pero no se puede reservar. */
  assignable: boolean;
}

/** Un cliente de un grupo (lista desplegable de la fila del grupo). */
export interface GroupCustomer {
  customerCode: string | null;
  customerName: string | null;
}

/** Resultado de quitar la reserva de un grupo. */
export interface RemoveCustomerGroupResult {
  /** Había una reserva activa y se dio de baja. */
  removed: boolean;
  /** Al almacén le quedan clientes o grupos: sigue restringido. */
  stillRestricted: boolean;
}

/**
 * Columnas por las que se puede ordenar la lista de centros.
 *
 * Espejo de `CENTER_SORT_FIELDS` en `apps/api/src/warehouses/warehouses.service.ts` y de
 * `CENTER_SORTS` en el middleware. Si acá aparece una que allá no está, el click no ordena
 * nada y cae al default **en silencio** — por eso lo cuida `center-sorts.spec.ts` de la API.
 */
export type CenterSortField =
  | 'companyCode'
  | 'centerCode'
  | 'centerName'
  | 'warehouseCount'
  | 'restrictedCount'
  | 'restricted';

export type SortDir = 'ASC' | 'DESC';
