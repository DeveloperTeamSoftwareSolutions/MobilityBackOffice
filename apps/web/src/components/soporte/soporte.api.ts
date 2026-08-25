import { httpClient } from '../../api/httpClient';
import { DocumentTimeline, DocumentType } from './soporte.types';

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
): Promise<DocumentTimeline> {
  const res = await httpClient.get<ApiData<DocumentTimeline>>(
    `/api/support/documents/${type}/${encodeURIComponent(documentNumber)}/timeline`,
    { params: { includeViews: includeViews ? 1 : undefined } },
  );
  return res.data.data;
}
