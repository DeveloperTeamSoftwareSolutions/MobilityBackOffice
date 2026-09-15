import { EXAMPLE_CATALOGS, EXAMPLE_ORDERS } from './revision-sap.ejemplo';
import {
  ReviewCatalogs,
  ReviewOrderDetail,
  ReviewQueueEntry,
} from './revision-sap.types';

/**
 * Acceso a datos de la sección.
 *
 * Hoy responde con los datos de ejemplo. Las firmas son las que va a tener la
 * integración con la API: cuando el Middleware exponga la bandeja, el detalle y los
 * catálogos, se cambia el cuerpo de estas funciones y los componentes no se tocan.
 */

export class ReviewOrderNotFoundError extends Error {
  constructor(guid: string) {
    super(`No existe una orden en revisión con guid ${guid}`);
    this.name = 'ReviewOrderNotFoundError';
  }
}

function toQueueEntry(order: ReviewOrderDetail): ReviewQueueEntry {
  return {
    guid: order.guid,
    orderNumber: order.orderNumber,
    customerCode: order.customerCode,
    customerName: order.customerName,
    sellerEmail: order.sellerEmail,
    salesArea: { ...order.salesArea },
    sapError: order.sapError,
    rejectedAt: order.rejectedAt,
    attempts: order.attempts,
    itemCount: order.itemCount,
  };
}

/** Órdenes en revisión, la rechazada más recientemente primero. */
export async function listReviewQueue(): Promise<ReviewQueueEntry[]> {
  return EXAMPLE_ORDERS.map(toQueueEntry).sort((a, b) =>
    b.rejectedAt.localeCompare(a.rejectedAt),
  );
}

export async function getReviewOrder(guid: string): Promise<ReviewOrderDetail> {
  const order = EXAMPLE_ORDERS.find((o) => o.guid === guid);
  if (!order) throw new ReviewOrderNotFoundError(guid);
  return structuredClone(order);
}

export async function getReviewCatalogs(guid: string): Promise<ReviewCatalogs> {
  const catalogs = EXAMPLE_CATALOGS[guid];
  if (!catalogs) throw new ReviewOrderNotFoundError(guid);
  return structuredClone(catalogs);
}
