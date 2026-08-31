import { httpClient } from '../../api/httpClient';
import { TemplatesPage, Template, TemplatesQuery } from './plantillas.types';

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
