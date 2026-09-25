/**
 * Contrato de la seccion "Consistencia de datos".
 *
 * Refleja lo que devuelve MobilityMiddleWare en `/mobility/backoffice-consistency`
 * (docs/API_BACKOFFICE_CONSISTENCY.md del middleware) y en `/v2/mobility/portfolio-gaps`.
 * BackOffice no recalcula nada: la regla vive en un solo lugar, el middleware.
 */

export type Category = 'JERARQUIA' | 'CARTERA' | 'USUARIOS_SAP';
export type Resolution = 'BACKOFFICE' | 'ITMANAGER' | 'REVISAR';
export type Severity = 'alta' | 'media' | 'baja';
export type FindingAction =
  | 'ALTA_MIEMBRO'
  | 'CORREGIR_SAPUSERID'
  | 'BAJA_MIEMBRO'
  | 'ASIGNAR_DUENO';

export const GROUP_KEYS = [
  'CARTERA_SIN_JERARQUIA',
  'IDENTIDAD_MAL_APAREADA',
  'ROL_SIN_CARTERA_NI_JERARQUIA',
  'ROL_SIN_SAPUSERID',
  'MIEMBRO_SIN_SAPUSERID',
  'VENDEDOR_SIN_CARTERA',
  'SAPUSERID_REPETIDO',
  'CARTERA_SIN_DUENO',
  'DUENO_DESALINEADO',
  'COMERCIAL_SIN_CUENTA_SAP_ACTIVA',
  'USUARIO_SIN_CUENTA_SAP_ACTIVA',
  'EMAIL_DISTINTO_A_SAP',
] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export const CATEGORIES: readonly Category[] = ['JERARQUIA', 'CARTERA', 'USUARIOS_SAP'];
export const RESOLUTIONS: readonly Resolution[] = ['BACKOFFICE', 'ITMANAGER', 'REVISAR'];
export const FINDING_SORTS = ['severity', 'companyCode', 'personName', 'sapUserId', 'group'] as const;
export type FindingSort = (typeof FINDING_SORTS)[number];

export const GAP_TYPES = [
  'CLIENTE_NO_SINCRONIZADO',
  'VE_SIN_CARTERA',
  'SIN_AREA_DE_VENTA',
  'CARTERA_SIN_VE',
] as const;
export type GapType = (typeof GAP_TYPES)[number];

export interface GroupSummary {
  group: GroupKey;
  label: string;
  hint: string;
  category: Category;
  severity: Severity;
  resolution: Resolution;
  count: number;
}

export interface ConsistencySummary {
  generatedAt: number;
  total: number;
  sapAccountsAvailable: boolean;
  categories: Record<Category, number>;
  groups: GroupSummary[];
}

export interface FindingMember {
  guid: string;
  sapUserId: string | null;
  memberName: string | null;
  role: string | null;
  guidNode: string | null;
  nodeName: string | null;
  nodeCountry: string | null;
}

export interface FindingPortfolio {
  guid: string;
  name: string | null;
  companyCode: string | null;
  ownerRole: string | null;
  customers: number | null;
}

export interface SapAccount {
  userId: string;
  userName: string | null;
  email: string | null;
  companyCode: string | null;
  position: string | null;
  employeeStatus: string | null;
}

export interface Finding {
  key: string;
  group: GroupKey;
  category: Category;
  severity: Severity;
  resolution: Resolution;
  label: string;
  companyCode: string | null;
  sapUserId: string | null;
  personName: string | null;
  email: string | null;
  guidUsers: string | null;
  roles: string[];
  members: FindingMember[];
  portfolios: FindingPortfolio[];
  sapAccount: SapAccount | null;
  suggestion: { sapUserId: string; source: string } | null;
  detail: string | null;
  actions: FindingAction[];
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FindingsQuery {
  group?: GroupKey;
  category?: Category;
  resolution?: Resolution;
  companyCode?: string;
  search?: string;
  page: number;
  limit: number;
  sortBy: FindingSort;
  sortDir: 'ASC' | 'DESC';
  exportAll: boolean;
  refresh: boolean;
}

export interface FindingsPage {
  data: Finding[];
  companies: string[];
  generatedAt: number;
  pagination: Pagination;
}

export interface HierarchyNode {
  guid: string;
  guidParent: string | null;
  name: string | null;
  country: string | null;
  businessUnit: string | null;
  region: string | null;
}

export interface NodesResult {
  data: HierarchyNode[];
  roles: string[];
}

export interface CustomerGap {
  guidUsers: string | null;
  userEmail: string | null;
  userName: string | null;
  sapUserId: string | null;
  customerCode: string | null;
  customerName: string | null;
  companyCode: string | null;
  companyName: string | null;
  gapType: GapType;
  guidPortfolios: string | null;
  portfolioName: string | null;
  partnerUserId: string | null;
}

export interface GapCounts {
  rows: number;
  customers: number;
  sellers: number;
}

export interface CustomerGapsQuery {
  gapType?: GapType;
  companyCode?: string;
  search?: string;
  page: number;
  limit: number;
  sortBy?: string;
  sortDir: 'ASC' | 'DESC';
  exportAll: boolean;
}

/**
 * `available: false` = el middleware de este ambiente todavia no expone las brechas
 * cartera vs SAP. No es un error: la pestaña lo dice y sigue.
 */
export interface CustomerGapsPage {
  available: boolean;
  data: CustomerGap[];
  summary: Partial<Record<GapType, GapCounts>>;
  pagination: Pagination;
}

// ---- Correcciones ---------------------------------------------------------

/** Lo comun a toda correccion: quien, por que y que hallazgo la motivo. */
export interface WriteContext {
  actorEmail: string;
  reason: string;
  findingGroup: GroupKey | null;
}

export interface CreateMemberInput {
  guidCommercialTeamHierarchies: string;
  memberSapUserId: string;
  memberName: string;
  role: string;
  memberGuidUsers: string | null;
}

export interface ChangeSapUserIdInput {
  guid: string;
  memberSapUserId: string;
  expectedSapUserId: string | null;
}

export interface AssignOwnerInput {
  guidPortfolio: string;
  ownerSapUserId: string;
  ownerName: string;
  ownerGuidUsers: string | null;
  ownerEmail: string | null;
}

/** Lo que devuelve el middleware tras la correccion; se pasa tal cual al front. */
export type WriteResult = Record<string, unknown>;
