import axios from 'axios';
import { httpClient } from '../../api/httpClient';
import {
  Pagination,
  ReviewCatalogs,
  ReviewItem,
  ReviewOrderDetail,
  ReviewQueueEntry,
  SortDir,
  SortField,
} from './revision-sap.types';

interface ApiData<T> {
  success: boolean;
  data: T;
}

interface ApiPaged<T> {
  success: boolean;
  data: T[];
  pagination: Pagination;
}

export interface QueueParams {
  page: number;
  limit: number;
  search: string;
  sortBy: SortField;
  sortDir: SortDir;
}

/** Bandeja de órdenes rechazadas por SAP. Búsqueda, orden y paginación en el servidor. */
export async function listReviewQueue(
  params: QueueParams,
): Promise<{ data: ReviewQueueEntry[]; pagination: Pagination }> {
  const res = await httpClient.get<ApiPaged<ReviewQueueEntry>>('/api/revision-sap/orders', {
    params: { ...params, search: params.search || undefined },
  });
  return { data: res.data.data, pagination: res.data.pagination };
}

export async function getReviewOrder(guid: string): Promise<ReviewOrderDetail> {
  const res = await httpClient.get<ApiData<ReviewOrderDetail>>(
    `/api/revision-sap/orders/${encodeURIComponent(guid)}`,
  );
  return res.data.data;
}

/**
 * Centros permitidos, destinos del área y, con `includeStock`, el stock de SAP. El
 * stock puede tardar: la pantalla pide primero sin stock y después con stock.
 */
export async function getReviewCatalogs(
  guid: string,
  includeStock: boolean,
): Promise<ReviewCatalogs> {
  const res = await httpClient.get<ApiData<ReviewCatalogs>>(
    `/api/revision-sap/orders/${encodeURIComponent(guid)}/options`,
    { params: { includeStock: includeStock ? 1 : 0 } },
  );
  return res.data.data;
}

/** Guarda el destino de una línea. El servidor valida que sea del área de la orden. */
export async function changeItemDestination(
  guid: string,
  itemGuid: string,
  destinationCode: string,
): Promise<ReviewItem> {
  const res = await httpClient.put<ApiData<{ item: ReviewItem }>>(
    `/api/revision-sap/orders/${encodeURIComponent(guid)}/items/${encodeURIComponent(itemGuid)}/destination`,
    { destinationCode },
  );
  return res.data.data.item;
}

/** Mensaje legible de un fallo de la API, para mostrarlo tal cual. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status === 403) return 'Tu rol no tiene acceso a las órdenes rechazadas por SAP.';
    const message = (err.response?.data as { message?: unknown } | undefined)?.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (status === 503) return 'El middleware no está disponible. Reintentá en unos minutos.';
  }
  return fallback;
}
