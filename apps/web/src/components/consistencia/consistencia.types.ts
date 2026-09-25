/**
 * Espejo de los tipos que devuelve la API de consistencia de datos comerciales
 * (apps/api/src/consistency/consistency.types.ts).
 */

export type Category = 'JERARQUIA' | 'CARTERA' | 'USUARIOS_SAP';
export type Resolution = 'BACKOFFICE' | 'ITMANAGER' | 'REVISAR';
export type Severity = 'alta' | 'media' | 'baja';
export type FindingAction =
  | 'ALTA_MIEMBRO'
  | 'CORREGIR_SAPUSERID'
  | 'BAJA_MIEMBRO'
  | 'ASIGNAR_DUENO';

export type GroupKey =
  | 'CARTERA_SIN_JERARQUIA'
  | 'IDENTIDAD_MAL_APAREADA'
  | 'ROL_SIN_CARTERA_NI_JERARQUIA'
  | 'ROL_SIN_SAPUSERID'
  | 'MIEMBRO_SIN_SAPUSERID'
  | 'VENDEDOR_SIN_CARTERA'
  | 'SAPUSERID_REPETIDO'
  | 'CARTERA_SIN_DUENO'
  | 'DUENO_DESALINEADO'
  | 'COMERCIAL_SIN_CUENTA_SAP_ACTIVA'
  | 'USUARIO_SIN_CUENTA_SAP_ACTIVA'
  | 'EMAIL_DISTINTO_A_SAP';

export interface GroupSummary {
  group: GroupKey;
  label: string;
  hint: string;
  category: Category;
  severity: Severity;
  resolution: Resolution;
  count: number;
}

export interface Summary {
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

export type SortDir = 'ASC' | 'DESC';
export type FindingSortField =
  | 'severity'
  | 'companyCode'
  | 'personName'
  | 'sapUserId'
  | 'group';

export interface FindingsQuery {
  category: Category;
  group?: GroupKey | null;
  resolution?: Resolution | null;
  companyCode?: string | null;
  search?: string;
  page: number;
  limit: number;
  sortBy: FindingSortField;
  sortDir: SortDir;
  exportAll?: boolean;
  refresh?: boolean;
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
  nodes: HierarchyNode[];
  roles: string[];
}

export type GapType =
  | 'CLIENTE_NO_SINCRONIZADO'
  | 'VE_SIN_CARTERA'
  | 'SIN_AREA_DE_VENTA'
  | 'CARTERA_SIN_VE';

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
  gapType?: GapType | null;
  companyCode?: string | null;
  search?: string;
  page: number;
  limit: number;
  exportAll?: boolean;
}

export interface CustomerGapsPage {
  /** `false` = la capacidad todavía no está desplegada en este ambiente. No es un error. */
  available: boolean;
  data: CustomerGap[];
  summary: Partial<Record<GapType, GapCounts>>;
  pagination: Pagination;
}

// ---- Correcciones ---------------------------------------------------------

/** Lo común a toda corrección. El autor lo toma el servidor de la sesión. */
interface WriteBase {
  reason: string;
  findingGroup?: GroupKey;
}

export interface CreateMemberInput extends WriteBase {
  guidCommercialTeamHierarchies: string;
  memberSapUserId: string;
  memberName: string;
  role: string;
  memberGuidUsers?: string;
}

export interface FixSapUserIdInput extends WriteBase {
  memberSapUserId: string;
  /** El valor que se vio al listar: si cambió mientras tanto, el servidor responde 409. */
  expectedSapUserId: string | null;
}

export type RemoveMemberInput = WriteBase;

export interface AssignOwnerInput extends WriteBase {
  ownerSapUserId: string;
  ownerName: string;
  ownerGuidUsers?: string;
  ownerEmail?: string;
}
