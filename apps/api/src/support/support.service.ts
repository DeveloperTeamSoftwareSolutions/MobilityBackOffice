import { Injectable } from '@nestjs/common';
import { SupportClient } from './support.client';
import {
  DocumentsQuery,
  DocumentTimeline,
  DocumentType,
  PagedDocuments,
  StatusCount,
  TimelineDocument,
  TimelineQuery,
} from './support.types';

/**
 * Logica de la consola de soporte.
 *
 * Fase 1: SOLO LECTURA. No escribe nada, ni en la base ni en `AuditLogs` — la
 * lectura ya queda trazada en los `ApiLogs` del middleware gracias al header
 * `x-source-app` que agrega `middleware-request`. Auditar cada consulta ademas en
 * `AuditLogs` duplicaria la traza sin agregar informacion.
 *
 * Las fases 2 y 3 (override de estados y banderas) SI auditan, porque ahi las
 * acciones son escrituras que alteran documentos de negocio. Ver
 * docs/SPEC_CONSOLA_SOPORTE.md §10.
 */
@Injectable()
export class SupportService {
  constructor(private readonly client: SupportClient) {}

  /** Bitacora completa (cabecera + hitos) de un documento. */
  getTimeline(query: TimelineQuery): Promise<DocumentTimeline> {
    return this.client.getTimeline(query);
  }

  /**
   * Cabecera del documento, sin los hitos.
   *
   * Reusa la misma llamada que la bitacora y descarta los eventos: el middleware no
   * expone un endpoint de cabecera suelta que no este scopeado por vendedor, y
   * duplicar la busqueda contra los endpoints scopeados devolveria 404 para soporte
   * (que nunca es el vendedor del documento).
   */
  async getDocument(query: TimelineQuery): Promise<TimelineDocument> {
    const timeline = await this.client.getTimeline(query);
    return timeline.document;
  }

  /** Listado paginado de documentos (sin scope de vendedor). */
  listDocuments(query: DocumentsQuery): Promise<PagedDocuments> {
    return this.client.listDocuments(query);
  }

  /** Estados presentes en los datos, para el filtro de la consola. */
  listStatuses(type: DocumentType): Promise<StatusCount[]> {
    return this.client.listStatuses(type);
  }
}
