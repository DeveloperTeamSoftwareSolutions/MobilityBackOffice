import { Injectable } from '@nestjs/common';
import {
  RegionsClient,
  MwRegion,
  MwRegionLink,
  MwResolvedCebe,
  MwMultiRegionRow,
} from './regions.client';
import {
  Region,
  RegionCebe,
  RegionDetail,
  AvailableCebe,
  AvailableCompany,
  ResolvedCebe,
  UnmappedCebe,
  MultiRegionCebe,
  LinkReconciliation,
} from './regions.types';

// Almacenamiento: la "región comercial" (negocio) son las filas de la tabla existente
// `Continents` (CA/CB/AN/NA), en SOLO LECTURA (no se modifica; la comparten otros
// reportes). Los CEBEs vinculados van en `ContinentProfitCenters`. Las agrupaciones
// (CAYCAR = CA+CB) se resuelven por configuración (region-groups.ts), no en la base.
// Ver docs/SPEC_BACKOFFICE_REGIONES.md.
//
// ⚠️ ESTE REPOSITORIO YA NO TOCA SQL SERVER. Las tres fuentes van por el middleware,
// que es el único componente que conecta a la base:
//
//   · maestro de CEBEs      `/mobility/profit-centers`
//   · regiones + links      `/mobility/regions`
//   · maestro de sociedades `/v2/mobility/companies`  (era el último cross-DB a
//                                                       [SAPServices].[dbo].[Companies])
//
// Ver docs/EXTERNAL_APIS.md. Lo que queda acá es la lógica de negocio de BackOffice:
// los diffs, el agrupado y la reconciliación del sync — que no son datos de nadie más.

// ---- Mappers del contrato del middleware (camelCase) ---------------------
// Siguen existiendo aunque el middleware ya devuelva camelCase: los DTOs del módulo NO
// son idénticos a los del middleware (`isGroup`, `guidRegions`, `cebeCount` no-nulo), y
// tener el ajuste en un solo lugar es lo que permite que un cambio del contrato se note
// acá y no repartido por el service.

export function mapRegion(row: MwRegion): Region {
  return {
    id: row.id,
    guid: row.guid ?? '',
    timeStamp: Number(row.timeStamp),
    serverTimestamp: Number(row.serverTimestamp),
    deletedTimestamp: row.deletedTimestamp != null ? Number(row.deletedTimestamp) : null,
    code: row.code ?? '',
    // Una región de la base NUNCA es una agrupación: las agrupaciones (CAYCAR) las
    // sintetiza el service desde configuración y no tienen fila.
    isGroup: false,
    name: row.name,
    sortOrder: row.sortOrder,
    // El middleware manda null cuando no se pidió el conteo (detalle por Guid). Acá el
    // DTO es no-nulo, y quien pide el detalle lo reemplaza por la cantidad real de links.
    cebeCount: row.cebeCount != null ? Number(row.cebeCount) : 0,
  };
}

export function mapRegionCebe(row: MwRegionLink): RegionCebe {
  return {
    id: row.id,
    guid: row.guid ?? '',
    // El middleware conserva el nombre de la columna (`GuidContinents`); el DTO del
    // módulo habla de regiones. La traducción vive acá y no se filtra al service.
    guidRegions: row.guidContinents ?? '',
    profitCenterCode: row.profitCenterCode,
    profitCenterName: row.profitCenterName ?? null,
    companyCode: row.companyCode,
    companyName: row.companyName ?? null,
    source: row.source,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    version: row.version,
  };
}

export function mapResolvedCebe(row: MwResolvedCebe): ResolvedCebe {
  return {
    profitCenterCode: row.profitCenterCode,
    profitCenterName: row.profitCenterName ?? null,
    companyCode: row.companyCode,
    companyName: row.companyName ?? null,
  };
}

/** Clave compuesta (CEBE, sociedad) para reconciliar links en el sync. */
export function linkKey(code: string, companyCode: string): string {
  return `${code}|${companyCode}`;
}

/** Descompone una clave `code|companyCode`. */
export function parseLinkKey(key: string): { code: string; companyCode: string } {
  const i = key.indexOf('|');
  return { code: key.slice(0, i), companyCode: key.slice(i + 1) };
}

/** Agrupa las filas planas (cebe × región) en CEBEs con su lista de regiones. */
export function groupMultiRegion(rows: MwMultiRegionRow[]): MultiRegionCebe[] {
  const byCode = new Map<string, MultiRegionCebe>();
  for (const r of rows) {
    let entry = byCode.get(r.profitCenterCode);
    if (!entry) {
      entry = {
        code: r.profitCenterCode,
        name: r.profitCenterName ?? null,
        regionCount: 0,
        regions: [],
      };
      byCode.set(r.profitCenterCode, entry);
    }
    entry.regions.push({ code: r.regionCode ?? '', name: r.regionName });
    entry.regionCount = entry.regions.length;
  }
  return [...byCode.values()];
}

/** Diff puro para el sync: qué CEBEs agregar y cuáles quitar de una región. */
export function reconcileLinks(current: string[], desired: string[]): LinkReconciliation {
  const cur = new Set(current);
  const des = new Set(desired);
  return {
    toAdd: desired.filter((c) => !cur.has(c)),
    toRemove: current.filter((c) => !des.has(c)),
  };
}

/**
 * Normaliza un código de CEBE para compararlo entre orígenes distintos (maestro que
 * sirve el middleware ↔ links propios en `ContinentProfitCenters`).
 *
 * Replica en Node la semántica que antes daba gratis la collation de SQL Server
 * (`Latin1_General_100_CI_AI_SC`) cuando el cruce se hacía con un `NOT EXISTS` dentro de
 * la misma base: **CI** (case-insensitive) → `toUpperCase`; **AI** (accent-insensitive) →
 * descomposición NFD + quitar diacríticos. El `trim` cubre el padding de CHAR/NCHAR.
 * Los códigos reales son alfanuméricos de SAP, pero la normalización se hace completa
 * para no depender de esa suposición.
 */
export function normalizeCebeCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * Diff puro: CEBEs del maestro que no tienen ningún link activo a una región. Reemplaza
 * al `NOT EXISTS` que antes cruzaba la vista contra `ContinentProfitCenters` en una sola
 * query — ya no es posible, porque el maestro vive del otro lado del middleware y la
 * tabla de links es propia. Preserva el orden del catálogo.
 */
export function diffUnmapped(catalog: AvailableCebe[], linkedCodes: string[]): UnmappedCebe[] {
  const linked = new Set(linkedCodes.map(normalizeCebeCode));
  return catalog.filter((c) => !linked.has(normalizeCebeCode(c.code)));
}

/**
 * Datos del módulo de Regiones comerciales por CEBE.
 *
 * TODO pasa por el middleware: regiones y links (`/mobility/regions`), maestro de CEBEs
 * (`/mobility/profit-centers`) y maestro de sociedades (`/v2/mobility/companies`). Este
 * repositorio ya no conoce SQL ni Prisma; lo que conserva es la lógica de negocio que no
 * le pertenece a nadie más: los diffs, el agrupado y la reconciliación del sync.
 */
@Injectable()
export class RegionsRepository {
  constructor(private readonly mw: RegionsClient) {}

  // ---- Regiones (Continents, solo lectura) ------------------------------
  async getAll({
    page = 1,
    limit = 50,
    search = '',
    sortBy = 'sortOrder',
    sortDir = 'ASC',
  }: {
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
    sortDir?: string;
  }): Promise<{
    data: Region[];
    pagination: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const body = await this.mw.listRegions({ page, limit, search, sortBy, sortDir });
    return {
      data: body.data.map(mapRegion),
      // El middleware ya calcula la paginación; se conservan `page`/`limit` pedidos por
      // si clampea el límite, para que el cliente no crea que pidió otra cosa.
      pagination: body.pagination ?? {
        total: body.data.length,
        page,
        limit,
        totalPages: 1,
      },
    };
  }

  async getByGuid(guid: string): Promise<RegionDetail | null> {
    const region = await this.mw.getRegionByGuid(guid);
    if (!region) return null;
    const cebes = await this.getCebes(guid);
    // `cebeCount` del detalle es la cantidad REAL de links que se acaban de traer, no el
    // conteo del listado: son la misma cifra, pero acá ya está el dato y no hace falta
    // confiar en dos fuentes.
    return { ...mapRegion(region), cebeCount: cebes.length, cebes };
  }

  async getByCode(code: string): Promise<Region | null> {
    const region = await this.mw.getRegionByCode(code);
    return region ? mapRegion(region) : null;
  }

  // ---- Links CEBE ↔ región ↔ sociedad -----------------------------------
  async getCebes(guidRegions: string): Promise<RegionCebe[]> {
    const links = await this.mw.getRegionLinks(guidRegions);
    return links.map(mapRegionCebe);
  }

  /** Pares (CEBE, sociedad) activos de una región — base del reconcile del sync. */
  async getActiveLinks(
    guidRegions: string,
  ): Promise<{ profitCenterCode: string; companyCode: string }[]> {
    const links = await this.mw.getRegionLinks(guidRegions);
    return links.map((l) => ({
      profitCenterCode: l.profitCenterCode,
      companyCode: l.companyCode,
    }));
  }

  /**
   * Vincula un CEBE a una región para una sociedad. El UPSERT (refrescar si ya existe,
   * insertar si no) lo resuelve el middleware en una sola llamada: hacerlo en dos desde
   * acá abriría una ventana entre el "¿existe?" y el alta.
   */
  linkCebe(
    guidRegions: string,
    code: string,
    companyCode: string,
    name: string | null,
    source: string,
    actor: string,
  ): Promise<void> {
    return this.mw.linkCebe(guidRegions, {
      profitCenterCode: code,
      companyCode,
      profitCenterName: name,
      source,
      actor,
    });
  }

  unlinkCebe(guidRegions: string, code: string, companyCode: string): Promise<boolean> {
    return this.mw.unlinkCebe(guidRegions, code, companyCode);
  }

  // ---- Resolver + maestros + diagnósticos -------------------------------
  /**
   * Pares (CEBE, sociedad) efectivos de un conjunto de regiones (por Code). Para una
   * agrupación como CAYCAR el service pasa sus miembros (['CA','CB']) y el middleware
   * hace la unión distinct. Cada CEBE queda limitado a las sociedades vinculadas en esas
   * regiones (así un transversal como "Duwest Banano" no arrastra sociedades de otra).
   */
  async resolveCebesByCodes(codes: string[]): Promise<ResolvedCebe[]> {
    if (codes.length === 0) return [];
    const rows = await this.mw.resolveByCodes(codes);
    return rows.map(mapResolvedCebe);
  }

  /**
   * Maestro de sociedades (typeahead del ABM). Vía middleware
   * (`/v2/mobility/companies`), que envuelve `[SAPServices].[dbo].[Companies]` — era el
   * último cross-DB que le quedaba a BackOffice.
   */
  getAvailableCompanies(search: string, limit: number): Promise<AvailableCompany[]> {
    return this.mw.searchCompanies(search, limit);
  }

  /**
   * Maestro de CEBEs (typeahead). Vía middleware (`/mobility/profit-centers`), que lee
   * `VIEW_ProfitCentersMobility` (ShowInMobility = 1) con el mismo search (LIKE `%term%`
   * sobre código o nombre) y el mismo orden (`ProfitCenterCode ASC`).
   */
  getAvailableCebes(search: string, limit: number): Promise<AvailableCebe[]> {
    return this.mw.searchProfitCenters(search, limit);
  }

  /**
   * CEBEs del maestro que no están vinculados a ninguna región (gap de carga).
   *
   * El cruce no se puede resolver en una sola query: son dos endpoints distintos del
   * middleware. Se traen las dos puntas en paralelo y el diff se hace en Node
   * (`diffUnmapped`), normalizando los códigos para replicar la collation CI_AI que
   * antes daba gratis el `NOT EXISTS` dentro de la misma base.
   */
  async getUnmappedCebes(): Promise<UnmappedCebe[]> {
    const [catalog, linkedCodes] = await Promise.all([
      this.mw.getAllProfitCenters(),
      this.mw.getLinkedCebeCodes(),
    ]);
    return diffUnmapped(catalog, linkedCodes);
  }

  /** CEBEs vinculados a más de una región (posible solapamiento a revisar). */
  async getMultiRegionCebes(): Promise<MultiRegionCebe[]> {
    const rows = await this.mw.getMultiRegionLinks();
    return groupMultiRegion(rows);
  }
}
