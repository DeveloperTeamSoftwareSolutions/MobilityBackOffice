import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuditCategory } from '../audit/audit.categories';
import { Actor } from '../common/actor';
import { RevisionSapClient } from './revision-sap.client';
import {
  CenterChangeResult,
  DestinationChangeResult,
  GroupInvoiceChangeResult,
  ProductStock,
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
