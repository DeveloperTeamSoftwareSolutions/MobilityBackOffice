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
  ItemCancellationResult,
  NoSaleReason,
  ProductStock,
  RejectResult,
  ResendBucket,
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
 * El envío PROPIO de BackOffice: parte la orden en una orden SAP por centro de
 * distribución. No es el de MobilityIA (`/v2/mobility/businessorders2sap`), que manda
 * todo junto bajo el centro de la cabecera. Los dos conviven en el middleware.
 *
 * No cuelga del router de revisión, así que la ruta se arma aparte.
 */
const SEND_PATH = '/v2/mobility/businessorders2sap-from-backoffice';

/**
 * Catálogo de motivos de no venta. Tampoco cuelga del router de revisión: es un maestro
 * compartido con MobilityIA, y ése es justamente el punto — los dos tienen que nombrar
 * los mismos motivos con los mismos códigos.
 */
const NO_SALE_REASONS_PATH = '/mobility/no-sale-reasons';

/** Fila del catálogo tal como la manda el middleware (trae más campos de los que usamos). */
interface MwNoSaleReason {
  code?: string | null;
  label?: string | null;
  sortOrder?: number | null;
}

/** SAP puede demorar, y ahora son VARIAS llamadas —una por centro—, así que va más largo. */
const SEND_TIMEOUT = 180000;

/** Una orden SAP del envío. El middleware las llama "buckets": una por centro. */
interface MwBucket {
  centerCode?: string | null;
  itemsCount?: number | null;
  sent?: boolean;
  success?: boolean;
  orderId?: string | null;
  deliveryId?: string | null;
  error?: string | null;
  sapMessages?: string[] | null;
}

/**
 * Lo que devuelve el envío multi-centro.
 *
 * `data.sap` tiene DOS formas posibles y hay que distinguirlas: con `buckets` cuando
 * hubo envío, y `{ skipped, reason }` cuando el middleware cortó antes de llamar a SAP
 * (agrupa factura con faltantes, o ningún ítem con stock).
 */
interface MwSendResponse {
  success: boolean;
  data?: {
    sap?: {
      skipped?: boolean;
      reason?: string | null;
      buckets?: MwBucket[] | null;
      totalBuckets?: number | null;
      successfulBuckets?: number | null;
      failedBuckets?: number | null;
      filteredItemsCount?: number | null;
      itemsSent?: number | null;
      success?: boolean;
      error?: string | null;
    } | null;
  } | null;
}

const texto = (v: unknown): string | null => (v != null ? String(v).trim() || null : null);

/** El estado de un centro, con el mismo vocabulario que la pestaña "Órdenes SAP". */
function bucketStatus(b: MwBucket): ResendBucket['status'] {
  if (b.sent === false) return 'not_sent';
  if (b.success !== true) return 'rejected';
  // Aceptado: el pedido existe. Sin entrega la mercadería no se despacha, y eso el
  // middleware NO lo cuenta como fallo — pero para BackOffice no es lo mismo.
  return texto(b.deliveryId) ? 'accepted' : 'accepted_no_dispatch';
}

/**
 * Traduce la respuesta del envío multi-centro.
 *
 * ⚠️ NO se mira el `success` de arriba para decidir si SAP aceptó: el middleware lo pone
 * en `false` en ramas que sólo avisan de ítems sin stock, aunque los pedidos se hayan
 * creado. La verdad está en los buckets, y por eso `accepted` se calcula de ahí.
 *
 * El fallo parcial llega como HTTP 200 —no como error— y deja pedidos YA CREADOS en SAP.
 * Ese es el caso que `partial` existe para hacer visible.
 */
function mapResend(body: MwSendResponse): ResendResult {
  const sap = body?.data?.sap ?? {};
  const skipped = sap.skipped === true;
  const crudos = Array.isArray(sap.buckets) ? sap.buckets : [];

  const buckets: ResendBucket[] = crudos.map((b) => ({
    centerCode: texto(b.centerCode) ?? '—',
    itemsCount: Number(b.itemsCount) || 0,
    status: bucketStatus(b),
    sapOrderNumber: texto(b.orderId),
    sapDispatchNumber: texto(b.deliveryId),
    error: b.error ?? null,
    sapMessages: Array.isArray(b.sapMessages) ? b.sapMessages : [],
  }));

  // "Salió bien" es tener pedido. La falta de ENTREGA se avisa aparte (el middleware la
  // da por buena, BackOffice no), pero no convierte el centro en un rechazo: el pedido
  // existe y reintentarlo lo duplicaría.
  const conPedido = buckets.filter((b) => b.status === 'accepted' || b.status === 'accepted_no_dispatch');
  const fallados = buckets.filter((b) => b.status === 'rejected' || b.status === 'not_sent');
  const accepted = !skipped && buckets.length > 0 && fallados.length === 0;

  return {
    accepted,
    // Algunos pedidos YA existen en SAP y otros no: reintentar la orden entera duplicaría
    // los que salieron.
    partial: conPedido.length > 0 && fallados.length > 0,
    skipped,
    skippedReason: sap.reason ?? null,
    buckets,
    totalBuckets: Number(sap.totalBuckets) || buckets.length,
    acceptedBuckets: conPedido.length,
    failedBuckets: fallados.length,
    error: sap.error ?? null,
    filteredItemsCount: Number(sap.filteredItemsCount) || 0,
    itemsSent: Number(sap.itemsSent) || 0,
    // El middleware deja la orden en revisión si algún centro falló, y la cierra sólo
    // cuando salieron todos.
    stillInReview: !accepted,
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

/**
 * El 404 no es del recurso: es de la RUTA. El middleware que está del otro lado no tiene
 * este endpoint.
 *
 * Los dos llegan como 404 y significan cosas opuestas: uno dice "esa orden no existe" —y
 * manda a buscar un dato— y el otro dice "este Middleware está viejo", que se arregla
 * con un deploy. Confundirlos hace perder el rato mirando la orden equivocada.
 *
 * Se reconoce porque Express contesta con su página HTML (`Cannot POST /ruta`) en vez del
 * JSON `{ success, error }` que devuelve el middleware cuando la ruta existe.
 */
function esRutaInexistente(err: unknown): boolean {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  return typeof data === 'string' && /Cannot (POST|PUT|GET|DELETE)\s/i.test(data);
}

/**
 * El middleware rechazó la llamada por credenciales: falta `MIDDLEWARE_API_KEY` o no
 * coincide con la suya.
 *
 * Importa distinguirlo porque **no se ejecutó nada del otro lado**. Metido en el cajón
 * de "no se pudo", un problema de configuración se lee como un problema de datos y manda
 * a buscar donde no hay nada.
 */
function esFaltaDeApiKey(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

/**
 * La llamada se cortó por tiempo, o nunca llegó a establecerse.
 *
 * `ECONNABORTED` (timeout de axios) y `ETIMEDOUT` son el caso **incierto**: la petición
 * salió y no sabemos qué pasó del otro lado. `ECONNREFUSED`/`ENOTFOUND` son lo
 * contrario — no llegó a ningún lado— y por eso no cuentan acá.
 */
function esTimeout(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === 'ECONNABORTED' || code === 'ETIMEDOUT';
}

/** Nunca se estableció la conexión: el middleware está caído o la URL es otra. */
function noLlego(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH';
}

/**
 * El Middleware del entorno no tiene el endpoint. No es un problema del dato ni de la
 * orden: es una versión vieja, y se arregla con un deploy.
 */
const MIDDLEWARE_VIEJO =
  'El Middleware de este entorno todavía no tiene esta operación: hay que actualizarlo a ' +
  '1.369.0 o superior (y correr su migración de BusinessOrderItems). No se modificó nada.';

/** Mensaje de credenciales, uno solo para todo el cliente. */
const SIN_API_KEY =
  'El Middleware rechazó la credencial de BackOffice: falta MIDDLEWARE_API_KEY o no coincide con la suya. ' +
  'La operación no se ejecutó.';

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
      if (esFaltaDeApiKey(status)) throw new ServiceUnavailableException(SIN_API_KEY);
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
   * RECHAZA la orden. Es terminal y no se deshace.
   *
   * Es POST y no PUT porque no edita un campo: cierra el documento. El motivo es
   * obligatorio del lado del middleware —el estado sólo dice "Rechazada", así que el
   * comentario del hilo es lo único que el vendedor va a poder leer— y por eso un
   * motivo vacío vuelve como `400`.
   */
  async rejectOrder(
    guid: string,
    body: { actorEmail: string; reasonNotes: string },
  ): Promise<RejectResult> {
    try {
      const res = await firstValueFrom(
        this.http.post<MwData<RejectResult>>(
          `${this.base()}${ORDER_PATH(guid)}/reject`,
          body,
          { headers: this.headers(), timeout: DEFAULT_TIMEOUT },
        ),
      );
      return res.data.data;
    } catch (err) {
      const status = httpStatus(err);
      if (esFaltaDeApiKey(status)) throw new ServiceUnavailableException(SIN_API_KEY);
      if (status === 404) throw new NotFoundException(mwMessage(err) ?? 'Orden no encontrada');
      // 409: salió de revisión —o ya la rechazaron— mientras se confirmaba.
      if (status === 409) {
        throw new ConflictException(mwMessage(err) ?? 'La orden ya no está en revisión');
      }
      if (status === 400) {
        throw new BadRequestException(mwMessage(err) ?? 'No se pudo rechazar la orden');
      }
      throw new ServiceUnavailableException('No se pudo rechazar la orden');
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
  /**
   * Las líneas CANCELADAS no viajan: el middleware las excluye al armar el contexto del
   * envío, así que este cliente no tiene que filtrar nada. Si quedaron todas canceladas,
   * responde `422` y cae en la rama de "no se creó ningún pedido".
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

      // CREDENCIALES. El middleware exige `x-api-key` para aceptar `asBackoffice: true`
      // y responde 401 SIN ejecutar nada. Va PRIMERO y con mensaje propio porque el
      // genérico de abajo —"verificá en SAP"— sería una mentira alarmante: manda a
      // buscar un pedido que nunca se intentó crear.
      if (esFaltaDeApiKey(status)) {
        throw new ServiceUnavailableException(
          `${message ?? SIN_API_KEY} No se creó ningún pedido en SAP.`,
        );
      }
      // El pedido ya existe en SAP: reenviarlo lo duplicaría. El middleware lo frena
      // sólo para BackOffice, y el mensaje explica qué hacer en su lugar.
      if (status === 409) {
        throw new ConflictException(message ?? 'La orden ya tiene un pedido creado en SAP');
      }
      if (status === 404) throw new NotFoundException(message ?? 'Orden no encontrada');
      // El middleware rechazó ANTES de llamar a SAP (faltan centros, sin stock, crédito
      // vencido): no hay nada creado y el motivo es accionable.
      if (status === 400 || status === 422) {
        throw new BadRequestException(
          `${message ?? 'La orden no está en condiciones de enviarse'} No se creó ningún pedido en SAP.`,
        );
      }
      // Nunca salió de acá: el middleware no respondió el saludo.
      if (noLlego(err)) {
        throw new ServiceUnavailableException(
          'No se pudo contactar al Middleware: el envío no salió y no se creó ningún pedido en SAP.',
        );
      }
      // INCIERTO, y sólo acá. La petición salió y se cortó por tiempo, o el middleware
      // falló a mitad de camino: puede haber pedidos creados. Es el único caso en que
      // reintentar a ciegas duplicaría, así que es el único que manda a mirar SAP.
      const porTiempo = esTimeout(err);
      throw new ServiceUnavailableException(
        (porTiempo
          ? 'El envío superó el tiempo de espera y SAP no confirmó el resultado.'
          : 'El Middleware no confirmó el envío.') +
          ' Verificá en SAP si se crearon pedidos antes de reintentar: con la orden partida por' +
          ' centro, puede haber salido una parte.',
      );
    }
  }

  /**
   * Catálogo de motivos de no venta, sólo los ACTIVOS.
   *
   * No cuelga del router de revisión: es un maestro del middleware que ya usa MobilityIA,
   * y por eso tampoco va con `x-api-key` obligatoria. Se lee tal cual para que BackOffice
   * y MobilityIA nombren los mismos motivos con los mismos códigos.
   */
  async listNoSaleReasons(): Promise<NoSaleReason[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<MwData<MwNoSaleReason[]>>(`${this.base()}${NO_SALE_REASONS_PATH}`, {
          headers: this.headers(),
          timeout: DEFAULT_TIMEOUT,
        }),
      );
      return (res.data.data ?? []).map((r) => ({
        code: String(r.code ?? '').trim(),
        label: String(r.label ?? '').trim() || String(r.code ?? '').trim(),
        sortOrder: r.sortOrder ?? null,
      }));
    } catch {
      throw new ServiceUnavailableException('El catálogo de motivos no está disponible');
    }
  }

  /**
   * CANCELA una línea con un motivo del catálogo: deja de viajar a SAP, pero sigue
   * viéndose con su motivo.
   *
   * El middleware valida el motivo contra el catálogo y frena la segunda cancelación de
   * la misma línea (`409`), para que un doble clic no pise el motivo original ni la firma
   * de quien canceló. Sus mensajes se propagan porque dicen exactamente qué pasó.
   */
  cancelItem(
    guid: string,
    itemGuid: string,
    body: { reasonCode: string; reasonNotes: string | null; actorEmail: string },
  ): Promise<ItemCancellationResult> {
    return this.postLine(guid, itemGuid, 'cancel', body, 'No se pudo cancelar la línea');
  }

  /**
   * REACTIVA una línea cancelada: vuelve a incluirse en el próximo envío.
   *
   * El middleware lo permite sólo si NO hubo un envío posterior a la cancelación — ese
   * envío ya salió sin la línea y las órdenes SAP creadas son un hecho consumado. Cuando
   * lo frena responde `409` con ese motivo, y es el mensaje que ve el usuario.
   */
  reactivateItem(
    guid: string,
    itemGuid: string,
    body: { actorEmail: string },
  ): Promise<ItemCancellationResult> {
    return this.postLine(guid, itemGuid, 'reactivate', body, 'No se pudo reactivar la línea');
  }

  private async putLine<T>(
    guid: string,
    itemGuid: string,
    field: 'destination' | 'center',
    body: object,
    unavailable: string,
  ): Promise<T> {
    return this.callLine('put', guid, itemGuid, field, body, unavailable);
  }

  /**
   * Cancelar y reactivar son POST y no PUT porque no editan un campo de la línea:
   * estampan un hecho (la cancelación) y lo deshacen.
   */
  private async postLine<T>(
    guid: string,
    itemGuid: string,
    field: 'cancel' | 'reactivate',
    body: object,
    unavailable: string,
  ): Promise<T> {
    return this.callLine('post', guid, itemGuid, field, body, unavailable);
  }

  private async callLine<T>(
    method: 'put' | 'post',
    guid: string,
    itemGuid: string,
    field: string,
    body: object,
    unavailable: string,
  ): Promise<T> {
    const url = `${this.base()}${ORDER_PATH(guid)}/items/${encodeURIComponent(itemGuid)}/${field}`;
    const options = { headers: this.headers(), timeout: DEFAULT_TIMEOUT };
    try {
      const res = await firstValueFrom(
        method === 'put'
          ? this.http.put<MwData<T>>(url, body, options)
          : this.http.post<MwData<T>>(url, body, options),
      );
      return res.data.data;
    } catch (err) {
      const status = httpStatus(err);
      const message = mwMessage(err);
      if (esFaltaDeApiKey(status)) throw new ServiceUnavailableException(SIN_API_KEY);
      // ANTES que el 404 de recurso: los dos son 404 y significan lo contrario.
      if (esRutaInexistente(err)) throw new ServiceUnavailableException(MIDDLEWARE_VIEJO);
      if (status === 404) throw new NotFoundException(message ?? 'La orden o la línea no existen');
      // 409 cubre varias cosas distintas —fuera de revisión, ya cancelada, ya enviada— y
      // el middleware las distingue en el mensaje. Pisarlo con uno genérico borraría el
      // único dato que le dice al usuario qué pasó.
      if (status === 409) {
        throw new ConflictException(message ?? 'La orden ya no está en revisión');
      }
      if (status === 400) throw new BadRequestException(message ?? 'Valor inválido');
      throw new ServiceUnavailableException(unavailable);
    }
  }
}
