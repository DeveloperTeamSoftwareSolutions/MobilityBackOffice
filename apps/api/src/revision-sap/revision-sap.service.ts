import { BadRequestException, Injectable, NotImplementedException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuditCategory } from '../audit/audit.categories';
import { Actor } from '../common/actor';
import { RevisionSapClient } from './revision-sap.client';
import {
  CenterChangeResult,
  DestinationChangeResult,
  GroupInvoiceChangeResult,
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
   * Reenvía la orden completa a SAP.
   *
   * Se audita SIEMPRE, acepte o rechace SAP: es la acción más fuerte de la sección
   * —crea un pedido real— y saber que alguien la disparó importa igual que el
   * resultado. Un rechazo auditado es justamente lo que explica por qué la orden
   * sigue en la bandeja.
   *
   * El comentario en el hilo del vendedor NO se escribe acá: lo deja el propio envío
   * del middleware, con el número de pedido o el motivo del rechazo.
   */
  async resendToSap(guid: string, actor: Actor): Promise<ResendResult> {
    // Se valida igual: si mañana esto se conecta, la sesión sin email tiene que fallar
    // por lo mismo que antes y no por accidente.
    this.requireEmail(actor);

    // ⚠️ SIGUE DESCONECTADO (2026-09-18), pero YA NO por falta del endpoint.
    //
    // El envío por centro existe desde el PR #681 del Middleware, y el cliente de acá
    // ya le pega y traduce su respuesta por centro. Lo que falta es un BUG DE ESE
    // ENDPOINT: arma sus ítems con un `.map` que no copia `centerCode` desde el
    // repositorio, y después valida `it.centerCode` sobre ese mismo objeto — así que
    // lee `undefined` en todas las líneas y CORTA SIEMPRE con 422 ("faltan centros"),
    // tengan o no centro en la base. Avisado a Gustavo el 2026-09-18.
    //
    // Se corta acá y no sólo apagando el botón: mientras el endpoint responda, el
    // operador vería un error que además MIENTE —dice que asigne los centros, y los
    // centros están— sin forma de avanzar.
    //
    // PARA RECONECTARLO, cuando el fix esté: borrar este `throw` y devolver
    // `this.client.resendToSap(guid, actorEmail)`. Lo de abajo (auditoría) ya está
    // escrito para eso. Verificar contra ORD00005729, que tiene 3 líneas en 2 centros.
    throw new NotImplementedException(
      'El reenvío a SAP desde BackOffice todavía no está disponible: el envío por centro ' +
        'del Middleware rebota todas las órdenes por un error en su validación de centros.',
    );
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
