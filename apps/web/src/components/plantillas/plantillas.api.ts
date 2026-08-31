import { httpClient } from '../../api/httpClient';
import {
  CreateTemplatePayload,
  Template,
  TemplateDetail,
  TemplateDraft,
  TemplateFormState,
  TemplatesPage,
  TemplatesQuery,
  UpdateTemplatePayload,
} from './plantillas.types';

/**
 * El formulario al payload del API.
 *
 * Lo comparten enviar, validar y guardar borrador. Si cada uno armara el suyo, el JSON
 * que se muestra en la revisión podría no ser el que termina viajando — que es
 * justamente lo que el JSON está ahí para responder.
 *
 * AUTHENTICATION no lleva cuerpo, encabezado ni botones: META escribe el texto.
 */
export function aPayload(f: TemplateFormState): CreateTemplatePayload {
  const base = { name: f.name.trim(), language: f.language, category: f.category };

  if (f.category === 'AUTHENTICATION') {
    const mins = f.codeExpirationMinutes.trim();
    return {
      ...base,
      addSecurityRecommendation: f.addSecurityRecommendation,
      codeExpirationMinutes: mins === '' ? null : Number(mins),
      otpType: f.otpType,
    };
  }

  const esMedia = f.headerType !== 'NONE' && f.headerType !== 'TEXT';

  return {
    ...base,
    headerType: f.headerType,
    headerContent: f.headerType === 'TEXT' ? f.headerContent : null,
    // El handle solo aplica a los encabezados multimedia.
    headerHandle: esMedia ? f.headerHandle || null : null,
    bodyText: f.bodyText,
    footerText: f.footerText.trim() || null,
    buttons: f.buttons,
    // Los ejemplos son obligatorios para META: sin ellos rechaza la plantilla.
    variables: f.variables,
  };
}


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

/** El JSON que se le mandaría a META. No escribe nada: es para revisar antes de enviar. */
export async function validateTemplate(payload: CreateTemplatePayload): Promise<{
  valid: boolean;
  errors: string[];
  payload: unknown;
  payloadError: string | null;
}> {
  const res = await httpClient.post<{
    success: boolean;
    valid: boolean;
    errors: string[];
    payload: unknown;
    payloadError: string | null;
  }>('/api/templates/validate', payload);
  return {
    valid: res.data.valid,
    errors: res.data.errors ?? [],
    payload: res.data.payload,
    payloadError: res.data.payloadError,
  };
}

/**
 * Sube el archivo de ejemplo del encabezado.
 *
 * META exige ver el medio para revisar una plantilla con encabezado de imagen, video o
 * documento. Devuelve el `handle` que hay que mandar al crear.
 */
export async function uploadSample(
  file: File,
  headerType: string,
): Promise<{ handle: string; fileName: string; mimeType: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('headerType', headerType);

  const res = await httpClient.post<ApiData<{ handle: string; fileName: string; mimeType: string }>>(
    '/api/templates/upload-sample',
    form,
  );
  return res.data.data;
}

/** Guarda el avance SIN mandar nada a META. Con `draftId` actualiza ese borrador. */
export async function saveDraft(
  payload: CreateTemplatePayload & {
    draftId?: number | null;
    /** Titulo para reconocer el borrador despues. No va a META. */
    friendlyTitle?: string | null;
  },
): Promise<number | null> {
  const res = await httpClient.post<{ success: boolean; draftId: number | null }>(
    '/api/templates/drafts',
    payload,
  );
  return res.data.draftId;
}

/** El borrador guardado, con el titulo, el archivo y los ejemplos de las variables. */
export async function getDraft(id: number): Promise<TemplateDraft> {
  const res = await httpClient.get<ApiData<TemplateDraft>>(`/api/templates/drafts/${id}`);
  return res.data.data;
}

/** Recién acá el borrador se manda a META. */
export async function submitDraft(
  id: number,
  payload: CreateTemplatePayload,
): Promise<Template> {
  const res = await httpClient.post<ApiData<Template>>(
    `/api/templates/drafts/${id}/submit`,
    payload,
  );
  return res.data.data;
}
