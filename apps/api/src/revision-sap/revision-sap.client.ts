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
  DestinationChangeResult,
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

  /**
   * Cambia el destino de una línea. El middleware valida que el destino sea del área
   * de la orden y que la orden siga en revisión; sus rechazos se devuelven con su
   * mensaje, porque le dicen al usuario qué corregir.
   */
  async changeItemDestination(
    guid: string,
    itemGuid: string,
    body: { destinationCode: string; actorEmail: string; reasonNotes: string | null },
  ): Promise<DestinationChangeResult> {
    try {
      const res = await firstValueFrom(
        this.http.put<MwData<DestinationChangeResult>>(
          `${this.base()}${ORDER_PATH(guid)}/items/${encodeURIComponent(itemGuid)}/destination`,
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
      if (status === 400) throw new BadRequestException(message ?? 'Destino inválido');
      throw new ServiceUnavailableException('No se pudo guardar el destino');
    }
  }
}
