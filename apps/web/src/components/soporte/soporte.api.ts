import { httpClient } from '../../api/httpClient';
import {
  DocumentTimeline,
  DocumentType,
  Paged,
  Pagination,
  SortDir,
  SortField,
  StatusCount,
  StatusOption,
  SupportDocument,
  OverrideResult,
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

/** Estados VÁLIDOS del tipo (para elegir destino), distinto de `listStatuses`. */
export async function getVocabulary(type: DocumentType): Promise<StatusOption[]> {
  const res = await httpClient.get<ApiData<StatusOption[]>>(
    '/api/support/vocabulary',
    { params: { type } },
  );
  return res.data.data;
}

/** Fuerza el estado de un documento. Única escritura de la consola. */
export async function overrideStatus(
  type: DocumentType,
  guid: string,
  toCode: string,
  reasonNotes: string,
  reasonCode?: string,
): Promise<OverrideResult> {
  const res = await httpClient.patch<ApiData<OverrideResult>>(
    `/api/support/documents/${type}/${encodeURIComponent(guid)}/status`,
    { toCode, reasonNotes, reasonCode },
  );
  return res.data.data;
}
