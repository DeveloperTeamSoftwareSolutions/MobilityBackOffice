import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AvailableCebe, AvailableCompany } from './regions.types';
import { middlewareBase, middlewareHeaders } from '../common/middleware-request';

/** Item del maestro de CEBEs tal como lo publica el middleware (camelCase). */
interface ProfitCenterItem {
  profitCenterCode: string | null;
  profitCenterName: string | null;
}

/** Respuesta paginada estándar del middleware. */
interface ApiPaged<T> {
  success: boolean;
  data: T[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

// Los tres paths son RELATIVOS a `MIDDLEWARE_URL`, que ya incluye el prefijo `/api`
// (`http://<host>:6002/api`). Se verificaron contra el middleware en vivo: con esa base
// resuelven a `/api/mobility/...` y `/api/v2/mobility/...`. Ver docs/EXTERNAL_APIS.md.

/** Endpoint del middleware dueño de `VIEW_V2_ProfitCentersMobility` (ShowInMobility = 1). */
const PATH = '/v2/mobility/profit-centers';

/** Endpoint del middleware dueño de `Continents` + `ContinentProfitCenters`. */
const REGIONS_PATH = '/mobility/regions';

/** Endpoint del middleware que envuelve `[SAPServices].[dbo].[Companies]`. */
const COMPANIES_PATH = '/v2/mobility/companies';

/** Región tal como la publica el middleware. `cebeCount` null = no se pidió el conteo. */
export interface MwRegion {
  id: number;
  guid: string;
  timeStamp: number;
  serverTimestamp: number;
  deletedTimestamp: number | null;
  code: string | null;
  name: string;
  sortOrder: number;
  cebeCount: number | null;
}

/** Link (CEBE, sociedad) → región. */
export interface MwRegionLink {
  id: number;
  guid: string;
  guidContinents: string;
  profitCenterCode: string;
  profitCenterName: string | null;
  companyCode: string;
  companyName: string | null;
  source: string;
  createdBy: string | null;
  updatedBy: string | null;
  version: number;
}

/** Par (CEBE, sociedad) efectivo de un conjunto de regiones. */
export interface MwResolvedCebe {
  profitCenterCode: string;
  profitCenterName: string | null;
  companyCode: string;
  companyName: string | null;
}

/** Una fila del diagnóstico de CEBEs en varias regiones. */
export interface MwMultiRegionRow {
  profitCenterCode: string;
  profitCenterName: string | null;
  regionCode: string | null;
  regionName: string;
}

/** Sociedad del maestro v2 del middleware. */
interface MwCompany {
  companyCode: string | null;
  companyName: string | null;
  country: string | null;
}

/** Mapea la sociedad al DTO del módulo, con el mismo shape que devolvía la query local. */
export function mapCompany(item: MwCompany): AvailableCompany {
  return {
    code: (item.companyCode ?? '').trim(),
    name: item.companyName ?? null,
    country: item.country ?? null,
  };
}

/** Tope de `limit` del endpoint en modo normal (el middleware clampea igual). */
const PAGE_LIMIT = 200;

/** Tope de `limit` del endpoint en modo export (`export=1`). */
const EXPORT_LIMIT = 50000;

/**
 * Guarda del bucle que trae el catálogo completo. A EXPORT_LIMIT filas por página son
 * un millón de CEBEs — inalcanzable para el maestro real (cientos de filas). Existe solo
 * para que un `pagination.total` inconsistente no deje el bucle girando.
 */
const MAX_EXPORT_PAGES = 20;

/**
 * Orden explícito: es el mismo que hacían las queries que este cliente reemplaza
 * (`ORDER BY ProfitCenterCode`) y coincide con el default del middleware. Se manda igual
 * para no depender de ese default.
 */
const SORT = { sortBy: 'ProfitCenterCode', sortDir: 'ASC' };

/**
 * Mapea un item del middleware al DTO del módulo. El `trim` del código es deliberado:
 * es la clave de negocio del CEBE y se compara contra los links propios
 * (`ContinentProfitCenters`), donde puede venir con padding de CHAR/NCHAR.
 */
export function mapProfitCenter(item: ProfitCenterItem): AvailableCebe {
  return {
    code: (item.profitCenterCode ?? '').trim(),
    name: item.profitCenterName ?? null,
  };
}

/**
 * Cliente HTTP del módulo hacia MobilityMiddleWare. Cubre las TRES fuentes que necesita:
 *
 *   · `/v2/mobility/profit-centers` maestro de CEBEs (`VIEW_V2_ProfitCentersMobility`)
 *   · `/mobility/regions`          regiones (`Continents`) y sus links
 *                                  (`ContinentProfitCenters`)
 *   · `/v2/mobility/companies`     maestro de sociedades (envuelve el cross-DB a
 *                                  `[SAPServices].[dbo].[Companies]`)
 *
 * Las tres se leían por SQL directo. Traduce fallos de red a 503 para no romper el portal.
 */
@Injectable()
export class RegionsClient {
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

  private async get(params: Record<string, unknown>): Promise<ApiPaged<ProfitCenterItem>> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiPaged<ProfitCenterItem>>(`${this.base()}${PATH}`, {
          params,
          headers: this.headers(),
          timeout: 20000,
        }),
      );
      return res.data;
    } catch {
      throw new ServiceUnavailableException('El maestro de CEBEs no está disponible');
    }
  }

  /**
   * Búsqueda para el typeahead. El `search` es un LIKE `%term%` sobre
   * `ProfitCenterCode | ProfitCenterName` del lado del middleware — la misma semántica
   * que tenía la query local.
   */
  async searchProfitCenters(search: string, limit: number): Promise<AvailableCebe[]> {
    const body = await this.get({
      search: search || undefined,
      page: 1,
      limit: Math.min(Math.max(1, limit), PAGE_LIMIT),
      ...SORT,
    });
    return (body.data ?? []).map(mapProfitCenter);
  }

  /**
   * Catálogo completo (modo export). Lo usa el diagnóstico de CEBEs sin región, que
   * necesita el maestro entero para cruzarlo contra los links propios.
   * Pagina si hiciera falta: preferimos una request extra a truncar en silencio.
   */
  async getAllProfitCenters(): Promise<AvailableCebe[]> {
    const out: AvailableCebe[] = [];
    for (let page = 1; page <= MAX_EXPORT_PAGES; page++) {
      const body = await this.get({ export: 1, page, limit: EXPORT_LIMIT, ...SORT });
      const items = body.data ?? [];
      out.push(...items.map(mapProfitCenter));
      const total = body.pagination?.total;
      if (items.length === 0 || total == null || out.length >= total) break;
    }
    return out;
  }

  // ---- Regiones y links (`/mobility/regions`) -----------------------------

  /**
   * GET genérico contra el módulo de regiones. Devuelve `null` en 404 —es una respuesta
   * legítima ("no existe"), no una falla— y 503 para cualquier otra cosa.
   */
  private async getRegions<T>(path: string, params?: Record<string, unknown>): Promise<T | null> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data?: T }>(`${this.base()}${REGIONS_PATH}${path}`, {
          params,
          headers: this.headers(),
          timeout: 20000,
        }),
      );
      return res.data?.data ?? null;
    } catch (err) {
      if ((err as { response?: { status?: number } })?.response?.status === 404) return null;
      throw new ServiceUnavailableException('El servicio de regiones no está disponible');
    }
  }

  /** Listado paginado de regiones con su cantidad de CEBEs. */
  async listRegions(params: {
    page: number;
    limit: number;
    search: string;
    sortBy: string;
    sortDir: string;
  }): Promise<{ data: MwRegion[]; pagination: ApiPaged<MwRegion>['pagination'] }> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiPaged<MwRegion>>(`${this.base()}${REGIONS_PATH}`, {
          params: {
            page: params.page,
            limit: params.limit,
            search: params.search || undefined,
            sortBy: params.sortBy,
            sortDir: params.sortDir,
          },
          headers: this.headers(),
          timeout: 20000,
        }),
      );
      return { data: res.data?.data ?? [], pagination: res.data?.pagination };
    } catch {
      throw new ServiceUnavailableException('El servicio de regiones no está disponible');
    }
  }

  getRegionByGuid(guid: string): Promise<MwRegion | null> {
    return this.getRegions<MwRegion>(`/${encodeURIComponent(guid)}`);
  }

  getRegionByCode(code: string): Promise<MwRegion | null> {
    return this.getRegions<MwRegion>(`/by-code/${encodeURIComponent(code)}`);
  }

  async getRegionLinks(guid: string): Promise<MwRegionLink[]> {
    return (await this.getRegions<MwRegionLink[]>(`/${encodeURIComponent(guid)}/cebes`)) ?? [];
  }

  /**
   * Pares (CEBE, sociedad) de un conjunto de regiones. La expansión de agrupaciones
   * (CAYCAR → CA + CB) la hace el service: es configuración, no un dato de la base.
   */
  async resolveByCodes(codes: string[]): Promise<MwResolvedCebe[]> {
    if (codes.length === 0) return [];
    return (
      (await this.getRegions<MwResolvedCebe[]>('/resolve', { codes: codes.join(',') })) ?? []
    );
  }

  /** Códigos de CEBE con al menos un link activo (una punta del diff de "sin región"). */
  async getLinkedCebeCodes(): Promise<string[]> {
    return (await this.getRegions<string[]>('/links/codes')) ?? [];
  }

  /** CEBEs vinculados a más de una región, una fila por (CEBE, región). */
  async getMultiRegionLinks(): Promise<MwMultiRegionRow[]> {
    return (await this.getRegions<MwMultiRegionRow[]>('/links/multi-region')) ?? [];
  }

  /** Vincula un CEBE a la región para una sociedad (upsert del lado del middleware). */
  async linkCebe(
    guid: string,
    body: {
      profitCenterCode: string;
      companyCode: string;
      profitCenterName: string | null;
      source: string;
      actor: string;
    },
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`${this.base()}${REGIONS_PATH}/${encodeURIComponent(guid)}/cebes`, body, {
          headers: this.headers(),
          timeout: 20000,
        }),
      );
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) throw new NotFoundException('La región no existe');
      if (status === 400) {
        throw new BadRequestException(
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
            'Datos inválidos',
        );
      }
      throw new ServiceUnavailableException('No se pudo vincular el CEBE');
    }
  }

  /**
   * Desvincula. `false` si no había link activo — el middleware responde 404 y acá se
   * traduce a un booleano, que es lo que el service espera para decidir su propio 404.
   */
  async unlinkCebe(guid: string, code: string, companyCode: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.delete(
          `${this.base()}${REGIONS_PATH}/${encodeURIComponent(guid)}/cebes/${encodeURIComponent(code)}`,
          { params: { companyCode }, headers: this.headers(), timeout: 20000 },
        ),
      );
      return true;
    } catch (err) {
      if ((err as { response?: { status?: number } })?.response?.status === 404) return false;
      throw new ServiceUnavailableException('No se pudo desvincular el CEBE');
    }
  }

  // ---- Maestro de sociedades (`/v2/mobility/companies`) -------------------

  /**
   * Sociedades para el typeahead del ABM.
   *
   * Reemplaza un `SELECT TOP (n) ... FROM [SAPServices].[dbo].[Companies]` — el único
   * cross-DB que le quedaba a BackOffice. La vista `VIEW_V2_CompaniesMobility` que sirve
   * el middleware envuelve esa misma tabla, con el mismo search (código o nombre) y el
   * mismo orden por `CompanyCode`.
   */
  async searchCompanies(search: string, limit: number): Promise<AvailableCompany[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiPaged<MwCompany>>(`${this.base()}${COMPANIES_PATH}`, {
          params: {
            search: search || undefined,
            page: 1,
            limit: Math.min(Math.max(1, limit), PAGE_LIMIT),
            sortBy: 'CompanyCode',
            sortDir: 'ASC',
          },
          headers: this.headers(),
          timeout: 20000,
        }),
      );
      return (res.data?.data ?? []).map(mapCompany);
    } catch {
      throw new ServiceUnavailableException('El maestro de sociedades no está disponible');
    }
  }
}
