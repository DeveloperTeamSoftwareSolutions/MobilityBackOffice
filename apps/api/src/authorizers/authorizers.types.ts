/**
 * Tipos de la matriz de autorizadores.
 *
 * La matriz es SOLO LECTURA: vive en `[SAPServices].[dbo].[AuthorizerLimits]` +
 * `[AuthorizerProfitCenters]`, replicadas de SAP. BackOffice la consulta a traves del
 * middleware y no la escribe. Ver `docs/SPEC_MATRIZ_AUTORIZADORES.md`.
 */

/** Motivo por el que la banda del autorizador no lo habilita a firmar nada. */
export type BlockedReason =
  /** No tiene fila en la matriz. */
  | 'sin_fila'
  /** Tiene fila pero algun extremo viene nulo o no numerico. */
  | 'sin_datos'
  /** Fila 0/0: la matriz esta sin configurar para el. */
  | 'sin_configurar'
  /** Min > Max con ambos extremos reales: el dato esta roto. */
  | 'rango_invertido';

/** Banda de firma efectiva, ya interpretada (centinelas resueltos). */
export interface EffectiveBand {
  /** Piso de descuento que puede firmar. `null` = sin piso. */
  min: number | null;
  /** Techo de descuento que puede firmar. `null` = sin techo. */
  max: number | null;
  /** `true` = la matriz no lo habilita a firmar nada (solo puede rechazar). */
  blocked: boolean;
  /** Por que esta bloqueado, o `'sin_limite'` cuando firma todo. `null` = banda normal. */
  reason: BlockedReason | 'sin_limite' | null;
}

/** Fila cruda del middleware: 1 por (sociedad, autorizador, CEBE). */
export interface AuthorizerRow {
  companyCode: string;
  authorizerLimitGuid: string | null;
  userEmail: string;
  userId: string | null;
  minimumPercentage: number | null;
  maximumPercentage: number | null;
  approvalLevel: string | null;
  profitCenter: string | null;
  validFrom: string | null;
  validUntil: string | null;
}

/** Un CEBE asignado a un autorizador, con su vigencia. */
export interface AuthorizerProfitCenter {
  code: string;
  /** Nombre del maestro de CEBEs. `null` si el codigo no esta en el catalogo. */
  name: string | null;
  validFrom: string | null;
  validUntil: string | null;
  /** `false` si hoy queda fuera de [validFrom, validUntil]. */
  active: boolean;
}

/**
 * Un autorizador, con sus CEBEs agrupados.
 *
 * Es el grano de la UI y NO el de la fuente: el middleware devuelve una fila por
 * (autorizador x CEBE), asi que un gerente con 12 CEBEs llega como 12 filas. Se agrupa
 * aca para que la pantalla responda "quien esta en la matriz", que es la pregunta de la
 * tarea, y para que la paginacion no parta a un gerente entre dos paginas.
 */
export interface Authorizer {
  companyCode: string;
  userEmail: string;
  userId: string | null;
  approvalLevel: string | null;
  /** Valores crudos de SAP, sin interpretar. Se exponen para poder auditarlos. */
  minimumPercentage: number | null;
  maximumPercentage: number | null;
  /** La lectura de negocio de esos crudos. Es lo que la UI debe mostrar. */
  band: EffectiveBand;
  profitCenters: AuthorizerProfitCenter[];
  /** CEBEs vigentes hoy. Puede ser 0 aun con `profitCenters` no vacio. */
  activeProfitCenterCount: number;
  /**
   * Alcance sin restriccion de CEBE: firma en TODA la sociedad.
   *
   * Sale de una fila con `ProfitCenter` NULL. NO es "sin CEBE asignado" — es lo
   * contrario: el middleware la trata como comodin
   * (`AND (ProfitCenter = @Pc OR ProfitCenter IS NULL)`, ver
   * `businessOrderAuthorizations.repository.js`). Es la fila de MAYOR alcance, y
   * pintarla como vacia invierte el significado.
   */
  coversWholeCompany: boolean;
}

/** Resumen de la sociedad: lo que hay que mirar antes de leer la tabla. */
export interface MatrixSummary {
  total: number;
  /** Autorizadores que no pueden firmar nada por como esta cargada su banda. */
  blocked: number;
  /** Autorizadores que firman en toda la sociedad (fila con CEBE NULL). */
  wholeCompany: number;
  /**
   * Autorizadores cuyos CEBEs estan TODOS vencidos o aun no vigentes.
   *
   * Estan en la matriz y su banda puede estar bien, pero hoy no alcanzan ningun CEBE.
   * Los de `wholeCompany` no cuentan aca: no dependen de una asignacion.
   */
  withoutActiveProfitCenters: number;
}

/**
 * Integrante de un nodo `COUNTRY MANAGER%` de la jerarquia comercial.
 *
 * OJO CON EL NOMBRE. El nodo es un PUESTO del organigrama, no una persona: sus
 * integrantes son el equipo que cuelga de ahi. En QATEST el nodo
 * "COUNTRY MANAGER BAN" tiene tres integrantes y DOS son `Role: "Vendedor"` — reportan
 * al country manager, no lo son.
 *
 * Por eso el tipo NO se llama `CountryManager`: la lista son los integrantes del nodo,
 * y quien ocupa realmente el puesto se distingue por su `role`. Duwest no publica un
 * flag que lo diga, asi que la app **no filtra ni adivina**: muestra el rol de cada uno
 * y deja la lectura al usuario.
 *
 * El permiso importa igual: autorizar "otra forma de pago" no pasa por
 * `AuthorizerLimits` sino por el country manager, asi que hay gente que autoriza sin
 * una sola fila en la matriz.
 */
export interface CountryManagerNodeMember {
  name: string | null;
  /** `CommercialTeamMembers.Role`. Texto libre cargado por Duwest. */
  role: string | null;
  sapUserId: string | null;
  /** Solo lo trae el endpoint filtrado por sociedad, que es el que joinea a `Users`. */
  email: string | null;
  /** `Users.SapCompanyCode`. `null` cuando la persona no vino por ese filtro. */
  companyCode: string | null;
  /**
   * `true` = su `Users.SapCompanyCode` es la sociedad consultada.
   *
   * `false` = esta en el mismo nodo pero pertenece a OTRA sociedad. Se muestra igual,
   * porque si no el gerente del nodo queda invisible en la sociedad de su propio
   * equipo: en QATEST el de "COUNTRY MANAGER BAN" figura bajo la 2200 mientras sus
   * vendedores estan en la 2100.
   */
  inCompany: boolean;
}

/** Un nodo `COUNTRY MANAGER%` con sus integrantes. */
export interface CountryManagerNode {
  nodeGuid: string | null;
  nodeName: string | null;
  country: string | null;
  members: CountryManagerNodeMember[];
}

/**
 * Por que la lista de Country Managers vino vacia.
 *
 * Importa distinguirlos: el endpoint devuelve 200 con lista vacia en los tres casos,
 * pero solo UNO significa que la sociedad realmente no tiene a nadie. Los otros dos son
 * problemas de carga que la pantalla no debe presentar como un hecho del negocio.
 */
export type CountryManagersDiagnosis =
  /** Hay resultados: no hay nada que diagnosticar. */
  | 'ok'
  /** No se pudo consultar el middleware. */
  | 'unavailable'
  /**
   * No existe ningun nodo `COUNTRY MANAGER%` en la jerarquia comercial. La consulta los
   * identifica por el NOMBRE del nodo, asi que un renombre los esconde a todos.
   */
  | 'sin_nodo'
  /**
   * Existe el nodo, pero ninguno de sus integrantes resuelve a esta sociedad. O la
   * sociedad no tiene CM asignado, o al integrante le falta la fila en `Users` /
   * `SapCompanyCode` (la consulta usa INNER JOIN).
   */
  | 'sin_miembros'

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Resultado del panel de Country Managers. */
export interface CountryManagersResult {
  available: boolean;
  diagnosis: CountryManagersDiagnosis;
  nodes: CountryManagerNode[];
}

export interface AuthorizersPage {
  data: Authorizer[];
  pagination: Pagination;
  summary: MatrixSummary;
}

/** Campos por los que se puede ordenar. Whitelist: nada mas entra al sort. */
/**
 * Campos ordenables.
 *
 * `approvalLevel` NO esta: viene vacio en todas las filas relevadas en QATEST
 * (2026-08-27), asi que ordenar por el no hace nada. Se sigue exponiendo en el DTO
 * por si SAP empieza a cargarlo.
 */
export const SORTABLE_FIELDS = [
  'userEmail',
  'userId',
  'minimumPercentage',
  'maximumPercentage',
  'profitCenterCount',
] as const;

export type SortableField = (typeof SORTABLE_FIELDS)[number];

export function isSortableField(value: string): value is SortableField {
  return (SORTABLE_FIELDS as readonly string[]).includes(value);
}

/** Filtros de la tabla. `whole-company` = los que firman sin restriccion de CEBE. */
export const MATRIX_FILTERS = [
  'all',
  'blocked',
  'whole-company',
  'inactive-cebes',
] as const;
export type MatrixFilter = (typeof MATRIX_FILTERS)[number];

export function isMatrixFilter(value: string): value is MatrixFilter {
  return (MATRIX_FILTERS as readonly string[]).includes(value);
}

export interface MatrixQuery {
  companyCode: string;
  page: number;
  limit: number;
  search: string;
  sortBy: SortableField;
  sortDir: 'ASC' | 'DESC';
  filter: MatrixFilter;
  /** Solo asignaciones de CEBE vigentes (se lo pasa al middleware). */
  activeOnly: boolean;
}
