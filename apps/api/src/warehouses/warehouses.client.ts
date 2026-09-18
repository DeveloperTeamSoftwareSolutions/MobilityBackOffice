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
import { httpStatus } from '../common/middleware-error';
import {
  AddCustomerGroupResult,
  Center,
  CentersResult,
  CustomerGroupOption,
  GroupCustomersResult,
  Pagination,
  RemoveCustomerGroupResult,
  ReservedCustomer,
  ReservedCustomerGroup,
  Warehouse,
  WarehouseKey,
  WarehousesResult,
} from './warehouses.types';
import {
  mapAddGroupResult,
  mapGroupCustomer,
  mapGroupOption,
  mapRemoveGroupResult,
  mapReservedGroup,
  throwCustomerGroupError,
} from './customer-groups';

/** Respuesta paginada estándar del middleware. */
interface ApiPaged<T> {
  success: boolean;
  data: T[];
  pagination: Pagination;
}

/** Respuesta de lista simple del middleware. */
interface ApiList<T> {
  success: boolean;
  data: T[];
}

/** Espejo del tope del buscador de clientes del MW. */
const CUSTOMER_SEARCH_LIMIT = 20;

/** Raíz de los endpoints del middleware, relativa a `MIDDLEWARE_URL` (que ya trae `/api`). */
const ROOT = '/mobility/warehouse-customers';

/**
 * Cliente HTTP hacia MobilityMiddleWare (`/api/mobility/warehouse-customers/*`), dueño del
 * CRUD sobre `[SAPServices]`.
 *
 * El alcance (`companyCodes`) lo computa el service y se pasa acá: nunca sale del navegador.
 * Los fallos de red se traducen a 503 en castellano para no filtrar el error crudo de axios a
 * la pantalla.
 */
@Injectable()
export class WarehousesClient {
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

  /** Lista vacía = "no filtrar" (admin). El MW interpreta el parámetro ausente igual. */
  private static codes(companyCodes: string[]): string | undefined {
    return companyCodes.length > 0 ? companyCodes.join(',') : undefined;
  }

  private async request<T>(
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    {
      params,
      body,
      onError,
    }: {
      params?: Record<string, unknown>;
      body?: unknown;
      /** Traductor propio del error (los endpoints de grupos lo usan para leer `code`). */
      onError?: (err: unknown) => never;
    } = {},
  ): Promise<T> {
    try {
      const res = await firstValueFrom(
        this.http.request<T>({
          method,
          url: `${this.base()}${ROOT}${path}`,
          params,
          data: body,
          headers: this.headers(),
          timeout: 20000,
        }),
      );
      return res.data;
    } catch (err) {
      if (onError) onError(err);
      const status = httpStatus(err);
      if (status === 400) throw new BadRequestException('Datos inválidos');
      if (status === 404) throw new NotFoundException('Almacén o cliente no encontrado');
      throw new ServiceUnavailableException('El servicio de almacenes no está disponible');
    }
  }

  // ---- Lecturas ----

  async getCenters(
    companyCodes: string[],
    opts: {
      search?: string;
      page?: number;
      limit?: number;
      sortBy?: string;
      sortDir?: 'ASC' | 'DESC';
    },
  ): Promise<CentersResult> {
    const body = await this.request<ApiPaged<Center>>('get', '/centers', {
      params: {
        companyCodes: WarehousesClient.codes(companyCodes),
        search: opts.search || undefined,
        page: opts.page ?? 1,
        limit: opts.limit ?? 50,
        sortBy: opts.sortBy || undefined,
        sortDir: opts.sortDir || undefined,
      },
    });
    return { data: body.data, pagination: body.pagination };
  }

  async getWarehouses(
    companyCodes: string[],
    opts: {
      companyCode: string;
      centerCode: string;
      onlyRestricted?: boolean;
      search?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<WarehousesResult> {
    const body = await this.request<ApiPaged<Warehouse>>('get', '/warehouses', {
      params: {
        companyCodes: WarehousesClient.codes(companyCodes),
        companyCode: opts.companyCode,
        centerCode: opts.centerCode,
        onlyRestricted: opts.onlyRestricted ? 1 : undefined,
        search: opts.search || undefined,
        page: opts.page ?? 1,
        limit: opts.limit ?? 50,
      },
    });
    // `groupCount` llega desde MW 1.357.0; con uno anterior vale 0, que es lo cierto para él.
    const data = body.data.map((w) => ({ ...w, groupCount: Number(w.groupCount) || 0 }));
    return { data, pagination: body.pagination };
  }

  async getReservedCustomers(
    companyCodes: string[],
    key: WarehouseKey,
  ): Promise<ReservedCustomer[]> {
    const body = await this.request<ApiList<ReservedCustomer>>('get', '/reserved', {
      params: { companyCodes: WarehousesClient.codes(companyCodes), ...key },
    });
    return body.data;
  }

  async searchCustomers(q: string): Promise<ReservedCustomer[]> {
    const body = await this.request<ApiList<ReservedCustomer>>('get', '/customer-search', {
      params: { q, limit: CUSTOMER_SEARCH_LIMIT },
    });
    return body.data;
  }

  // ---- Escrituras de cliente (el alcance ya lo validó el service) ----

  async addCustomer(
    key: WarehouseKey,
    customerCode: string,
    actor: { userId?: string; userEmail?: string },
  ): Promise<void> {
    await this.request('post', '', { body: { ...key, customerCode, ...actor } });
  }

  async removeCustomer(key: WarehouseKey, customerCode: string): Promise<void> {
    await this.request('delete', '', { params: { ...key, customerCode } });
  }

  // ---- Grupos de clientes de SAP (MW ≥ 1.357.0) ----
  // Todos traducen el error por `code` (ver `throwCustomerGroupError`).

  async getReservedGroups(
    companyCodes: string[],
    key: WarehouseKey,
  ): Promise<ReservedCustomerGroup[]> {
    const body = await this.request<ApiList<Record<string, unknown>>>('get', '/groups', {
      params: { companyCodes: WarehousesClient.codes(companyCodes), ...key },
      onError: throwCustomerGroupError,
    });
    return (body.data ?? []).map(mapReservedGroup);
  }

  async searchCustomerGroups(
    companyCode: string,
    q: string,
    limit: number,
  ): Promise<CustomerGroupOption[]> {
    const body = await this.request<ApiList<Record<string, unknown>>>('get', '/group-search', {
      params: { companyCode, q: q || undefined, limit },
      onError: throwCustomerGroupError,
    });
    return (body.data ?? []).map(mapGroupOption);
  }

  async getGroupCustomers(opts: {
    companyCode: string;
    customerGroupCode: string;
    search?: string;
    page: number;
    limit: number;
  }): Promise<GroupCustomersResult> {
    const body = await this.request<ApiPaged<Record<string, unknown>>>(
      'get',
      '/groups/customers',
      {
        params: {
          companyCode: opts.companyCode,
          customerGroupCode: opts.customerGroupCode,
          search: opts.search || undefined,
          page: opts.page,
          limit: opts.limit,
        },
        onError: throwCustomerGroupError,
      },
    );
    return { data: (body.data ?? []).map(mapGroupCustomer), pagination: body.pagination };
  }

  async addCustomerGroup(
    key: WarehouseKey,
    customerGroupCode: string,
    actor: { userId?: string; userEmail?: string },
  ): Promise<AddCustomerGroupResult> {
    const body = await this.request<{ success: boolean; data: Record<string, unknown> }>(
      'post',
      '/groups',
      { body: { ...key, customerGroupCode, ...actor }, onError: throwCustomerGroupError },
    );
    return mapAddGroupResult(body.data ?? {});
  }

  async removeCustomerGroup(
    key: WarehouseKey,
    customerGroupCode: string,
  ): Promise<RemoveCustomerGroupResult> {
    const body = await this.request<{ success: boolean; data: Record<string, unknown> }>(
      'delete',
      '/groups',
      { params: { ...key, customerGroupCode }, onError: throwCustomerGroupError },
    );
    return mapRemoveGroupResult(body.data ?? {});
  }

  /** Libera un almacén: el MW borra sus reservas y lo vuelve a dejar disponible. */
  async setAvailability(key: WarehouseKey, restricted: boolean): Promise<void> {
    await this.request('put', '/availability', { body: { ...key, restricted } });
  }

  /**
   * Restringe o libera un CENTRO entero, para todos.
   *
   * ⚠️ No confundir con `setAvailability`, que es por ALMACÉN y nace de reservarlo a un
   * cliente. Acá no hay reserva de por medio: el CDI queda fuera de circulación.
   */
  async setCenterRestricted(input: {
    companyCode: string;
    centerCode: string;
    centerName?: string | null;
    restricted: boolean;
    reason?: string | null;
    userEmail?: string | null;
  }): Promise<void> {
    await this.request('put', '/center-restriction', { body: input });
  }
}
