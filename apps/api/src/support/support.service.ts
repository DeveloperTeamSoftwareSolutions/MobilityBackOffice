import { Injectable } from '@nestjs/common';
import { SupportClient } from './support.client';
import { AuditService } from '../audit/audit.service';
import {
  DocumentsQuery,
  DocumentTimeline,
  DocumentType,
  OverrideRequest,
  OverrideResult,
  PagedDocuments,
  StatusCount,
  StatusOption,
  TimelineDocument,
  TimelineQuery,
} from './support.types';

/** Identidad del logueado, para la traza. */
export interface Actor {
  email?: string;
  guid?: string;
}

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
  constructor(
    private readonly client: SupportClient,
    private readonly audit: AuditService,
  ) {}

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

  /** Estados VALIDOS del tipo, para elegir destino en el override. */
  getVocabulary(type: DocumentType): Promise<StatusOption[]> {
    return this.client.getVocabulary(type);
  }

  /**
   * Fuerza el estado de un documento y deja traza en `AuditLogs`.
   *
   * La auditoria va con `safeRecord` (best-effort) a proposito: cuando llega acá el
   * middleware YA commiteó el cambio, así que un fallo del log central no debe
   * devolver un error al usuario por una operación que sí ocurrió. El hecho, además,
   * queda registrado por partida doble del lado del middleware (`OrdersStatus` +
   * `Auditories`), que es lo que alimenta la línea de tiempo.
   */
  async overrideStatus(
    req: OverrideRequest,
    actor: Actor,
  ): Promise<OverrideResult> {
    const result = await this.client.overrideStatus(req);

    // Reescribir el mismo estado no cambió nada: no ensucia la traza.
    if (result.noop) return result;

    await this.audit.safeRecord({
      action: 'SUPPORT_STATUS_OVERRIDE',
      entity: req.type === 'quote' ? 'BusinessQuotes' : 'BusinessOrders',
      entityId: result.documentNumber,
      category: 'support',
      guidUsers: actor.guid ?? null,
      detail: [
        actor.email ?? 'desconocido',
        `documento=${result.documentNumber}`,
        `de=${result.fromCode ?? 'sin estado'}`,
        `a=${result.toCode}`,
        `motivo=${req.reasonNotes}`,
        req.reasonCode ? `codigo=${req.reasonCode}` : null,
      ]
        .filter(Boolean)
        .join(' | '),
    });

    return result;
  }
}
