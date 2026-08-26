import { httpClient } from '../../api/httpClient';
import {
  DocumentTimeline,
  DocumentType,
  Paged,
  Pagination,
  SortDir,
  SortField,
  StatusCount,
  SupportDocument,
  DocumentItems,
  DecisionResult,
  ItemDecision,
  ItemResponse,
  PaymentDecision,
  PaymentResponse,
  RecomputeResult,
  ProjectedStatus,
  InconsistentReport,
  DocumentActions,
  ActionResult,
} from './soporte.types';

interface ApiData<T> {
  success: boolean;
  data: T;
}

/**
 * Bitácora completa de un documento por su número exacto.
 *
 * No hay búsqueda por texto libre: el middleware no expone ningún listado de
 * documentos que no esté scopeado por vendedor o cliente, así que la consola trabaja
 * con el número con el que llega el ticket. Ver docs/SPEC_CONSOLA_SOPORTE.md §6.
 */
export async function getTimeline(
  type: DocumentType,
  documentNumber: string,
  includeViews = false,
  includeMessages = false,
): Promise<DocumentTimeline> {
  const res = await httpClient.get<ApiData<DocumentTimeline>>(
    `/api/support/documents/${type}/${encodeURIComponent(documentNumber)}/timeline`,
    {
      params: {
        includeViews: includeViews ? 1 : undefined,
        includeMessages: includeMessages ? 1 : undefined,
      },
    },
  );
  return res.data.data;
}

interface ApiPaged<T> {
  success: boolean;
  data: T[];
  pagination: Pagination;
}

/** Listado paginado de documentos (sin scope de vendedor). */
export async function listDocuments(params: {
  type: DocumentType;
  page: number;
  limit: number;
  search: string;
  status: string;
  sortBy: SortField;
  sortDir: SortDir;
}): Promise<Paged<SupportDocument>> {
  const res = await httpClient.get<ApiPaged<SupportDocument>>(
    '/api/support/documents',
    {
      params: {
        type: params.type,
        page: params.page,
        limit: params.limit,
        search: params.search || undefined,
        status: params.status || undefined,
        sortBy: params.sortBy,
        sortDir: params.sortDir,
      },
    },
  );
  return { data: res.data.data, pagination: res.data.pagination };
}

/** Estados existentes en los datos, para poblar el filtro. */
export async function listStatuses(type: DocumentType): Promise<StatusCount[]> {
  const res = await httpClient.get<ApiData<StatusCount[]>>(
    '/api/support/statuses',
    { params: { type } },
  );
  return res.data.data;
}

/** Líneas del documento, el plazo de pago y el turno del gerente. */
export async function listItems(
  type: DocumentType,
  guid: string,
): Promise<DocumentItems> {
  const res = await httpClient.get<ApiData<DocumentItems>>(
    `/api/support/documents/${type}/${encodeURIComponent(guid)}/items`,
  );
  return res.data.data;
}

/** Ruta base de una línea. La línea se identifica por código de producto. */
function itemPath(type: DocumentType, guid: string, productCode: string): string {
  return `/api/support/documents/${type}/${encodeURIComponent(guid)}/items/${encodeURIComponent(productCode)}`;
}

function paymentPath(type: DocumentType, guid: string): string {
  return `/api/support/documents/${type}/${encodeURIComponent(guid)}/payment-terms`;
}

/**
 * Decisión del gerente sobre una línea, ejecutada por soporte a su pedido.
 *
 * `proposedPrice` es el precio UNITARIO de la contraoferta, no una edición de la
 * línea: la cantidad y el descuento no se tocan nunca desde acá.
 */
export async function decideItem(
  type: DocumentType,
  guid: string,
  productCode: string,
  status: ItemDecision,
  reasonNotes: string,
  proposedPrice?: number | null,
): Promise<DecisionResult> {
  const res = await httpClient.post<ApiData<DecisionResult>>(
    `${itemPath(type, guid, productCode)}/decide`,
    { status, proposedPrice: proposedPrice ?? null, reasonNotes },
  );
  return res.data.data;
}

/** Respuesta del vendedor a una contraoferta de línea. La ronda es una sola. */
export async function respondItem(
  type: DocumentType,
  guid: string,
  productCode: string,
  action: ItemResponse,
  reasonNotes: string,
): Promise<DecisionResult> {
  const res = await httpClient.post<ApiData<DecisionResult>>(
    `${itemPath(type, guid, productCode)}/respond`,
    { action, reasonNotes },
  );
  return res.data.data;
}

/**
 * Decisión del gerente sobre el plazo de pago pedido en la cabecera.
 *
 * `observed` ES la contraoferta y `value` el plazo que se contrapropone.
 */
export async function decidePaymentTerms(
  type: DocumentType,
  guid: string,
  status: PaymentDecision,
  reasonNotes: string,
  value?: string | null,
): Promise<DecisionResult> {
  const res = await httpClient.post<ApiData<DecisionResult>>(
    `${paymentPath(type, guid)}/decide`,
    { status, value: value ?? null, reasonNotes },
  );
  return res.data.data;
}

/** Respuesta del vendedor a la contraoferta de plazo de pago. */
export async function respondPaymentTerms(
  type: DocumentType,
  guid: string,
  action: PaymentResponse,
  reasonNotes: string,
): Promise<DecisionResult> {
  const res = await httpClient.post<ApiData<DecisionResult>>(
    `${paymentPath(type, guid)}/respond`,
    { action, reasonNotes },
  );
  return res.data.data;
}

/** Recalcula el estado del documento a partir de los hechos. */
export async function recompute(
  type: DocumentType,
  guid: string,
): Promise<RecomputeResult> {
  const res = await httpClient.post<ApiData<RecomputeResult>>(
    `/api/support/documents/${type}/${encodeURIComponent(guid)}/recompute`,
    {},
  );
  return res.data.data;
}

/** Qué estado daría el recálculo hoy. No cambia nada. */
export async function getProjectedStatus(
  type: DocumentType,
  guid: string,
): Promise<ProjectedStatus> {
  const res = await httpClient.get<ApiData<ProjectedStatus>>(
    `/api/support/documents/${type}/${encodeURIComponent(guid)}/projected-status`,
  );
  return res.data.data;
}

/** Documentos cuyo estado guardado no coincide con el calculado. */
export async function listInconsistent(
  type: DocumentType,
  limit = 500,
): Promise<InconsistentReport> {
  const res = await httpClient.get<InconsistentReport & { success: boolean }>(
    '/api/support/diagnostics/inconsistent',
    { params: { type, limit } },
  );
  return {
    data: res.data.data,
    scanned: res.data.scanned,
    total: res.data.total,
    truncated: res.data.truncated,
  };
}

/** Acciones con intención disponibles para el documento. */
export async function listActions(
  type: DocumentType,
  guid: string,
): Promise<DocumentActions> {
  const res = await httpClient.get<ApiData<DocumentActions>>(
    `/api/support/documents/${type}/${encodeURIComponent(guid)}/actions`,
  );
  return res.data.data;
}

/** Ejecuta una acción con intención. Escribe hechos; el estado lo calcula el sistema. */
export async function runAction(
  type: DocumentType,
  guid: string,
  action: string,
  reasonNotes: string,
  /** Estado destino de una vuelta atrás. Las demás acciones no lo llevan. */
  target?: string | null,
): Promise<ActionResult> {
  const res = await httpClient.post<ApiData<ActionResult>>(
    `/api/support/documents/${type}/${encodeURIComponent(guid)}/actions/${encodeURIComponent(action)}`,
    { reasonNotes, target },
  );
  return res.data.data;
}
