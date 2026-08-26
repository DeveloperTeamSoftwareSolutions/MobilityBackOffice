import { Injectable } from '@nestjs/common';
import { SupportClient } from './support.client';
import { AuditService } from '../audit/audit.service';
import {
  ActionResult,
  DecisionResult,
  DocumentActions,
  DocumentItems,
  DocumentsQuery,
  DocumentTimeline,
  DocumentType,
  InconsistentReport,
  ItemDecisionRequest,
  ItemResponseRequest,
  PagedDocuments,
  PaymentDecisionRequest,
  PaymentResponseRequest,
  ProjectedStatus,
  RecomputeResult,
  StatusCount,
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
 * Las LECTURAS no se auditan en `AuditLogs`: ya quedan trazadas en los `ApiLogs` del
 * middleware por el header `x-source-app` que agrega `middleware-request`, y
 * duplicarlas no agregaria informacion.
 *
 * Las ESCRITURAS si, siempre: alteran documentos de negocio y soporte actua a pedido
 * de un tercero, asi que el motivo —que dice quien lo pidio y por que— es la mitad
 * util del registro. Ver docs/SPEC_CONSOLA_SOPORTE.md §10.
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

  /** Lineas del documento, el plazo de pago y el turno del gerente. */
  listItems(type: DocumentType, guid: string): Promise<DocumentItems> {
    return this.client.listItems(type, guid);
  }

  /**
   * Traza comun de las cuatro decisiones.
   *
   * Registra el estado ANTES y DESPUES aunque no haya cambiado. Que una decision no
   * mueva el documento es informacion, no ruido: es lo que responde el "¿por que
   * sigue igual?" del dia siguiente (falta decidir otra linea, falta cerrar el turno,
   * el vendedor todavia no respondio).
   */
  private async auditarDecision(params: {
    accion: string;
    entity: string;
    result: DecisionResult;
    actor: Actor;
    reasonNotes: string;
    detalle: string[];
  }): Promise<void> {
    await this.audit.safeRecord({
      action: params.accion,
      entity: params.entity,
      entityId: params.result.documentNumber,
      category: 'support',
      guidUsers: params.actor.guid ?? null,
      detail: [
        params.actor.email ?? 'desconocido',
        `documento=${params.result.documentNumber}`,
        ...params.detalle,
        `estado=${params.result.statusBefore ?? 'sin estado'}->${params.result.statusAfter ?? 'sin estado'}`,
        `motivo=${params.reasonNotes}`,
      ].join(' | '),
    });
  }

  private entidadItems(type: DocumentType): string {
    return type === 'quote' ? 'BusinessQuoteItems' : 'BusinessOrderItems';
  }

  private entidadCabecera(type: DocumentType): string {
    return type === 'quote' ? 'BusinessQuotes' : 'BusinessOrders';
  }

  /** Decision del gerente sobre una linea, ejecutada por soporte a su pedido. */
  async decideItem(req: ItemDecisionRequest, actor: Actor): Promise<DecisionResult> {
    const result = await this.client.decideItem(req);

    await this.auditarDecision({
      accion: 'SUPPORT_ITEM_DECISION',
      entity: this.entidadItems(req.type),
      result,
      actor,
      reasonNotes: req.reasonNotes,
      detalle: [
        `producto=${req.productCode}`,
        `decision=${req.status}`,
        ...(req.status === 'countered' ? [`precioPropuesto=${req.proposedPrice}`] : []),
      ],
    });

    return result;
  }

  /** Respuesta del vendedor a una contraoferta de linea. */
  async respondItem(req: ItemResponseRequest, actor: Actor): Promise<DecisionResult> {
    const result = await this.client.respondItem(req);

    await this.auditarDecision({
      accion: 'SUPPORT_ITEM_RESPONSE',
      entity: this.entidadItems(req.type),
      result,
      actor,
      reasonNotes: req.reasonNotes,
      detalle: [`producto=${req.productCode}`, `respuesta=${req.action}`],
    });

    return result;
  }

  /** Decision del gerente sobre el plazo de pago pedido en la cabecera. */
  async decidePaymentTerms(
    req: PaymentDecisionRequest,
    actor: Actor,
  ): Promise<DecisionResult> {
    const result = await this.client.decidePaymentTerms(req);

    await this.auditarDecision({
      accion: 'SUPPORT_PAYMENT_DECISION',
      entity: this.entidadCabecera(req.type),
      result,
      actor,
      reasonNotes: req.reasonNotes,
      detalle: [
        `decision=${req.status}`,
        ...(req.status === 'observed' ? [`plazoPropuesto=${req.value}`] : []),
      ],
    });

    return result;
  }

  /** Respuesta del vendedor a una contraoferta de plazo de pago. */
  async respondPaymentTerms(
    req: PaymentResponseRequest,
    actor: Actor,
  ): Promise<DecisionResult> {
    const result = await this.client.respondPaymentTerms(req);

    await this.auditarDecision({
      accion: 'SUPPORT_PAYMENT_RESPONSE',
      entity: this.entidadCabecera(req.type),
      result,
      actor,
      reasonNotes: req.reasonNotes,
      detalle: [`respuesta=${req.action}`],
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
