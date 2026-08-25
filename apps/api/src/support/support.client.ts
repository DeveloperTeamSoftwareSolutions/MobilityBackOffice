import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { middlewareBase, middlewareHeaders } from '../common/middleware-request';
import {
  DocumentsQuery,
  DocumentTimeline,
  DocumentType,
  PagedDocuments,
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
}
