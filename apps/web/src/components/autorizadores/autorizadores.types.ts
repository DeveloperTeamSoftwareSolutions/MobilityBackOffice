/**
 * Tipos de la matriz de autorizadores. Espejo de
 * `apps/api/src/authorizers/authorizers.types.ts`.
 *
 * La matriz es SOLO LECTURA: vive en `[SAPServices].[dbo].[AuthorizerLimits]` +
 * `[AuthorizerProfitCenters]`, replicadas de SAP. Una fila cargada a mano la pisa la
 * próxima sincronización, así que no hay ABM posible desde acá.
 */

/** Motivo por el que la banda no habilita a firmar. */
export type BlockedReason =
  | 'sin_fila'
  | 'sin_datos'
  | 'sin_configurar'
  | 'rango_invertido';

/**
 * Banda de firma ya interpretada por el backend.
 *
 * NUNCA mostrar `minimumPercentage`/`maximumPercentage` crudos: un `0/0` significa
 * "no puede firmar" y un `200/200` significa "sin límite". Pintarlos literal miente.
 */
export interface EffectiveBand {
  min: number | null;
  max: number | null;
  blocked: boolean;
  reason: BlockedReason | 'sin_limite' | null;
}

export interface AuthorizerProfitCenter {
  code: string;
  name: string | null;
  validFrom: string | null;
  validUntil: string | null;
  active: boolean;
}

export interface Authorizer {
  companyCode: string;
  userEmail: string;
  userId: string | null;
  approvalLevel: string | null;
  /** Crudos de SAP. Se muestran solo en el detalle, para poder auditar. */
  minimumPercentage: number | null;
  maximumPercentage: number | null;
  band: EffectiveBand;
  profitCenters: AuthorizerProfitCenter[];
  activeProfitCenterCount: number;
  /**
   * Firma en TODA la sociedad. Sale de una fila con CEBE nulo, que el middleware trata
   * como comodín. Es el alcance MÁXIMO — mostrarlo como "sin CEBE" invierte el sentido.
   */
  coversWholeCompany: boolean;
}

export interface MatrixSummary {
  total: number;
  blocked: number;
  wholeCompany: number;
  withoutActiveProfitCenters: number;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuthorizersPage {
  data: Authorizer[];
  pagination: Pagination;
  summary: MatrixSummary;
}

/**
 * Integrante de un nodo “COUNTRY MANAGER” de la jerarquía comercial.
 *
 * OJO CON EL NOMBRE: el nodo es un PUESTO del organigrama y su equipo cuelga de ahí, así
 * que sus integrantes NO son todos country managers. En QATEST el nodo
 * “COUNTRY MANAGER BAN” tiene dos integrantes con `Role: "Vendedor"`.
 *
 * La app no filtra por rol: muestra el `role` de cada uno y deja la lectura al usuario.
 */
export interface CountryManagerNodeMember {
  name: string | null;
  /** `CommercialTeamMembers.Role`. Texto libre cargado por Duwest. */
  role: string | null;
  sapUserId: string | null;
  email: string | null;
  companyCode: string | null;
  /** `false` = está en el nodo pero pertenece a otra sociedad. Se muestra marcado. */
  inCompany: boolean;
}

export interface CountryManagerNode {
  nodeGuid: string | null;
  nodeName: string | null;
  country: string | null;
  members: CountryManagerNodeMember[];
}

/**
 * Por qué vino vacía la lista. El endpoint devuelve 200 con lista vacía en tres casos
 * distintos y solo uno es un hecho del negocio; los otros dos son problemas de carga.
 */
export type CountryManagersDiagnosis = 'ok' | 'unavailable' | 'sin_nodo' | 'sin_miembros';

export interface CountryManagersResult {
  /** `false` = no se pudo consultar. Distinto de "no hay ninguno". */
  available: boolean;
  diagnosis: CountryManagersDiagnosis;
  nodes: CountryManagerNode[];
}

export interface AvailableCompany {
  code: string;
  name: string | null;
  country: string | null;
}

export type SortableField =
  | 'userEmail'
  | 'userId'
  | 'minimumPercentage'
  | 'maximumPercentage'
  | 'profitCenterCount';

export type MatrixFilter = 'all' | 'blocked' | 'whole-company' | 'inactive-cebes';

export interface MatrixQuery {
  companyCode: string;
  page: number;
  limit: number;
  search: string;
  sortBy: SortableField;
  sortDir: 'ASC' | 'DESC';
  filter: MatrixFilter;
  activeOnly: boolean;
}
