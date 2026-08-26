import { Injectable } from '@nestjs/common';
import { SupportClient } from './support.client';
import { AuditService } from '../audit/audit.service';
import {
  ActionResult,
  DocumentActions,
  DocumentItems,
  DocumentsQuery,
  DocumentTimeline,
  DocumentType,
  InconsistentReport,
  ItemStatusRequest,
  ItemStatusResult,
  OverrideRequest,
  OverrideResult,
  PagedDocuments,
  ProjectedStatus,
  RecomputeResult,
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

  /**
   * Documentos con el estado desfasado. Es una LECTURA: no se audita ni cambia nada.
   */
  listInconsistent(
    type: DocumentType,
    limit: number,
  ): Promise<InconsistentReport> {
    return this.client.listInconsistent(type, limit);
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

  /**
   * Estado que el recalculo daria hoy. No se audita: es una LECTURA, no cambia nada.
   */
  getProjectedStatus(
    type: DocumentType,
    guid: string,
  ): Promise<ProjectedStatus> {
    return this.client.getProjectedStatus(type, guid);
  }

  /** Acciones con intencion disponibles. Es una LECTURA. */
  listActions(type: DocumentType, guid: string): Promise<DocumentActions> {
    return this.client.listActions(type, guid);
  }

  /**
   * Ejecuta una accion con intencion y deja traza.
   *
   * Se audita el RESULTADO real, incluido si NO se logro la intencion: saber que se
   * intento devolver al gerente y el documento quedo igual es justamente el dato que
   * hace falta cuando alguien pregunta despues.
   */
  async runAction(
    type: DocumentType,
    guid: string,
    action: string,
    reasonNotes: string,
    actor: Actor,
  ): Promise<ActionResult> {
    const result = await this.client.runAction(
      type,
      guid,
      action,
      reasonNotes,
      actor.email ?? null,
    );

    await this.audit.safeRecord({
      action: 'SUPPORT_ACTION',
      entity: type === 'quote' ? 'BusinessQuotes' : 'BusinessOrders',
      entityId: result.documentNumber,
      category: 'support',
      guidUsers: actor.guid ?? null,
      detail: [
        actor.email ?? 'desconocido',
        `documento=${result.documentNumber}`,
        `accion=${result.action}`,
        `estado=${result.statusBefore ?? 'sin estado'}->${result.statusAfter ?? 'sin estado'}`,
        `esperado=${result.expected ?? '-'}`,
        `logrado=${result.achieved}`,
        `motivo=${reasonNotes}`,
      ].join(' | '),
    });

    return result;
  }

  /** Lineas del documento con su estado y el turno del gerente. */
  listItems(type: DocumentType, guid: string): Promise<DocumentItems> {
    return this.client.listItems(type, guid);
  }

  /**
   * Cambia el estado de una linea y deja traza.
   *
   * A diferencia del override de cabecera, el middleware recalcula el estado del
   * documento despues de este cambio: por eso el detalle registra el estado antes y
   * despues, que es lo que le permite a soporte ver si el arreglo tuvo efecto.
   */
  async setItemStatus(
    req: ItemStatusRequest,
    actor: Actor,
  ): Promise<ItemStatusResult> {
    const result = await this.client.setItemStatus(req);

    const cambios = [
      req.authorizationStatus !== undefined
        ? `autorizacion=${req.authorizationStatus ?? 'pendiente'}`
        : null,
      req.sellerResponse !== undefined
        ? `vendedor=${req.sellerResponse ?? 'sin responder'}`
        : null,
      req.authorizationRequired !== undefined
        ? `requiereAutorizacion=${req.authorizationRequired}`
        : null,
    ].filter(Boolean);

    await this.audit.safeRecord({
      action: 'SUPPORT_ITEM_OVERRIDE',
      entity: req.type === 'quote' ? 'BusinessQuoteItems' : 'BusinessOrderItems',
      entityId: result.documentNumber,
      category: 'support',
      guidUsers: actor.guid ?? null,
      detail: [
        actor.email ?? 'desconocido',
        `documento=${result.documentNumber}`,
        `linea=${result.lineNumber}`,
        ...cambios,
        `estado=${result.statusBefore ?? 'sin estado'}->${result.statusAfter ?? 'sin estado'}`,
        `motivo=${req.reasonNotes}`,
      ].join(' | '),
    });

    return result;
  }

  /**
   * Recalcula la cabecera desde los hechos. Se audita igual que una escritura
   * aunque no cambie datos por si mismo: puede mover el estado del documento, y
   * saber quien lo disparo importa cuando alguien pregunta por que cambio.
   */
  async recompute(
    type: DocumentType,
    guid: string,
    actor: Actor,
  ): Promise<RecomputeResult> {
    const result = await this.client.recompute(type, guid);

    if (result.statusBefore !== result.statusAfter) {
      await this.audit.safeRecord({
        action: 'SUPPORT_RECOMPUTE',
        entity: type === 'quote' ? 'BusinessQuotes' : 'BusinessOrders',
        entityId: result.documentNumber,
        category: 'support',
        guidUsers: actor.guid ?? null,
        detail: [
          actor.email ?? 'desconocido',
          `documento=${result.documentNumber}`,
          `estado=${result.statusBefore ?? 'sin estado'}->${result.statusAfter ?? 'sin estado'}`,
        ].join(' | '),
      });
    }

    return result;
  }
}
