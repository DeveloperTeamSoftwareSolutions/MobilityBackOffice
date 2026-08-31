import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { RegionsRepository, reconcileLinks, linkKey, parseLinkKey } from './regions.repository';
import { AuditService } from '../audit/audit.service';
import { AuditCategory } from '../audit/audit.categories';
import { Actor } from '../common/actor';
import { expandRegionCode, listRegionGroups } from './region-groups';
import {
  Region,
  RegionDetail,
  AvailableCebe,
  AvailableCompany,
  ResolvedCebe,
  UnmappedCebe,
  MultiRegionCebe,
  CebeInput,
  SyncPayload,
  SyncResult,
} from './regions.types';


/**
 * Lógica del módulo de Regiones comerciales por CEBE. Las regiones (CA/CB/AN/NA) son el
 * catálogo `Continents` en solo lectura — NO se crean/editan. Las agrupaciones (CAYCAR)
 * son virtuales (config `region-groups.ts`). El admin solo gestiona **vínculos CEBE↔región**;
 * cada acción se **audita en `AuditLogs`** (`Category='regions'`).
 */
@Injectable()
export class RegionsService {
  constructor(
    private readonly repo: RegionsRepository,
    private readonly audit: AuditService,
  ) {}

  // ---- Lecturas ----
  getAll(query: { page?: number; limit?: number; search?: string; sortBy?: string; sortDir?: string }) {
    return this.repo.getAll(query);
  }

  getByGuid(guid: string): Promise<RegionDetail | null> {
    return this.repo.getByGuid(guid);
  }

  /** Agrupaciones (CAYCAR...) como "regiones" virtuales, con su conteo de CEBEs efectivos. */
  async getGroups(): Promise<Region[]> {
    const groups = listRegionGroups();
    return Promise.all(
      groups.map(async (g) => {
        const cebes = await this.repo.resolveCebesByCodes(g.members);
        return {
          id: 0,
          guid: g.code,
          timeStamp: 0,
          serverTimestamp: 0,
          deletedTimestamp: null,
          code: g.code,
          name: g.name,
          sortOrder: 999,
          isGroup: true,
          cebeCount: cebes.length,
        };
      }),
    );
  }

  /** Pares (CEBE, sociedad) efectivos de una región o agrupación (CAYCAR → unión CA+CB). */
  resolve(code: string): Promise<ResolvedCebe[]> {
    return this.repo.resolveCebesByCodes(expandRegionCode(code));
  }

  availableCebes(search: string, limit: number): Promise<AvailableCebe[]> {
    return this.repo.getAvailableCebes(search, limit);
  }

  /** Maestro de sociedades para el typeahead del ABM. */
  companies(search: string, limit: number): Promise<AvailableCompany[]> {
    return this.repo.getAvailableCompanies(search, limit);
  }

  unmappedCebes(): Promise<UnmappedCebe[]> {
    return this.repo.getUnmappedCebes();
  }

  multiRegionCebes(): Promise<MultiRegionCebe[]> {
    return this.repo.getMultiRegionCebes();
  }

  // ---- Escrituras: solo vínculos CEBE↔región↔sociedad (Administrador) ----
  async linkCebes(guid: string, cebes: CebeInput[], actor: Actor): Promise<{ linked: number }> {
    const region = await this.requireRegion(guid);
    const list = (cebes || [])
      .map((c) => ({
        code: (c.code || '').trim(),
        companyCode: (c.companyCode || '').trim(),
        name: c.name ?? null,
      }))
      .filter((c) => c.code);
    if (list.length === 0) {
      throw new BadRequestException('Se requiere al menos un CEBE (code)');
    }
    if (list.some((c) => !c.companyCode)) {
      throw new BadRequestException('Cada CEBE requiere una sociedad (companyCode)');
    }
    for (const c of list) {
      await this.repo.linkCebe(guid, c.code, c.companyCode, c.name, 'ui', actor.email ?? 'system');
      await this.audit.safeRecord({
        guidUsers: actor.guid ?? null,
        guidApiLoginClients: actor.guidApiLoginClients ?? null,
        actorEmail: actor.email ?? null,
        action: 'REGION_CEBE_LINK',
        entity: 'ContinentProfitCenter',
        entityId: c.code,
        category: AuditCategory.Regions,
        detail: `region=${region.code} | cebe=${c.code} | sociedad=${c.companyCode} | source=ui`,
      });
    }
    return { linked: list.length };
  }

  async unlinkCebe(guid: string, code: string, companyCode: string, actor: Actor): Promise<boolean> {
    const region = await this.requireRegion(guid);
    const cebe = (code || '').trim();
    const company = (companyCode || '').trim();
    if (!company) {
      throw new BadRequestException('Se requiere la sociedad (companyCode)');
    }
    const ok = await this.repo.unlinkCebe(guid, cebe, company);
    if (!ok) return false;
    await this.audit.safeRecord({
      guidUsers: actor.guid ?? null,
      guidApiLoginClients: actor.guidApiLoginClients ?? null,
      actorEmail: actor.email ?? null,
      action: 'REGION_CEBE_UNLINK',
      entity: 'ContinentProfitCenter',
      entityId: cebe,
      category: AuditCategory.Regions,
      detail: `region=${region.code} | cebe=${cebe} | sociedad=${company} | source=ui`,
    });
    return true;
  }

  // ---- Web service: sync de vínculos (API key). NO crea regiones. ----
  async sync(payload: SyncPayload, actor: string): Promise<SyncResult> {
    const regions = payload?.regions;
    if (!Array.isArray(regions)) {
      throw new BadRequestException('regions (array) es requerido');
    }
    const source = (payload.source || 'sap').trim() || 'sap';
    let added = 0;
    let removed = 0;
    const skipped: string[] = [];

    for (const r of regions) {
      const code = (r.code || '').trim();
      if (!code) continue;
      const region = await this.repo.getByCode(code);
      if (!region) {
        skipped.push(code); // el catálogo Continents no se toca: no se crean regiones
        continue;
      }
      // Estado deseado: pares (CEBE, sociedad). Se ignoran entradas sin ambas partes.
      const desiredPairs = (r.cebes || [])
        .map((c) => ({
          code: (c.code || '').trim(),
          companyCode: (c.companyCode || '').trim(),
          name: c.name ?? null,
        }))
        .filter((c) => c.code && c.companyCode);
      const nameByKey = new Map(desiredPairs.map((c) => [linkKey(c.code, c.companyCode), c.name]));
      const desiredKeys = desiredPairs.map((c) => linkKey(c.code, c.companyCode));
      const current = await this.repo.getActiveLinks(region.guid);
      const currentKeys = current.map((c) => linkKey(c.profitCenterCode, c.companyCode));
      const { toAdd, toRemove } = reconcileLinks(currentKeys, desiredKeys);
      for (const key of toAdd) {
        const { code: cebe, companyCode } = parseLinkKey(key);
        await this.repo.linkCebe(region.guid, cebe, companyCode, nameByKey.get(key) ?? null, source, actor);
        added++;
      }
      for (const key of toRemove) {
        const { code: cebe, companyCode } = parseLinkKey(key);
        await this.repo.unlinkCebe(region.guid, cebe, companyCode);
        removed++;
      }
    }

    await this.audit.safeRecord({
      guidUsers: null,
      action: 'REGION_SYNC',
      entity: 'ContinentProfitCenter',
      entityId: null,
      category: AuditCategory.Regions,
      detail: `${actor} | regiones=${regions.length} | altas=${added} | bajas=${removed} | ignoradas=${skipped.length} | source=${source}`,
    });
    return { regions: regions.length, added, removed, skipped };
  }

  // ---- Internos ----
  private async requireRegion(guid: string): Promise<Region> {
    const region = await this.repo.getByGuid(guid);
    if (!region) throw new NotFoundException('Región no encontrada');
    return region;
  }
}
