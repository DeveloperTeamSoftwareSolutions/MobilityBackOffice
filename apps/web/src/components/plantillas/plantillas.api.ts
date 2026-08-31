import { httpClient } from '../../api/httpClient';
import {
  CreateTemplatePayload,
  Template,
  TemplateDetail,
  TemplatesPage,
  TemplatesQuery,
  UpdateTemplatePayload,
} from './plantillas.types';

interface ApiData<T> {
  success: boolean;
  data: T;
}

/** ¿La sección puede funcionar? Distingue "no hay plantillas" de "falta configurar". */
export async function getStatus(): Promise<boolean> {
  const res = await httpClient.get<{ success: boolean; configured: boolean }>(
    '/api/templates/status',
  );
  return res.data.configured;
}

export async function getTemplates(query: TemplatesQuery): Promise<TemplatesPage> {
  const res = await httpClient.get<{ success: boolean } & TemplatesPage>('/api/templates', {
    params: {
      page: query.page,
      limit: query.limit,
      search: query.search || undefined,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      status: query.status ?? undefined,
    },
  });
  return {
    data: res.data.data,
    pagination: res.data.pagination,
    summary: res.data.summary,
    onlyApproved: res.data.onlyApproved,
  };
}

export async function getTemplate(name: string): Promise<Template> {
  const res = await httpClient.get<ApiData<Template>>(
    `/api/templates/${encodeURIComponent(name)}`,
  );
  return res.data.data;
}

/** Detalle + si META permite editarla ahora. */
export async function getTemplateDetail(id: number): Promise<TemplateDetail> {
  const res = await httpClient.get<{ success: boolean } & TemplateDetail>(
    `/api/templates/${id}`,
  );
  return { template: res.data.template, editPolicy: res.data.editPolicy };
}

/** Crea y envía a META para aprobación. */
export async function createTemplate(payload: CreateTemplatePayload): Promise<Template> {
  const res = await httpClient.post<ApiData<Template>>('/api/templates', payload);
  return res.data.data;
}

/** Edita y reenvía a revisión. */
export async function updateTemplate(
  id: number,
  payload: UpdateTemplatePayload,
): Promise<Template> {
  const res = await httpClient.put<ApiData<Template>>(`/api/templates/${id}`, payload);
  return res.data.data;
}

export async function deleteTemplate(id: number): Promise<void> {
  await httpClient.delete(`/api/templates/${id}`);
}

/** Trae de META lo que haya cambiado allá: aprobaciones, rechazos, pausas. */
export async function syncTemplates(): Promise<void> {
  await httpClient.post('/api/templates/sync', {});
}

/**
 * Mensajes de error legibles a partir de la respuesta del servidor.
 *
 * El backend propaga la validación de WABA, que puede venir como un mensaje suelto o
 * como una lista en `errors`. Se normaliza acá para que la pantalla no tenga que
 * conocer las dos formas.
 */
export function mensajesDeError(err: unknown): string[] {
  const data = (err as { response?: { data?: { message?: unknown; errors?: unknown } } })
    ?.response?.data;

  const lista = data?.errors;
  if (Array.isArray(lista) && lista.length) {
    return lista.map((e) => (typeof e === 'string' ? e : String((e as { message?: string })?.message ?? e)));
  }

  const msg = data?.message;
  if (Array.isArray(msg)) return msg.map(String);
  if (typeof msg === 'string' && msg.trim()) return [msg];

  return ['No se pudo completar la operación. Intentá de nuevo.'];
}
