import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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

/** Collation canónica para comparar/mostrar códigos entre BDs (Mobility ↔ SAPServices). */
const COL = Prisma.raw('COLLATE Latin1_General_100_CI_AI_SC');

// Almacenamiento: la "región comercial" (negocio) son las filas de la tabla existente
// `Continents` (CA/CB/AN/NA), en SOLO LECTURA (no se modifica; la comparten otros
// reportes). Los CEBEs vinculados van en `ContinentProfitCenters` (tabla propia de MM).
// Las agrupaciones (CAYCAR = CA+CB) se resuelven por configuración (region-groups.ts),
// no en la base. Ver docs/SPEC_BACKOFFICE_REGIONES.md.

/** Filtro de no-eliminado, reutilizable en las queries. */
const ACTIVE = Prisma.sql`(DeletedTimestamp IS NULL OR DeletedTimestamp = 0)`;

/** Campos permitidos para ordenar el listado (whitelist anti-inyección). */
const SORTABLE: Record<string, string> = {
  code: 'Code',
  name: 'Name',
  sortOrder: 'SortOrder',
  serverTimestamp: 'ServerTimestamp',
  cebeCount: 'CebeCount',
};

// ---- Row shapes (PascalCase de SQL) --------------------------------------
interface RegionRow {
  Id: number;
  Guid: string;
  TimeStamp: bigint | number;
  ServerTimestamp: bigint | number;
  DeletedTimestamp: bigint | number | null;
  Code: string | null;
  Name: string;
  SortOrder: number;
  CebeCount: number | bigint | null;
}
interface CebeRow {
  Id: number;
  Guid: string;
  GuidContinents: string;
  ProfitCenterCode: string;
  ProfitCenterName: string | null;
  CompanyCode: string;
  CompanyName: string | null;
  Source: string;
  CreatedBy: string | null;
  UpdatedBy: string | null;
  Version: number;
}
interface CebeCatalogRow {
  ProfitCenterCode: string;
  ProfitCenterName: string | null;
}
interface ResolvedRow {
  ProfitCenterCode: string;
  ProfitCenterName: string | null;
  CompanyCode: string;
  CompanyName: string | null;
}
interface CompanyRow {
  CompanyCode: string;
  CompanyName: string | null;
  Country: string | null;
}
interface MultiRow {
  ProfitCenterCode: string;
  ProfitCenterName: string | null;
  RegionCode: string | null;
  RegionName: string;
}

// ---- Mappers puros (testeables) ------------------------------------------
export function mapRegion(row: RegionRow): Region {
  return {
    id: row.Id,
    guid: row.Guid ? row.Guid.trim() : '',
    timeStamp: Number(row.TimeStamp),
    serverTimestamp: Number(row.ServerTimestamp),
    deletedTimestamp: row.DeletedTimestamp ? Number(row.DeletedTimestamp) : null,
    code: row.Code ?? '',
    name: row.Name,
    sortOrder: row.SortOrder,
    isGroup: false,
    cebeCount: row.CebeCount != null ? Number(row.CebeCount) : 0,
  };
}

export function mapRegionCebe(row: CebeRow): RegionCebe {
  return {
    id: row.Id,
    guid: row.Guid ? row.Guid.trim() : '',
    guidRegions: row.GuidContinents ? row.GuidContinents.trim() : '',
    profitCenterCode: row.ProfitCenterCode,
    profitCenterName: row.ProfitCenterName ?? null,
    companyCode: row.CompanyCode,
    companyName: row.CompanyName ?? null,
    source: row.Source,
    createdBy: row.CreatedBy ?? null,
    updatedBy: row.UpdatedBy ?? null,
    version: row.Version,
  };
}

export function mapAvailableCebe(row: CebeCatalogRow): AvailableCebe {
  return { code: row.ProfitCenterCode, name: row.ProfitCenterName ?? null };
}

export function mapAvailableCompany(row: CompanyRow): AvailableCompany {
  return { code: row.CompanyCode, name: row.CompanyName ?? null, country: row.Country ?? null };
}

export function mapResolvedCebe(row: ResolvedRow): ResolvedCebe {
  return {
    profitCenterCode: row.ProfitCenterCode,
    profitCenterName: row.ProfitCenterName ?? null,
    companyCode: row.CompanyCode,
    companyName: row.CompanyName ?? null,
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
export function groupMultiRegion(rows: MultiRow[]): MultiRegionCebe[] {
  const byCode = new Map<string, MultiRegionCebe>();
  for (const r of rows) {
    let entry = byCode.get(r.ProfitCenterCode);
    if (!entry) {
      entry = {
        code: r.ProfitCenterCode,
        name: r.ProfitCenterName ?? null,
        regionCount: 0,
        regions: [],
      };
      byCode.set(r.ProfitCenterCode, entry);
    }
    entry.regions.push({ code: r.RegionCode ?? '', name: r.RegionName });
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
 * Datos del módulo de Regiones comerciales por CEBE. Regiones = filas de `Continents`
 * (solo lectura); links en `ContinentProfitCenters` (tabla propia); maestro de CEBEs
 * vía `VIEW_ProfitCentersMobility`. Queries parametrizadas, soft-delete aware.
 */
@Injectable()
export class RegionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Regiones (lectura de Continents) ---------------------------------
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
  }): Promise<{ data: Region[]; pagination: { total: number; page: number; limit: number; totalPages: number } }> {
    const offset = (page - 1) * limit;
    const sortCol = SORTABLE[sortBy] ?? 'SortOrder';
    const dir = sortDir === 'DESC' ? 'DESC' : 'ASC';
    const term = search ? `%${search}%` : null;
    const searchSql = term
      ? Prisma.sql`AND (r.Code LIKE ${term} OR r.Name LIKE ${term})`
      : Prisma.empty;

    const countRows = await this.prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
      SELECT COUNT(*) AS total FROM dbo.Continents r WHERE ${ACTIVE} ${searchSql}`);
    const total = Number(countRows[0]?.total ?? 0);

    const rows = await this.prisma.$queryRaw<RegionRow[]>(Prisma.sql`
      SELECT r.Id, r.Guid, r.TimeStamp, r.ServerTimestamp, r.DeletedTimestamp,
             r.Code, r.Name, r.SortOrder,
             (SELECT COUNT(*) FROM dbo.ContinentProfitCenters c
               WHERE c.GuidContinents = r.Guid
                 AND (c.DeletedTimestamp IS NULL OR c.DeletedTimestamp = 0)) AS CebeCount
      FROM dbo.Continents r
      WHERE ${ACTIVE} ${searchSql}
      ORDER BY ${Prisma.raw(sortCol)} ${Prisma.raw(dir)}
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`);

    return {
      data: rows.map(mapRegion),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getByGuid(guid: string): Promise<RegionDetail | null> {
    const rows = await this.prisma.$queryRaw<RegionRow[]>(Prisma.sql`
      SELECT r.Id, r.Guid, r.TimeStamp, r.ServerTimestamp, r.DeletedTimestamp,
             r.Code, r.Name, r.SortOrder, NULL AS CebeCount
      FROM dbo.Continents r
      WHERE r.Guid = ${guid} AND ${ACTIVE}`);
    if (rows.length === 0) return null;
    const cebes = await this.getCebes(guid);
    return { ...mapRegion(rows[0]), cebeCount: cebes.length, cebes };
  }

  async getByCode(code: string): Promise<Region | null> {
    const rows = await this.prisma.$queryRaw<RegionRow[]>(Prisma.sql`
      SELECT r.Id, r.Guid, r.TimeStamp, r.ServerTimestamp, r.DeletedTimestamp,
             r.Code, r.Name, r.SortOrder, NULL AS CebeCount
      FROM dbo.Continents r
      WHERE r.Code = ${code} AND ${ACTIVE}`);
    return rows.length ? mapRegion(rows[0]) : null;
  }

  // ---- Links CEBE ↔ región ↔ sociedad (tabla ContinentProfitCenters) -----
  async getCebes(guidRegions: string): Promise<RegionCebe[]> {
    const rows = await this.prisma.$queryRaw<CebeRow[]>(Prisma.sql`
      SELECT rpc.Id, rpc.Guid, rpc.GuidContinents, rpc.ProfitCenterCode, rpc.ProfitCenterName,
             rpc.CompanyCode, co.CompanyName, rpc.Source, rpc.CreatedBy, rpc.UpdatedBy, rpc.Version
      FROM dbo.ContinentProfitCenters rpc
      LEFT JOIN [SAPServices].[dbo].[Companies] co
        ON co.CompanyCode ${COL} = rpc.CompanyCode ${COL}
       AND (co.DeletedTimestamp IS NULL OR co.DeletedTimestamp = 0)
      WHERE rpc.GuidContinents = ${guidRegions}
        AND (rpc.DeletedTimestamp IS NULL OR rpc.DeletedTimestamp = 0)
      ORDER BY rpc.ProfitCenterCode, rpc.CompanyCode`);
    return rows.map(mapRegionCebe);
  }

  /** Pares (CEBE, sociedad) activos de una región — base del reconcile del sync. */
  async getActiveLinks(guidRegions: string): Promise<{ profitCenterCode: string; companyCode: string }[]> {
    const rows = await this.prisma.$queryRaw<{ ProfitCenterCode: string; CompanyCode: string }[]>(Prisma.sql`
      SELECT ProfitCenterCode, CompanyCode FROM dbo.ContinentProfitCenters
      WHERE GuidContinents = ${guidRegions} AND ${ACTIVE}`);
    return rows.map((r) => ({ profitCenterCode: r.ProfitCenterCode, companyCode: r.CompanyCode }));
  }

  /**
   * Vincula un CEBE a una región para una sociedad (upsert soft-delete aware, patrón
   * device labels): si ya hay un link ACTIVO para el triple lo refresca (Version + 1);
   * si no, inserta uno nuevo.
   */
  async linkCebe(
    guidRegions: string,
    code: string,
    companyCode: string,
    name: string | null,
    source: string,
    actor: string,
  ): Promise<void> {
    const nowTs = Date.now();
    const updated = await this.prisma.$executeRaw`
      UPDATE dbo.ContinentProfitCenters
      SET ProfitCenterName = ${name}, Source = ${source}, UpdatedBy = ${actor},
          Version = Version + 1, ServerTimestamp = ${nowTs}
      WHERE GuidContinents = ${guidRegions} AND ProfitCenterCode = ${code} AND CompanyCode = ${companyCode}
        AND (DeletedTimestamp IS NULL OR DeletedTimestamp = 0)`;
    if (updated === 0) {
      await this.prisma.$executeRaw`
        INSERT INTO dbo.ContinentProfitCenters
          (GuidContinents, ProfitCenterCode, CompanyCode, ProfitCenterName, Source, CreatedBy, UpdatedBy, Version, TimeStamp, ServerTimestamp)
        VALUES
          (${guidRegions}, ${code}, ${companyCode}, ${name}, ${source}, ${actor}, ${actor}, 1, ${nowTs}, ${nowTs})`;
    }
  }

  async unlinkCebe(guidRegions: string, code: string, companyCode: string): Promise<boolean> {
    const nowTs = Date.now();
    const affected = await this.prisma.$executeRaw`
      UPDATE dbo.ContinentProfitCenters
      SET DeletedTimestamp = ${nowTs}, ServerTimestamp = ${nowTs}
      WHERE GuidContinents = ${guidRegions} AND ProfitCenterCode = ${code} AND CompanyCode = ${companyCode}
        AND (DeletedTimestamp IS NULL OR DeletedTimestamp = 0)`;
    return affected > 0;
  }

  // ---- Resolver + maestro + diagnósticos --------------------------------
  /**
   * Pares (CEBE, sociedad) efectivos de un conjunto de regiones (por Code). Para una
   * agrupación como CAYCAR el service pasa sus miembros (['CA','CB']) y acá se hace la
   * UNIÓN distinct. Cada CEBE queda limitado a las sociedades vinculadas en esas regiones
   * (así un transversal como "Duwest Banano" no arrastra sociedades de otra región).
   */
  async resolveCebesByCodes(codes: string[]): Promise<ResolvedCebe[]> {
    if (codes.length === 0) return [];
    const rows = await this.prisma.$queryRaw<ResolvedRow[]>(Prisma.sql`
      SELECT DISTINCT rpc.ProfitCenterCode, rpc.ProfitCenterName, rpc.CompanyCode, co.CompanyName
      FROM dbo.ContinentProfitCenters rpc
      JOIN dbo.Continents c ON c.Guid = rpc.GuidContinents
        AND (c.DeletedTimestamp IS NULL OR c.DeletedTimestamp = 0)
      LEFT JOIN [SAPServices].[dbo].[Companies] co
        ON co.CompanyCode ${COL} = rpc.CompanyCode ${COL}
       AND (co.DeletedTimestamp IS NULL OR co.DeletedTimestamp = 0)
      WHERE c.Code IN (${Prisma.join(codes)})
        AND (rpc.DeletedTimestamp IS NULL OR rpc.DeletedTimestamp = 0)
      ORDER BY rpc.ProfitCenterCode, rpc.CompanyCode`);
    return rows.map(mapResolvedCebe);
  }

  /** Maestro de sociedades (para el typeahead del ABM). Vía [SAPServices].[dbo].[Companies]. */
  async getAvailableCompanies(search: string, limit: number): Promise<AvailableCompany[]> {
    const term = search ? `%${search}%` : null;
    const searchSql = term
      ? Prisma.sql`AND (CompanyCode LIKE ${term} OR CompanyName LIKE ${term})`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<CompanyRow[]>(Prisma.sql`
      SELECT TOP (${limit}) CompanyCode, CompanyName, Country
      FROM [SAPServices].[dbo].[Companies]
      WHERE (DeletedTimestamp IS NULL OR DeletedTimestamp = 0) ${searchSql}
      ORDER BY CompanyCode`);
    return rows.map(mapAvailableCompany);
  }

  /** Maestro de CEBEs (para typeahead). Vía VIEW_ProfitCentersMobility (ShowInMobility=1). */
  async getAvailableCebes(search: string, limit: number): Promise<AvailableCebe[]> {
    const term = search ? `%${search}%` : null;
    const searchSql = term
      ? Prisma.sql`WHERE (ProfitCenterCode LIKE ${term} OR ProfitCenterName LIKE ${term})`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<CebeCatalogRow[]>(Prisma.sql`
      SELECT TOP (${limit}) ProfitCenterCode, ProfitCenterName
      FROM dbo.VIEW_ProfitCentersMobility
      ${searchSql}
      ORDER BY ProfitCenterCode`);
    return rows.map(mapAvailableCebe);
  }

  /** CEBEs del maestro que no están vinculados a ninguna región (gap de carga). */
  async getUnmappedCebes(): Promise<UnmappedCebe[]> {
    const rows = await this.prisma.$queryRaw<CebeCatalogRow[]>(Prisma.sql`
      SELECT v.ProfitCenterCode, v.ProfitCenterName
      FROM dbo.VIEW_ProfitCentersMobility v
      WHERE NOT EXISTS (
        SELECT 1 FROM dbo.ContinentProfitCenters rpc
        WHERE rpc.ProfitCenterCode = v.ProfitCenterCode
          AND (rpc.DeletedTimestamp IS NULL OR rpc.DeletedTimestamp = 0)
      )
      ORDER BY v.ProfitCenterCode`);
    return rows.map(mapAvailableCebe);
  }

  /** CEBEs vinculados a más de una región (posible solapamiento a revisar). */
  async getMultiRegionCebes(): Promise<MultiRegionCebe[]> {
    const rows = await this.prisma.$queryRaw<MultiRow[]>(Prisma.sql`
      WITH multi AS (
        SELECT ProfitCenterCode
        FROM dbo.ContinentProfitCenters
        WHERE (DeletedTimestamp IS NULL OR DeletedTimestamp = 0)
        GROUP BY ProfitCenterCode
        HAVING COUNT(DISTINCT GuidContinents) > 1
      )
      SELECT rpc.ProfitCenterCode, rpc.ProfitCenterName, r.Code AS RegionCode, r.Name AS RegionName
      FROM dbo.ContinentProfitCenters rpc
      JOIN multi m ON m.ProfitCenterCode = rpc.ProfitCenterCode
      JOIN dbo.Continents r ON r.Guid = rpc.GuidContinents
        AND (r.DeletedTimestamp IS NULL OR r.DeletedTimestamp = 0)
      WHERE (rpc.DeletedTimestamp IS NULL OR rpc.DeletedTimestamp = 0)
      ORDER BY rpc.ProfitCenterCode, r.Code`);
    return groupMultiRegion(rows);
  }
}
