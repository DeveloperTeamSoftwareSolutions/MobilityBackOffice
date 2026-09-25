import axios from 'axios';
import { httpClient } from '../../api/httpClient';
import {
  AssignOwnerInput,
  CreateMemberInput,
  CustomerGap,
  CustomerGapsPage,
  CustomerGapsQuery,
  Finding,
  FindingsPage,
  FindingsQuery,
  FixSapUserIdInput,
  GapCounts,
  GapType,
  HierarchyNode,
  NodesResult,
  Pagination,
  RemoveMemberInput,
  Summary,
} from './consistencia.types';

interface ApiData<T> {
  success: boolean;
  data: T;
}

/** Tope del modo exportación que acepta el servidor. */
export const EXPORT_LIMIT = 50000;

type Params = Record<string, string | number>;

/**
 * Parámetros del listado de hallazgos. Lo vacío no viaja: un `group=` en blanco no es
 * lo mismo que no filtrar y el servidor lo rechazaría.
 */
export function findingsParams(q: FindingsQuery): Params {
  const params: Params = {
    category: q.category,
    page: q.exportAll ? 1 : q.page,
    limit: q.exportAll ? EXPORT_LIMIT : q.limit,
    sortBy: q.sortBy,
    sortDir: q.sortDir,
  };
  if (q.group) params.group = q.group;
  if (q.resolution) params.resolution = q.resolution;
  if (q.companyCode) params.companyCode = q.companyCode;
  const search = q.search?.trim();
  if (search) params.search = search;
  if (q.exportAll) params.export = 1;
  if (q.refresh) params.refresh = 1;
  return params;
}

/** Parámetros del listado de clientes vs SAP. */
export function customerGapsParams(q: CustomerGapsQuery): Params {
  const params: Params = {
    page: q.exportAll ? 1 : q.page,
    limit: q.exportAll ? EXPORT_LIMIT : q.limit,
    sortDir: 'ASC',
  };
  if (q.gapType) params.gapType = q.gapType;
  if (q.companyCode) params.companyCode = q.companyCode;
  const search = q.search?.trim();
  if (search) params.search = search;
  if (q.exportAll) params.export = 1;
  return params;
}

/** Resumen por categoría y por grupo. `refresh` recalcula en vez de leer lo último. */
export async function getSummary(refresh = false): Promise<Summary> {
  const res = await httpClient.get<ApiData<Summary>>('/api/consistency/summary', {
    params: refresh ? { refresh: 1 } : undefined,
  });
  return res.data.data;
}

/** Hallazgos paginados de una categoría. */
export async function listFindings(q: FindingsQuery): Promise<FindingsPage> {
  const res = await httpClient.get<
    ApiData<Finding[]> & { companies?: string[]; generatedAt: number; pagination: Pagination }
  >('/api/consistency/findings', { params: findingsParams(q) });
  return {
    data: res.data.data,
    companies: res.data.companies ?? [],
    generatedAt: res.data.generatedAt,
    pagination: res.data.pagination,
  };
}

/** Nodos de la jerarquía comercial y los roles con que se puede dar de alta un miembro. */
export async function listNodes(): Promise<NodesResult> {
  const res = await httpClient.get<ApiData<HierarchyNode[]> & { roles?: string[] }>(
    '/api/consistency/nodes',
  );
  return { nodes: res.data.data, roles: res.data.roles ?? [] };
}

const EMPTY_PAGINATION: Pagination = { total: 0, page: 1, limit: 0, totalPages: 0 };

/** Clientes de cartera vs asignación de SAP. `available: false` no es un error. */
export async function listCustomerGaps(q: CustomerGapsQuery): Promise<CustomerGapsPage> {
  const res = await httpClient.get<{
    success: boolean;
    available?: boolean;
    data?: CustomerGap[];
    summary?: Partial<Record<GapType, GapCounts>>;
    pagination?: Pagination;
  }>('/api/consistency/customer-gaps', { params: customerGapsParams(q) });
  if (res.data.available === false) {
    return { available: false, data: [], summary: {}, pagination: EMPTY_PAGINATION };
  }
  return {
    available: true,
    data: res.data.data ?? [],
    summary: res.data.summary ?? {},
    pagination: res.data.pagination ?? EMPTY_PAGINATION,
  };
}

// ---- Correcciones ---------------------------------------------------------

/** Alta de un miembro en un nodo de la jerarquía comercial. */
export async function createMember(input: CreateMemberInput): Promise<unknown> {
  const res = await httpClient.post<ApiData<unknown>>('/api/consistency/members', input);
  return res.data.data;
}

/** Corrige el usuario SAP de un miembro, con control de concurrencia por valor esperado. */
export async function fixMemberSapUserId(
  guid: string,
  input: FixSapUserIdInput,
): Promise<unknown> {
  const res = await httpClient.put<ApiData<unknown>>(
    `/api/consistency/members/${encodeURIComponent(guid)}/sap-user-id`,
    input,
  );
  return res.data.data;
}

/** Baja lógica de un miembro de la jerarquía. */
export async function removeMember(guid: string, input: RemoveMemberInput): Promise<unknown> {
  const res = await httpClient.post<ApiData<unknown>>(
    `/api/consistency/members/${encodeURIComponent(guid)}/remove`,
    input,
  );
  return res.data.data;
}

/** Asigna el dueño de una cartera. */
export async function assignPortfolioOwner(
  guid: string,
  input: AssignOwnerInput,
): Promise<unknown> {
  const res = await httpClient.post<ApiData<unknown>>(
    `/api/consistency/portfolios/${encodeURIComponent(guid)}/owner`,
    input,
  );
  return res.data.data;
}

// ---- Errores --------------------------------------------------------------

/** `true` si el dato cambió mientras tanto o ya existía (409). */
export function isConflict(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 409;
}

/**
 * Mensaje legible de un fallo de la API. El servidor responde en castellano con
 * `message` (texto o lista, al estilo NestJS) o `error`; si no trae nada, se usa el
 * genérico de cada pantalla.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status === 403) return 'Tu rol no tiene acceso a la consistencia de datos.';
    const body = err.response?.data as { message?: unknown; error?: unknown } | undefined;
    const message = body?.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (Array.isArray(message)) {
      const parts = message.filter((m): m is string => typeof m === 'string' && m.trim() !== '');
      if (parts.length > 0) return parts.join(' · ');
    }
    if (typeof body?.error === 'string' && body.error.trim()) return body.error;
    if (status === 409) {
      return 'Alguien modificó este dato mientras tanto. Recargá para ver el estado actual.';
    }
    if (status === 503) return 'El servicio no está disponible. Reintentá en unos minutos.';
  }
  return fallback;
}
