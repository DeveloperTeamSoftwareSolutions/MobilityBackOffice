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
  TimelineQuery,
} from './support.types';

/**
 * Endpoint del middleware dueño de la bitacora unificada. Relativo a `MIDDLEWARE_URL`,
 * que ya incluye el prefijo `/api`. Funde en una sola lista los hechos que hoy viven
 * repartidos en varias tablas (cabecera, `Auditories`, decisiones por item, pagos,
 * corridas del motor de credito, resoluciones del gerente).
 *
 * Es SOLO LECTURA y —a diferencia de casi todo el resto del middleware— **no esta
 * scopeado por vendedor**: acepta el numero del documento sin exigir el email del
 * dueño. Eso es justamente lo que lo hace utilizable por soporte, que no es el
 * vendedor de nada. Ver docs/SPEC_CONSOLA_SOPORTE.md §6.
 */
const TIMELINE_PATH = '/mobility/document-timeline';

/**
 * Router de soporte del middleware. Expone los documentos SIN el scope de vendedor
 * que limita al resto de los listados (todos exigen el email del dueño y le
 * devolverian vacio a soporte). Va protegido con `requireApiKey` del lado del
 * middleware.
 */
const DOCUMENTS_PATH = '/mobility/support/documents';
const STATUSES_PATH = '/mobility/support/statuses';

/** Documentos cuyo estado guardado no coincide con el calculado. */
const INCONSISTENT_PATH = '/mobility/support/diagnostics/inconsistent-status';

/** Acciones con intencion: escriben hechos, nunca el estado. */
const ACTIONS_PATH = (type: DocumentType, guid: string) =>
  `/mobility/support/documents/${type}/${encodeURIComponent(guid)}/actions`;

/** Lineas del documento con su estado + el turno del gerente + el plazo de pago. */
const ITEMS_PATH = (type: DocumentType, guid: string) =>
  `/mobility/support/documents/${type}/${encodeURIComponent(guid)}/items`;

/**
 * Decisiones sobre una linea. La linea se identifica por CODIGO DE PRODUCTO y no por
 * su Guid porque asi la identifica el flujo del middleware: traducir aca seria
 * inventar una segunda forma de nombrar la misma cosa.
 */
const ITEM_DECIDE_PATH = (type: DocumentType, guid: string, productCode: string) =>
  `${ITEMS_PATH(type, guid)}/${encodeURIComponent(productCode)}/decide`;

const ITEM_RESPOND_PATH = (type: DocumentType, guid: string, productCode: string) =>
  `${ITEMS_PATH(type, guid)}/${encodeURIComponent(productCode)}/respond`;

/** Decisiones sobre el plazo de pago pedido en la cabecera. */
const PAYMENT_DECIDE_PATH = (type: DocumentType, guid: string) =>
  `/mobility/support/documents/${type}/${encodeURIComponent(guid)}/payment-terms/decide`;

const PAYMENT_RESPOND_PATH = (type: DocumentType, guid: string) =>
  `/mobility/support/documents/${type}/${encodeURIComponent(guid)}/payment-terms/respond`;

/** Recalculo de la cabecera a partir de los hechos. */
const RECOMPUTE_PATH = (type: DocumentType, guid: string) =>
  `/mobility/support/documents/${type}/${encodeURIComponent(guid)}/recompute`;

/** Que estado daria el recalculo hoy, sin escribir. */
const PROJECTED_PATH = (type: DocumentType, guid: string) =>
  `/mobility/support/documents/${type}/${encodeURIComponent(guid)}/projected-status`;

/** Respuesta del middleware para la bitacora. */
interface MwTimelineResponse {
  success: boolean;
  data: DocumentTimeline;
}

/** Respuesta paginada estandar del middleware. */
interface MwPagedResponse {
  success: boolean;
  data: PagedDocuments['data'];
  pagination: PagedDocuments['pagination'];
}

interface MwStatusesResponse {
  success: boolean;
  data: StatusCount[];
}

interface MwItemsResponse {
  success: boolean;
  data: DocumentItems;
}

/** Las cuatro decisiones devuelven la misma forma. */
interface MwDecisionResponse {
  success: boolean;
  data: DecisionResult;
}

interface MwRecomputeResponse {
  success: boolean;
  data: RecomputeResult;
}

interface MwProjectedResponse {
  success: boolean;
  data: ProjectedStatus;
}

interface MwInconsistentResponse extends InconsistentReport {
  success: boolean;
}

interface MwActionsResponse {
  success: boolean;
  data: DocumentActions;
}

interface MwActionResultResponse {
  success: boolean;
  data: ActionResult;
}

/** Mensaje de error que devuelve el middleware, si lo trae. */
function errorBody(err: unknown): { error?: string; code?: string } | undefined {
  return (err as { response?: { data?: { error?: string; code?: string } } })
    ?.response?.data;
}

function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

/**
 * Cliente HTTP de la consola de soporte hacia MobilityMiddleWare.
 *
 * Todo lo que escribe va contra `/mobility/support/*`, que del lado del middleware
 * exige `MIDDLEWARE_API_KEY`. Ninguna llamada pide un estado destino: el estado es
 * un valor calculado y solo se mueve como consecuencia de un hecho.
 */
@Injectable()
export class SupportClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private base(): string {
    return middlewareBase(this.config);
  }

  /** Incluye `x-source-app` para que el middleware pueda atribuir la llamada. */
  private headers(): Record<string, string> {
    return middlewareHeaders(this.config);
  }

  /**
   * Bitacora completa de un documento por su numero.
   *
   * Traduce el 404 del middleware a `NotFoundException` (el documento no existe) y
   * cualquier otro fallo a 503, para no exponer el detalle del middleware al cliente
   * ni romper el portal cuando el middleware esta caido.
   */
  async getTimeline(query: TimelineQuery): Promise<DocumentTimeline> {
    const params: Record<string, string> = {
      docType: query.type,
      number: query.number,
    };
    if (query.includeViews) params.includeViews = '1';
    if (query.includeMessages) params.includeMessages = '1';

    try {
      const res = await firstValueFrom(
        this.http.get<MwTimelineResponse>(`${this.base()}${TIMELINE_PATH}`, {
          params,
          headers: this.headers(),
          timeout: 20000,
        }),
      );
      return res.data.data;
    } catch (err) {
      if (httpStatus(err) === 404) {
        throw new NotFoundException('Documento no encontrado');
      }
      throw new ServiceUnavailableException(
        'La bitácora de documentos no está disponible',
      );
    }
  }

  /** Listado paginado de documentos, sin scope de vendedor. */
  async listDocuments(query: DocumentsQuery): Promise<PagedDocuments> {
    try {
      const res = await firstValueFrom(
        this.http.get<MwPagedResponse>(`${this.base()}${DOCUMENTS_PATH}`, {
          params: {
            type: query.type,
            page: query.page,
            limit: query.limit,
            search: query.search || undefined,
            status: query.status || undefined,
            sortBy: query.sortBy,
            sortDir: query.sortDir,
          },
          headers: this.headers(),
          timeout: 20000,
        }),
      );
      return { data: res.data.data, pagination: res.data.pagination };
    } catch {
      throw new ServiceUnavailableException(
        'El listado de documentos no está disponible',
      );
    }
  }

  /**
   * Estados presentes en los datos, con su conteo. Salen de la base y no de una
   * lista fija: si el flujo agrega un estado, el filtro lo refleja sin tocar código.
   */
  async listStatuses(type: DocumentType): Promise<StatusCount[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<MwStatusesResponse>(`${this.base()}${STATUSES_PATH}`, {
          params: { type },
          headers: this.headers(),
          timeout: 20000,
        }),
      );
      return res.data.data;
    } catch {
      throw new ServiceUnavailableException(
        'Los estados de documentos no están disponibles',
      );
    }
  }

  /** Lineas del documento con su estado y el turno del gerente. */
  async listItems(type: DocumentType, guid: string): Promise<DocumentItems> {
    try {
      const res = await firstValueFrom(
        this.http.get<MwItemsResponse>(`${this.base()}${ITEMS_PATH(type, guid)}`, {
          headers: this.headers(),
          timeout: 20000,
        }),
      );
      return res.data.data;
    } catch (err) {
      if (httpStatus(err) === 404) throw new NotFoundException('Documento no encontrado');
      throw new ServiceUnavailableException('Las líneas del documento no están disponibles');
    }
  }

  /**
   * Traduce el error del middleware para las cuatro decisiones.
   *
   * El 409 merece su propio caso: no es un pedido mal formado sino un choque con
   * otro gerente que tiene tomada la revisión. Mostrarlo como 400 haría pensar que
   * hay algo que corregir en el formulario, cuando lo único que hay que hacer es
   * esperar (el bloqueo vence solo por inactividad).
   */
  private decisionError(err: unknown, accion: string): never {
    const status = httpStatus(err);
    const detalle = errorBody(err)?.error;
    if (status === 404) {
      throw new NotFoundException(detalle ?? 'Documento no encontrado');
    }
    if (status === 409) {
      throw new ConflictException(
        detalle ?? 'Otro gerente tiene tomada la revisión de este documento',
      );
    }
    if (status === 400) {
      throw new BadRequestException(detalle ?? `El flujo rechazó ${accion}`);
    }
    throw new ServiceUnavailableException(`No se pudo aplicar ${accion}`);
  }

  /**
   * Decisión del GERENTE sobre una línea, ejecutada por soporte a su pedido.
   *
   * `proposedPrice` solo viaja en la contraoferta; el middleware lo exige en ese
   * caso y lo ignora en los otros dos. El motivo es obligatorio siempre acá aunque
   * el flujo solo lo exija al rechazar: es lo que deja registrado quién lo pidió.
   */
  async decideItem(req: ItemDecisionRequest): Promise<DecisionResult> {
    try {
      const res = await firstValueFrom(
        this.http.post<MwDecisionResponse>(
          `${this.base()}${ITEM_DECIDE_PATH(req.type, req.guid, req.productCode)}`,
          {
            status: req.status,
            proposedPrice: req.proposedPrice ?? null,
            reasonNotes: req.reasonNotes,
            actorEmail: req.actorEmail,
          },
          { headers: this.headers(), timeout: 20000 },
        ),
      );
      return res.data.data;
    } catch (err) {
      this.decisionError(err, 'la decisión sobre la línea');
    }
  }

  /** Respuesta del VENDEDOR a una contraoferta de línea, ejecutada por soporte. */
  async respondItem(req: ItemResponseRequest): Promise<DecisionResult> {
    try {
      const res = await firstValueFrom(
        this.http.post<MwDecisionResponse>(
          `${this.base()}${ITEM_RESPOND_PATH(req.type, req.guid, req.productCode)}`,
          {
            action: req.action,
            reasonNotes: req.reasonNotes,
            actorEmail: req.actorEmail,
          },
          { headers: this.headers(), timeout: 20000 },
        ),
      );
      return res.data.data;
    } catch (err) {
      this.decisionError(err, 'la respuesta a la contraoferta');
    }
  }

  /**
   * Decisión del GERENTE sobre el plazo de pago pedido en la cabecera.
   *
   * El vocabulario no es el de las líneas: 'observed' ES la contraoferta y `value`
   * el plazo que se contrapropone.
   */
  async decidePaymentTerms(req: PaymentDecisionRequest): Promise<DecisionResult> {
    try {
      const res = await firstValueFrom(
        this.http.post<MwDecisionResponse>(
          `${this.base()}${PAYMENT_DECIDE_PATH(req.type, req.guid)}`,
          {
            status: req.status,
            value: req.value ?? null,
            reasonNotes: req.reasonNotes,
            actorEmail: req.actorEmail,
          },
          { headers: this.headers(), timeout: 20000 },
        ),
      );
      return res.data.data;
    } catch (err) {
      this.decisionError(err, 'la decisión sobre el plazo de pago');
    }
  }

  /** Respuesta del VENDEDOR a una contraoferta de plazo de pago. */
  async respondPaymentTerms(req: PaymentResponseRequest): Promise<DecisionResult> {
    try {
      const res = await firstValueFrom(
        this.http.post<MwDecisionResponse>(
          `${this.base()}${PAYMENT_RESPOND_PATH(req.type, req.guid)}`,
          {
            action: req.action,
            reasonNotes: req.reasonNotes,
            actorEmail: req.actorEmail,
          },
          { headers: this.headers(), timeout: 20000 },
        ),
      );
      return res.data.data;
    } catch (err) {
      this.decisionError(err, 'la respuesta al plazo de pago');
    }
  }

  /** Recalcula la cabecera a partir de los hechos. No cambia nada por sí mismo. */
  async recompute(type: DocumentType, guid: string): Promise<RecomputeResult> {
    try {
      const res = await firstValueFrom(
        this.http.post<MwRecomputeResponse>(
          `${this.base()}${RECOMPUTE_PATH(type, guid)}`,
          {},
          { headers: this.headers(), timeout: 20000 },
        ),
      );
      return res.data.data;
    } catch (err) {
      if (httpStatus(err) === 404) throw new NotFoundException('Documento no encontrado');
      throw new ServiceUnavailableException('No se pudo recalcular el documento');
    }
  }

  /**
   * Estado que el recálculo daría hoy. Solo lectura: no escribe ni corre el motor
   * de crédito, así que es una estimación (ver el comentario del middleware).
   */
  async getProjectedStatus(
    type: DocumentType,
    guid: string,
  ): Promise<ProjectedStatus> {
    try {
      const res = await firstValueFrom(
        this.http.get<MwProjectedResponse>(
          `${this.base()}${PROJECTED_PATH(type, guid)}`,
          { headers: this.headers(), timeout: 20000 },
        ),
      );
      return res.data.data;
    } catch (err) {
      if (httpStatus(err) === 404) throw new NotFoundException('Documento no encontrado');
      throw new ServiceUnavailableException(
        'No se pudo calcular el estado del documento',
      );
    }
  }

  /** Documentos con el estado desfasado respecto de sus datos. */
  async listInconsistent(
    type: DocumentType,
    limit: number,
  ): Promise<InconsistentReport> {
    try {
      const res = await firstValueFrom(
        this.http.get<MwInconsistentResponse>(
          `${this.base()}${INCONSISTENT_PATH}`,
          { params: { type, limit }, headers: this.headers(), timeout: 60000 },
        ),
      );
      return {
        data: res.data.data,
        scanned: res.data.scanned,
        total: res.data.total,
        truncated: res.data.truncated,
      };
    } catch {
      throw new ServiceUnavailableException(
        'El diagnóstico de estados no está disponible',
      );
    }
  }

  /** Acciones con intención disponibles para el documento, y por qué no las otras. */
  async listActions(
    type: DocumentType,
    guid: string,
  ): Promise<DocumentActions> {
    try {
      const res = await firstValueFrom(
        this.http.get<MwActionsResponse>(
          `${this.base()}${ACTIONS_PATH(type, guid)}`,
          { headers: this.headers(), timeout: 20000 },
        ),
      );
      return res.data.data;
    } catch (err) {
      if (httpStatus(err) === 404) throw new NotFoundException('Documento no encontrado');
      throw new ServiceUnavailableException('Las acciones no están disponibles');
    }
  }

  /** Ejecuta una acción. Escribe hechos; el estado lo calcula el sistema. */
  async runAction(
    type: DocumentType,
    guid: string,
    action: string,
    reasonNotes: string,
    actorEmail: string | null,
  ): Promise<ActionResult> {
    try {
      const res = await firstValueFrom(
        this.http.post<MwActionResultResponse>(
          `${this.base()}${ACTIONS_PATH(type, guid)}/${encodeURIComponent(action)}`,
          { reasonNotes, actorEmail },
          { headers: this.headers(), timeout: 30000 },
        ),
      );
      return res.data.data;
    } catch (err) {
      const status = httpStatus(err);
      if (status === 404) throw new NotFoundException('Documento no encontrado');
      if (status === 400) {
        throw new BadRequestException(
          errorBody(err)?.error ?? 'La acción fue rechazada',
        );
      }
      throw new ServiceUnavailableException('No se pudo ejecutar la acción');
    }
  }
}
