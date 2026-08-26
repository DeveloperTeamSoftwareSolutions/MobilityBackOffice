import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { middlewareBase, middlewareHeaders } from '../common/middleware-request';
import {
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

/** Vocabulario VIGENTE de estados del tipo (no los que existen en los datos). */
const VOCABULARY_PATH = '/mobility/support/vocabulary';

/** Override de estado de cabecera. */
const OVERRIDE_PATH = (type: DocumentType, guid: string) =>
  `/mobility/support/documents/${type}/${encodeURIComponent(guid)}/status`;

/** Lineas del documento con su estado + el turno del gerente. */
const ITEMS_PATH = (type: DocumentType, guid: string) =>
  `/mobility/support/documents/${type}/${encodeURIComponent(guid)}/items`;

/** Estado de UNA linea. */
const ITEM_PATH = (type: DocumentType, guid: string, itemGuid: string) =>
  `${ITEMS_PATH(type, guid)}/${encodeURIComponent(itemGuid)}`;

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

interface MwVocabularyResponse {
  success: boolean;
  data: StatusOption[];
}

interface MwOverrideResponse {
  success: boolean;
  data: OverrideResult;
}

interface MwItemsResponse {
  success: boolean;
  data: DocumentItems;
}

interface MwItemStatusResponse {
  success: boolean;
  data: ItemStatusResult;
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
 * En la fase 1 cubre una sola fuente (la bitacora). Las fases 2 y 3 suman los
 * endpoints de override, que iran contra `/mobility/support/*` y exigiran
 * `MIDDLEWARE_API_KEY`.
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

  /**
   * Vocabulario VIGENTE de estados del tipo de documento.
   *
   * Distinto de `listStatuses`: ese devuelve los estados que EXISTEN en los datos
   * (para filtrar), este los que son VÁLIDOS (para elegir destino en el override).
   * Sale del middleware y no de una copia local para no duplicar el vocabulario y
   * quedar desincronizados.
   */
  async getVocabulary(type: DocumentType): Promise<StatusOption[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<MwVocabularyResponse>(`${this.base()}${VOCABULARY_PATH}`, {
          params: { type },
          headers: this.headers(),
          timeout: 20000,
        }),
      );
      return res.data.data;
    } catch {
      throw new ServiceUnavailableException(
        'El vocabulario de estados no está disponible',
      );
    }
  }

  /**
   * Fuerza el estado de un documento. Único camino de ESCRITURA del módulo.
   *
   * El middleware valida el vocabulario y exige motivo; acá se traduce su 400 a un
   * `BadRequestException` con el mismo mensaje, para que soporte vea por qué fue
   * rechazado en vez de un 503 genérico.
   */
  async overrideStatus(req: OverrideRequest): Promise<OverrideResult> {
    try {
      const res = await firstValueFrom(
        this.http.patch<MwOverrideResponse>(
          `${this.base()}${OVERRIDE_PATH(req.type, req.guid)}`,
          {
            toCode: req.toCode,
            reasonCode: req.reasonCode,
            reasonNotes: req.reasonNotes,
            actorEmail: req.actorEmail,
          },
          { headers: this.headers(), timeout: 20000 },
        ),
      );
      return res.data.data;
    } catch (err) {
      const status = httpStatus(err);
      if (status === 404) throw new NotFoundException('Documento no encontrado');
      if (status === 400) {
        throw new BadRequestException(
          errorBody(err)?.error ?? 'El cambio de estado fue rechazado',
        );
      }
      throw new ServiceUnavailableException(
        'No se pudo aplicar el cambio de estado',
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
   * Cambia el estado de una línea. Solo manda los campos de estado que vinieron:
   * lo que no se envía, no se toca. Precio y cantidad ni se incluyen.
   */
  async setItemStatus(req: ItemStatusRequest): Promise<ItemStatusResult> {
    const body: Record<string, unknown> = {
      reasonNotes: req.reasonNotes,
      actorEmail: req.actorEmail,
    };
    if (req.authorizationStatus !== undefined) {
      body.authorizationStatus = req.authorizationStatus;
    }
    if (req.sellerResponse !== undefined) body.sellerResponse = req.sellerResponse;
    if (req.authorizationRequired !== undefined) {
      body.authorizationRequired = req.authorizationRequired;
    }

    try {
      const res = await firstValueFrom(
        this.http.patch<MwItemStatusResponse>(
          `${this.base()}${ITEM_PATH(req.type, req.guid, req.itemGuid)}`,
          body,
          { headers: this.headers(), timeout: 20000 },
        ),
      );
      return res.data.data;
    } catch (err) {
      const status = httpStatus(err);
      if (status === 404) {
        throw new NotFoundException(
          errorBody(err)?.error ?? 'Documento o línea no encontrados',
        );
      }
      if (status === 400) {
        throw new BadRequestException(
          errorBody(err)?.error ?? 'El cambio de estado de la línea fue rechazado',
        );
      }
      throw new ServiceUnavailableException(
        'No se pudo aplicar el cambio en la línea',
      );
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
}
