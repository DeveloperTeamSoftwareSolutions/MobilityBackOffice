import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { middlewareBase, middlewareHeaders } from '../common/middleware-request';
import {
  CenterChangeResult,
  DestinationChangeResult,
  GroupInvoiceChangeResult,
  ProductStock,
  ResendResult,
  SapOrder,
  ReviewOptions,
  ReviewOrder,
  ReviewQueuePage,
  ReviewQueueQuery,
} from './revision-sap.types';

/**
 * Router del middleware para la revisión de Backoffice. Relativo a `MIDDLEWARE_URL`,
 * que ya incluye `/api`. Va con `requireApiKey`: expone órdenes sin scope de vendedor.
 */
const ORDERS_PATH = '/mobility/backoffice-review/orders';
const ORDER_PATH = (guid: string) => `${ORDERS_PATH}/${encodeURIComponent(guid)}`;

/**
 * El envío a SAP: el MISMO endpoint que usa el vendedor desde MobilityIA, con
 * `asBackoffice: true`. No cuelga del router de revisión.
 */
const SEND_PATH = '/v2/mobility/businessorders2sap';

/** SAP puede demorar; el middleware le da 120 s, así que acá un poco más. */
const SEND_TIMEOUT = 150000;

/** Lo que devuelve el envío del middleware: `data.sap` es el resultado real. */
interface MwSendResponse {
  success: boolean;
  data?: {
    sap?: {
      sent?: boolean;
      success?: boolean;
      skipped?: boolean;
      reason?: string | null;
      orderId?: string | null;
      deliveryId?: string | null;
      error?: string | null;
      sapMessages?: string[] | null;
      filteredItemsCount?: number | null;
      itemsSent?: number | null;
    } | null;
  } | null;
}

/**
 * Traduce la respuesta del envío.
 *
 * `success: false` con `skipped` no es un rechazo de SAP: es que ni se intentó. Y sin
 * número de entrega la orden sigue en revisión aunque el pedido exista, que es el caso
 * silencioso que este circuito vino a evitar.
 */
function mapResend(body: MwSendResponse): ResendResult {
  const sap = body?.data?.sap ?? {};
  const skipped = sap.skipped === true;
  const accepted = body?.success === true && sap.success !== false && !skipped;
  const sapOrderNumber = sap.orderId != null ? String(sap.orderId).trim() || null : null;
  const sapDispatchNumber = sap.deliveryId != null ? String(sap.deliveryId).trim() || null : null;
  return {
    accepted,
    skipped,
    skippedReason: sap.reason ?? null,
    sapOrderNumber,
    sapDispatchNumber,
    error: sap.error ?? null,
    sapMessages: Array.isArray(sap.sapMessages) ? sap.sapMessages : [],
    filteredItemsCount: Number(sap.filteredItemsCount) || 0,
    itemsSent: Number(sap.itemsSent) || 0,
    // El envío exitoso ES el cierre de la revisión, pero sólo si SAP devolvió también
    // la entrega: con pedido y sin entrega la orden se queda en BackOffice.
    stillInReview: !accepted || !sapDispatchNumber,
  };
}

/**
 * El stock sale de SAP, una llamada por producto y en paralelo, con 120 s de timeout
 * cada una del lado del middleware. Sin stock la respuesta es inmediata.
 */
const OPTIONS_TIMEOUT_WITH_STOCK = 150000;
const DEFAULT_TIMEOUT = 20000;

interface MwData<T> {
  success: boolean;
  data: T;
}

interface MwPaged extends ReviewQueuePage {
  success: boolean;
}

function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

function mwMessage(err: unknown): string | undefined {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
}

@Injectable()
export class RevisionSapClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private base(): string {
    return middlewareBase(this.config);
  }

  private headers(): Record<string, string> {
    return middlewareHeaders(this.config);
  }

  async listQueue(query: ReviewQueueQuery): Promise<ReviewQueuePage> {
    try {
      const res = await firstValueFrom(
        this.http.get<MwPaged>(`${this.base()}${ORDERS_PATH}`, {
          params: {
            page: query.page,
            limit: query.limit,
            search: query.search || undefined,
            sortBy: query.sortBy,
            sortDir: query.sortDir,
            // Si `view` no viaja, el middleware cae en 'pending' y las DOS pestañas
            // muestran lo mismo sin fallar. Por eso va explícito y hay test.
            view: query.view,
          },
          headers: this.headers(),
          timeout: DEFAULT_TIMEOUT,
        }),
      );
      return { data: res.data.data, pagination: res.data.pagination };
    } catch {
      throw new ServiceUnavailableException(
        'La bandeja de órdenes rechazadas no está disponible',
      );
    }
  }

  async getOrder(guid: string): Promise<ReviewOrder> {
    try {
      const res = await firstValueFrom(
        this.http.get<MwData<ReviewOrder>>(`${this.base()}${ORDER_PATH(guid)}`, {
          headers: this.headers(),
          timeout: DEFAULT_TIMEOUT,
        }),
      );
      return res.data.data;
    } catch (err) {
      if (httpStatus(err) === 404) throw new NotFoundException('Orden no encontrada');
      throw new ServiceUnavailableException('La orden no está disponible');
    }
  }

  async getOptions(guid: string, includeStock: boolean): Promise<ReviewOptions> {
    try {
      const res = await firstValueFrom(
        this.http.get<MwData<ReviewOptions>>(`${this.base()}${ORDER_PATH(guid)}/options`, {
          params: { includeStock: includeStock ? 1 : 0 },
          headers: this.headers(),
          timeout: includeStock ? OPTIONS_TIMEOUT_WITH_STOCK : DEFAULT_TIMEOUT,
        }),
      );
      return res.data.data;
    } catch (err) {
      if (httpStatus(err) === 404) throw new NotFoundException('Orden no encontrada');
      throw new ServiceUnavailableException(
        includeStock
          ? 'El stock de SAP no está disponible'
          : 'Los centros y destinos no están disponibles',
      );
    }
  }

  /** Órdenes SAP de la orden (una fila por orden SAP), con sus ítems sin precios. */
  async listSapOrders(guid: string): Promise<SapOrder[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<MwData<SapOrder[]>>(`${this.base()}${ORDER_PATH(guid)}/sap-orders`, {
          headers: this.headers(),
          timeout: DEFAULT_TIMEOUT,
        }),
      );
      return res.data.data;
    } catch (err) {
      if (httpStatus(err) === 404) throw new NotFoundException('Orden no encontrada');
      throw new ServiceUnavailableException('Las órdenes SAP no están disponibles');
    }
  }

  /** Stock de un producto de la orden, por centro y almacén. */
  async getProductStock(guid: string, productCode: string): Promise<ProductStock> {
    try {
      const res = await firstValueFrom(
        this.http.get<MwData<ProductStock>>(
          `${this.base()}${ORDER_PATH(guid)}/stock/${encodeURIComponent(productCode)}`,
          { headers: this.headers(), timeout: DEFAULT_TIMEOUT },
        ),
      );
      return res.data.data;
    } catch (err) {
      const status = httpStatus(err);
      if (status === 404) {
        throw new NotFoundException(mwMessage(err) ?? 'El producto no es de esta orden');
      }
      if (status === 400) throw new BadRequestException(mwMessage(err) ?? 'Producto inválido');
      throw new ServiceUnavailableException('El stock no está disponible');
    }
  }

  /**
   * Cambia el destino de una línea. El middleware valida que el destino sea del área
   * de la orden y que la orden siga en revisión; sus rechazos se devuelven con su
   * mensaje, porque le dicen al usuario qué corregir.
   */
  changeItemDestination(
    guid: string,
    itemGuid: string,
    body: { destinationCode: string; actorEmail: string; reasonNotes: string | null },
  ): Promise<DestinationChangeResult> {
    return this.putLine(guid, itemGuid, 'destination', body, 'No se pudo guardar el destino');
  }

  /** Cambia el centro de una línea. El middleware exige un centro permitido para el cliente. */
  changeItemCenter(
    guid: string,
    itemGuid: string,
    body: { centerCode: string; actorEmail: string; reasonNotes: string | null },
  ): Promise<CenterChangeResult> {
    return this.putLine(guid, itemGuid, 'center', body, 'No se pudo guardar el centro');
  }

  /**
   * Cambia "agrupa factura", que es de CABECERA: decide si la orden puede salir parcial.
   * No es un cambio de línea, así que no pasa por `putLine`.
   */
  async changeGroupInvoice(
    guid: string,
    body: { groupInvoice: boolean; actorEmail: string; reasonNotes: string | null },
  ): Promise<GroupInvoiceChangeResult> {
    try {
      const res = await firstValueFrom(
        this.http.put<MwData<GroupInvoiceChangeResult>>(
          `${this.base()}${ORDER_PATH(guid)}/group-invoice`,
          body,
          { headers: this.headers(), timeout: DEFAULT_TIMEOUT },
        ),
      );
      return res.data.data;
    } catch (err) {
      const status = httpStatus(err);
      if (status === 404) throw new NotFoundException(mwMessage(err) ?? 'Orden no encontrada');
      // 409: la orden salió de revisión mientras se editaba.
      if (status === 409) throw new ConflictException(mwMessage(err) ?? 'La orden ya no está en revisión');
      if (status === 400) {
        throw new BadRequestException(mwMessage(err) ?? 'No se pudo guardar agrupa factura');
      }
      throw new ServiceUnavailableException('No se pudo guardar agrupa factura');
    }
  }

  /**
   * Reenvía la orden COMPLETA a SAP.
   *
   * No va contra el router de revisión sino contra el envío del middleware, que es el
   * mismo que usa el vendedor: una sola llamada que manda el pedido, estampa el
   * resultado, mueve la cabecera y —si SAP acepta— cierra la revisión. Por eso la base
   * se arma aparte: `ORDERS_PATH` cuelga de `/mobility/backoffice-review` y esto no.
   *
   * `asBackoffice: true` + `x-api-key` es lo que el middleware exige para reconocer el
   * envío como de BackOffice (saltea el vencimiento de crédito de 24 h). Sin la API key
   * configurada lo trata como un envío común y el crédito vencido lo frena.
   *
   * Tarda: SAP puede demorar, así que el timeout es largo y propio.
   */
  async resendToSap(guid: string, actorEmail: string): Promise<ResendResult> {
    try {
      const res = await firstValueFrom(
        this.http.post<MwSendResponse>(
          `${this.base()}${SEND_PATH}`,
          { guidBusinessOrders: guid, asBackoffice: true, actorEmail },
          { headers: this.headers(), timeout: SEND_TIMEOUT },
        ),
      );
      return mapResend(res.data);
    } catch (err) {
      const status = httpStatus(err);
      const message = mwMessage(err);
      // El pedido ya existe en SAP: reenviarlo lo duplicaría. El middleware lo frena
      // sólo para BackOffice, y el mensaje explica qué hacer en su lugar.
      if (status === 409) {
        throw new ConflictException(message ?? 'La orden ya tiene un pedido creado en SAP');
      }
      if (status === 404) throw new NotFoundException(message ?? 'Orden no encontrada');
      if (status === 400 || status === 422) {
        throw new BadRequestException(message ?? 'La orden no está en condiciones de enviarse');
      }
      // Sin respuesta: el pedido PUDO haberse creado. No se reintenta a ciegas.
      throw new ServiceUnavailableException(
        'SAP no confirmó el envío. Verificá en SAP si el pedido se creó antes de reintentar.',
      );
    }
  }

  private async putLine<T>(
    guid: string,
    itemGuid: string,
    field: 'destination' | 'center',
    body: object,
    unavailable: string,
  ): Promise<T> {
    try {
      const res = await firstValueFrom(
        this.http.put<MwData<T>>(
          `${this.base()}${ORDER_PATH(guid)}/items/${encodeURIComponent(itemGuid)}/${field}`,
          body,
          { headers: this.headers(), timeout: DEFAULT_TIMEOUT },
        ),
      );
      return res.data.data;
    } catch (err) {
      const status = httpStatus(err);
      const message = mwMessage(err);
      if (status === 404) throw new NotFoundException(message ?? 'La orden o la línea no existen');
      if (status === 409) {
        throw new ConflictException(message ?? 'La orden ya no está en revisión');
      }
      if (status === 400) throw new BadRequestException(message ?? 'Valor inválido');
      throw new ServiceUnavailableException(unavailable);
    }
  }
}
