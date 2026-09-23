import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuditCategory } from '../audit/audit.categories';
import { Actor } from '../common/actor';
import { RevisionSapClient } from './revision-sap.client';
import {
  CenterChangeResult,
  DestinationChangeResult,
  GroupInvoiceChangeResult,
  ItemCancellationResult,
  NoSaleReason,
  ProductStock,
  RejectResult,
  ResendResult,
  SapOrder,
  ReviewOptions,
  ReviewOrder,
  ReviewQueuePage,
  ReviewQueueQuery,
} from './revision-sap.types';

/**
 * Revisión de órdenes rechazadas por SAP.
 *
 * Las LECTURAS no se auditan en `AuditLogs`: quedan en los `ApiLogs` del middleware por
 * el header `x-source-app`. Las ESCRITURAS sí: cambian a dónde va la mercadería de un
 * cliente. El middleware además deja su propia auditoría con el antes y el después, y
 * un comentario en el hilo de la orden.
 */
@Injectable()
export class RevisionSapService {
  constructor(
    private readonly client: RevisionSapClient,
    private readonly audit: AuditService,
  ) {}

  listQueue(query: ReviewQueueQuery): Promise<ReviewQueuePage> {
    return this.client.listQueue(query);
  }

  getOrder(guid: string): Promise<ReviewOrder> {
    return this.client.getOrder(guid);
  }

  getOptions(guid: string, includeStock: boolean): Promise<ReviewOptions> {
    return this.client.getOptions(guid, includeStock);
  }

  /** Órdenes SAP de la orden. Es una LECTURA: no se audita. */
  listSapOrders(guid: string): Promise<SapOrder[]> {
    return this.client.listSapOrders(guid);
  }

  /** Stock de un producto por centro y almacén. Es una LECTURA: no se audita. */
  getProductStock(guid: string, productCode: string): Promise<ProductStock> {
    return this.client.getProductStock(guid, productCode);
  }

  /**
   * Cambia el centro de una línea. El centro por línea es el que va a usar el
   * middleware para partir la orden en una orden SAP por centro.
   */
  async changeItemCenter(
    guid: string,
    itemGuid: string,
    centerCode: string,
    reasonNotes: string | null,
    actor: Actor,
  ): Promise<CenterChangeResult> {
    const actorEmail = this.requireEmail(actor);
    const result = await this.client.changeItemCenter(guid, itemGuid, {
      centerCode,
      actorEmail,
      reasonNotes,
    });

    if (!result.unchanged) {
      await this.audit.safeRecord({
        action: 'REVISION_SAP_CENTER_CHANGE',
        entity: 'BusinessOrderItems',
        entityId: result.item.guid,
        category: AuditCategory.SapReview,
        guidUsers: actor.guid ?? null,
        guidApiLoginClients: actor.guidApiLoginClients ?? null,
        actorEmail,
        detail: [
          `orden=${guid}`,
          `linea=${result.item.lineNumber}`,
          `producto=${result.item.productCode}`,
          `centro=${result.item.centerCode ?? '-'}`,
          `motivo=${reasonNotes ?? '-'}`,
        ].join(' | '),
      });
    }

    return result;
  }

  /**
   * Cambia "agrupa factura". No es una corrección logística como el centro o el destino:
   * con `true`, una línea sin stock impide el envío ENTERO —la orden rebota y no se crea
   * ninguna orden SAP—; con `false`, esas líneas se filtran y sale el resto. Por eso se
   * audita aunque no toque ninguna línea.
   */
  async changeGroupInvoice(
    guid: string,
    groupInvoice: boolean,
    reasonNotes: string | null,
    actor: Actor,
  ): Promise<GroupInvoiceChangeResult> {
    const actorEmail = this.requireEmail(actor);
    const result = await this.client.changeGroupInvoice(guid, {
      groupInvoice,
      actorEmail,
      reasonNotes,
    });

    if (!result.unchanged) {
      await this.audit.safeRecord({
        action: 'REVISION_SAP_GROUP_INVOICE_CHANGE',
        entity: 'BusinessOrders',
        entityId: guid,
        category: AuditCategory.SapReview,
        guidUsers: actor.guid ?? null,
        guidApiLoginClients: actor.guidApiLoginClients ?? null,
        actorEmail,
        detail: [
          `orden=${guid}`,
          `agrupaFactura=${result.groupInvoice ? 'si' : 'no'}`,
          `motivo=${reasonNotes ?? '-'}`,
        ].join(' | '),
      });
    }

    return result;
  }

  /**
   * RECHAZA la orden: vuelve al vendedor como "Rechazada" y no se deshace.
   *
   * Se audita SIEMPRE y sin condición de `unchanged`: no hay rechazo que no cambie
   * nada, y es la acción que cierra el documento. Si alguna vez hay que preguntar por
   * qué una orden murió, esta fila es la respuesta.
   *
   * El comentario en el hilo del vendedor NO se escribe acá: lo deja el middleware,
   * con el motivo. Es lo único que el vendedor va a poder leer —el estado sólo dice
   * "Rechazada", igual que un rechazo de Créditos— y por eso el motivo es obligatorio.
   */
  async rejectOrder(
    guid: string,
    reasonNotes: string,
    actor: Actor,
  ): Promise<RejectResult> {
    const actorEmail = this.requireEmail(actor);
    const result = await this.client.rejectOrder(guid, { actorEmail, reasonNotes });

    await this.audit.safeRecord({
      action: 'REVISION_SAP_REJECT',
      entity: 'BusinessOrders',
      entityId: guid,
      category: AuditCategory.SapReview,
      guidUsers: actor.guid ?? null,
      guidApiLoginClients: actor.guidApiLoginClients ?? null,
      actorEmail,
      detail: [`orden=${guid}`, `estado=${result.statusCode}`, `motivo=${reasonNotes}`].join(' | '),
    });

    return result;
  }

  /**
   * Reenvía la orden a SAP, **partida en una orden SAP por centro de distribución**.
   *
   * CONECTADO el 2026-09-21. Estuvo cortado desde el 2026-09-17: primero porque el
   * envío por centro no existía, y después porque el del Middleware rebotaba todas las
   * órdenes con 422 (no propagaba `centerCode` a su propia validación). Las dos cosas
   * están resueltas — PR #681 y #687 del Middleware, desde 1.361.1.
   *
   * Se audita SIEMPRE, salgan o no los pedidos: es la acción más fuerte de la sección
   * —crea pedidos reales en SAP— y saber quién la disparó importa igual que el
   * resultado. Un rechazo auditado es justamente lo que explica por qué la orden sigue
   * en la bandeja.
   *
   * El detalle de la auditoría lleva el desenlace POR CENTRO, no un resumen: con una
   * orden partida, "falló" no dice nada si no se sabe cuál. El fallo parcial se marca
   * aparte porque es el caso que deja pedidos creados en SAP.
   *
   * El comentario en el hilo del vendedor NO se escribe acá: lo deja el propio envío
   * del middleware, con los números de pedido o el motivo del rechazo de cada centro.
   */
  async resendToSap(guid: string, actor: Actor): Promise<ResendResult> {
    const actorEmail = this.requireEmail(actor);
    const result = await this.client.resendToSap(guid, actorEmail);

    const desenlace = result.skipped
      ? 'no-enviada'
      : result.accepted
        ? 'aceptada'
        : result.partial
          ? 'PARCIAL'
          : 'rechazada';

    await this.audit.safeRecord({
      action: 'REVISION_SAP_RESEND',
      entity: 'BusinessOrders',
      entityId: guid,
      category: AuditCategory.SapReview,
      guidUsers: actor.guid ?? null,
      guidApiLoginClients: actor.guidApiLoginClients ?? null,
      actorEmail,
      detail: [
        `orden=${guid}`,
        `resultado=${desenlace}`,
        `centros=${result.acceptedBuckets}/${result.totalBuckets}`,
        // Qué pasó en cada uno, con su número de pedido: es lo que hace reconstruible
        // un envío partido meses después.
        `detalle=${
          result.buckets
            .map((b) => `${b.centerCode}:${b.status}${b.sapOrderNumber ? `/${b.sapOrderNumber}` : ''}`)
            .join(' ') || '-'
        }`,
        `motivo=${result.skippedReason ?? result.error ?? '-'}`,
      ].join(' | '),
    });

    return result;
  }

  /** Catálogo de motivos de no venta. Es una LECTURA: no se audita. */
  listNoSaleReasons(): Promise<NoSaleReason[]> {
    return this.client.listNoSaleReasons();
  }

  /**
   * CANCELA una línea con motivo de no venta: deja de viajar a SAP, pero sigue viéndose.
   *
   * Se audita SIEMPRE —no hay cancelación que no cambie nada— y con el motivo adentro:
   * la fila de auditoría tiene que alcanzar para responder "¿por qué esta línea no
   * llegó a SAP?" sin abrir la orden.
   *
   * El comentario en el hilo del vendedor NO se escribe acá: lo deja el middleware, con
   * la etiqueta del motivo.
   */
  async cancelItem(
    guid: string,
    itemGuid: string,
    reasonCode: string,
    reasonNotes: string | null,
    actor: Actor,
  ): Promise<ItemCancellationResult> {
    const actorEmail = this.requireEmail(actor);
    const result = await this.client.cancelItem(guid, itemGuid, {
      reasonCode,
      reasonNotes,
      actorEmail,
    });

    await this.audit.safeRecord({
      action: 'REVISION_SAP_ITEM_CANCEL',
      entity: 'BusinessOrderItems',
      entityId: result.item.guid,
      category: AuditCategory.SapReview,
      guidUsers: actor.guid ?? null,
      guidApiLoginClients: actor.guidApiLoginClients ?? null,
      actorEmail,
      detail: [
        `orden=${guid}`,
        `linea=${result.item.lineNumber}`,
        `producto=${result.item.productCode}`,
        `motivo=${reasonCode}`,
        `nota=${reasonNotes ?? '-'}`,
        // Cuántas quedaron: si es 0, el próximo envío no puede salir, y eso explica
        // solo un rechazo posterior.
        `activosRestantes=${result.activosRestantes}`,
      ].join(' | '),
    });

    return result;
  }

  /**
   * REACTIVA una línea cancelada. El middleware lo frena si hubo un envío posterior a la
   * cancelación: ese envío ya salió sin la línea.
   */
  async reactivateItem(
    guid: string,
    itemGuid: string,
    actor: Actor,
  ): Promise<ItemCancellationResult> {
    const actorEmail = this.requireEmail(actor);
    const result = await this.client.reactivateItem(guid, itemGuid, { actorEmail });

    await this.audit.safeRecord({
      action: 'REVISION_SAP_ITEM_REACTIVATE',
      entity: 'BusinessOrderItems',
      entityId: result.item.guid,
      category: AuditCategory.SapReview,
      guidUsers: actor.guid ?? null,
      guidApiLoginClients: actor.guidApiLoginClients ?? null,
      actorEmail,
      detail: [
        `orden=${guid}`,
        `linea=${result.item.lineNumber}`,
        `producto=${result.item.productCode}`,
        `activosRestantes=${result.activosRestantes}`,
      ].join(' | '),
    });

    return result;
  }

  /**
   * El middleware exige quién hizo el cambio y queda en la orden: sin email no hay a
   * quién atribuirlo.
   */
  private requireEmail(actor: Actor): string {
    if (!actor.email) {
      throw new BadRequestException(
        'La sesión no tiene email: no se puede atribuir el cambio',
      );
    }
    return actor.email;
  }

  async changeItemDestination(
    guid: string,
    itemGuid: string,
    destinationCode: string,
    reasonNotes: string | null,
    actor: Actor,
  ): Promise<DestinationChangeResult> {
    this.requireEmail(actor);

    const result = await this.client.changeItemDestination(guid, itemGuid, {
      destinationCode,
      actorEmail: actor.email as string,
      reasonNotes,
    });

    if (!result.unchanged) {
      await this.audit.safeRecord({
        action: 'REVISION_SAP_DESTINATION_CHANGE',
        entity: 'BusinessOrderItems',
        entityId: result.item.guid,
        category: AuditCategory.SapReview,
        guidUsers: actor.guid ?? null,
        guidApiLoginClients: actor.guidApiLoginClients ?? null,
        actorEmail: actor.email,
        detail: [
          `orden=${guid}`,
          `linea=${result.item.lineNumber}`,
          `producto=${result.item.productCode}`,
          `destino=${result.item.deliveryDestinationCode ?? '-'}`,
          `motivo=${reasonNotes ?? '-'}`,
        ].join(' | '),
      });
    }

    return result;
  }
}
