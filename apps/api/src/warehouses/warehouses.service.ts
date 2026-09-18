import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ScopeService } from '../scope/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuditCategory } from '../audit/audit.categories';
import { Actor } from '../common/actor';
import { WarehousesClient } from './warehouses.client';
import {
  AddCustomerGroupResult,
  CentersResult,
  CustomerGroupOption,
  GroupCustomersResult,
  RemoveCustomerGroupResult,
  ReservedCustomer,
  ReservedCustomerGroup,
  WarehouseKey,
  WarehousesResult,
} from './warehouses.types';
import {
  CUSTOMER_GROUP_CODE_MAX_LENGTH,
  CUSTOMER_GROUP_MESSAGES,
  normalizeCustomerGroupCode,
} from './customer-groups';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
/** Espejo de `/group-search` del MW: default 20, máximo 50. */
const GROUP_SEARCH_DEFAULT_LIMIT = 20;
const GROUP_SEARCH_MAX_LIMIT = 50;

/** Largo de la columna del motivo de restricción de un centro, del lado del MW. */
const REASON_MAX_LENGTH = 512;

const EMPTY_PAGED = (page: number, limit: number) => ({
  data: [],
  pagination: { total: 0, page, limit, totalPages: 0 },
});

/** Columnas ordenables de la lista de centros. Espejo de `CENTER_SORTS` del middleware. */
export const CENTER_SORT_FIELDS = [
  'companyCode',
  'centerCode',
  'centerName',
  'warehouseCount',
  'restrictedCount',
  'restricted',
] as const;
export type CenterSortField = (typeof CENTER_SORT_FIELDS)[number];

export interface CentersRawQuery {
  page?: string;
  limit?: string;
  search?: string;
  sortBy?: string;
  sortDir?: string;
}

export interface WarehousesRawQuery {
  companyCode?: string;
  centerCode?: string;
  page?: string;
  limit?: string;
  search?: string;
  onlyRestricted?: string;
}

export interface WarehouseKeyRaw {
  companyCode?: string;
  centerCode?: string;
  warehouseCode?: string;
}

export interface CustomerWriteRaw extends WarehouseKeyRaw {
  customerCode?: string;
}

export interface GroupWriteRaw extends WarehouseKeyRaw {
  customerGroupCode?: string;
}

export interface AvailabilityRaw extends WarehouseKeyRaw {
  restricted?: unknown;
}

export interface CenterRestrictionRaw {
  companyCode?: string;
  centerCode?: string;
  centerName?: string | null;
  restricted?: unknown;
  reason?: string | null;
}

export interface GroupCustomersRawQuery {
  companyCode?: string;
  customerGroupCode?: string;
  page?: string;
  limit?: string;
  search?: string;
}

/** Acciones auditables de la sección. El valor es lo que queda escrito en `AuditLogs`. */
type WarehouseAuditAction =
  | 'WAREHOUSE_CUSTOMER_ADD'
  | 'WAREHOUSE_CUSTOMER_REMOVE'
  | 'WAREHOUSE_RESTRICT'
  | 'WAREHOUSE_ENABLE'
  | 'WAREHOUSE_CUSTOMER_GROUP_ADD'
  | 'WAREHOUSE_CUSTOMER_GROUP_REMOVE';

/**
 * Lógica de Centros y Almacenes.
 *
 * Computa el **alcance por sociedad** del logueado (`ScopeService`, que se lo pregunta al
 * middleware) e inyecta `companyCodes` en cada llamada. Las dos mitades de esa regla NO son
 * simétricas, y es deliberado:
 *
 * - **Lecturas** fuera del alcance devuelven **vacío**, sin llamar al middleware. Un 403 al
 *   mirar sería ruido: el usuario no pidió nada prohibido, simplemente no hay nada suyo ahí.
 * - **Escrituras** fuera del alcance devuelven **403**, antes de llamar al middleware y antes
 *   de auditar. Reservar un almacén de otra sociedad sí es una acción prohibida.
 */
@Injectable()
export class WarehousesService {
  constructor(
    private readonly scope: ScopeService,
    private readonly client: WarehousesClient,
    private readonly audit: AuditService,
  ) {}

  // ---- Lecturas ----

  async getCenters(managerGuid: string, raw: CentersRawQuery): Promise<CentersResult> {
    const page = this.toInt(raw.page, 1, 1);
    const limit = Math.min(this.toInt(raw.limit, DEFAULT_LIMIT, 1), MAX_LIMIT);
    const { isAdmin, companyCodes } = await this.scope.getScopeCompanyCodes(managerGuid);
    if (!isAdmin && companyCodes.length === 0) return EMPTY_PAGED(page, limit);
    return this.client.getCenters(companyCodes, {
      search: (raw.search ?? '').trim(),
      page,
      limit,
      // Se valida acá además del middleware: así un sortBy inventado no viaja por la red ni
      // ensucia sus logs, y el cliente recibe siempre un orden conocido.
      sortBy: WarehousesService.toSortField(raw.sortBy),
      sortDir: raw.sortDir?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
    });
  }

  async getWarehousesOfCenter(
    managerGuid: string,
    raw: WarehousesRawQuery,
  ): Promise<WarehousesResult> {
    const companyCode = (raw.companyCode ?? '').trim();
    const centerCode = (raw.centerCode ?? '').trim();
    if (!companyCode || !centerCode) {
      throw new BadRequestException('companyCode y centerCode son requeridos');
    }
    const page = this.toInt(raw.page, 1, 1);
    const limit = Math.min(this.toInt(raw.limit, DEFAULT_LIMIT, 1), MAX_LIMIT);
    const { isAdmin, companyCodes } = await this.scope.getScopeCompanyCodes(managerGuid);
    if (!isAdmin && !companyCodes.includes(companyCode)) return EMPTY_PAGED(page, limit);
    return this.client.getWarehouses(companyCodes, {
      companyCode,
      centerCode,
      onlyRestricted: raw.onlyRestricted === '1' || raw.onlyRestricted === 'true',
      search: (raw.search ?? '').trim(),
      page,
      limit,
    });
  }

  async getReservedCustomers(
    managerGuid: string,
    raw: WarehouseKeyRaw,
  ): Promise<ReservedCustomer[]> {
    const key = this.requireKey(raw);
    const { isAdmin, companyCodes } = await this.scope.getScopeCompanyCodes(managerGuid);
    if (!isAdmin && !companyCodes.includes(key.companyCode)) return [];
    return this.client.getReservedCustomers(companyCodes, key);
  }

  /**
   * Buscador de clientes. NO se scopea por sociedad: el maestro de clientes es global y el
   * alcance se aplica donde importa, que es al reservar (`addCustomer` valida y corta con
   * 403). Filtrar también acá escondería clientes que el usuario sí puede reservar.
   */
  async searchCustomers(q: string): Promise<ReservedCustomer[]> {
    const term = (q ?? '').trim();
    if (!term) return [];
    return this.client.searchCustomers(term);
  }

  // ---- Grupos de clientes: lecturas ----

  /** Grupos reservados a un almacén. Fuera del alcance → vacío, igual que los clientes. */
  async getReservedGroups(
    managerGuid: string,
    raw: WarehouseKeyRaw,
  ): Promise<ReservedCustomerGroup[]> {
    const key = this.requireKey(raw);
    const { isAdmin, companyCodes } = await this.scope.getScopeCompanyCodes(managerGuid);
    if (!isAdmin && !companyCodes.includes(key.companyCode)) return [];
    return this.client.getReservedGroups(companyCodes, key);
  }

  /**
   * Buscador de grupos con clientes en la sociedad del almacén. Sin `q` devuelve los más
   * grandes. El 37 viene incluido pero con `assignable: false`: la pantalla lo muestra
   * deshabilitado para que nadie crea que falta.
   */
  async searchCustomerGroups(
    managerGuid: string,
    raw: { companyCode?: string; q?: string; limit?: string },
  ): Promise<CustomerGroupOption[]> {
    const companyCode = (raw.companyCode ?? '').trim();
    if (!companyCode) throw new BadRequestException('companyCode es requerido');
    const limit = Math.min(
      this.toInt(raw.limit, GROUP_SEARCH_DEFAULT_LIMIT, 1),
      GROUP_SEARCH_MAX_LIMIT,
    );
    const { isAdmin, companyCodes } = await this.scope.getScopeCompanyCodes(managerGuid);
    if (!isAdmin && !companyCodes.includes(companyCode)) return [];
    return this.client.searchCustomerGroups(companyCode, (raw.q ?? '').trim(), limit);
  }

  /** Clientes de un grupo en una sociedad, paginado en el servidor. */
  async getGroupCustomers(
    managerGuid: string,
    raw: GroupCustomersRawQuery,
  ): Promise<GroupCustomersResult> {
    const companyCode = (raw.companyCode ?? '').trim();
    const customerGroupCode = (raw.customerGroupCode ?? '').trim();
    if (!companyCode || !customerGroupCode) {
      throw new BadRequestException('companyCode y customerGroupCode son requeridos');
    }
    // Para LEER no se rechaza el 37: se muestran sus clientes, sólo no se puede reservar.
    if (customerGroupCode.length > CUSTOMER_GROUP_CODE_MAX_LENGTH) {
      throw new BadRequestException(CUSTOMER_GROUP_MESSAGES.invalid);
    }
    const page = this.toInt(raw.page, 1, 1);
    const limit = Math.min(this.toInt(raw.limit, DEFAULT_LIMIT, 1), MAX_LIMIT);
    const { isAdmin, companyCodes } = await this.scope.getScopeCompanyCodes(managerGuid);
    if (!isAdmin && !companyCodes.includes(companyCode)) return EMPTY_PAGED(page, limit);
    return this.client.getGroupCustomers({
      companyCode,
      customerGroupCode,
      search: (raw.search ?? '').trim(),
      page,
      limit,
    });
  }

  // ---- Escrituras de cliente (validadas por alcance) ----

  async addCustomer(managerGuid: string, raw: CustomerWriteRaw, actor: Actor): Promise<void> {
    const key = this.requireKey(raw);
    const customerCode = (raw.customerCode ?? '').trim();
    if (!customerCode) throw new BadRequestException('customerCode es requerido');
    await this.assertScope(managerGuid, key.companyCode);
    await this.client.addCustomer(key, customerCode, this.mwActor(actor));
    await this.auditWarehouse('WAREHOUSE_CUSTOMER_ADD', key, actor, { customerCode });
  }

  async removeCustomer(managerGuid: string, raw: CustomerWriteRaw, actor: Actor): Promise<void> {
    const key = this.requireKey(raw);
    const customerCode = (raw.customerCode ?? '').trim();
    if (!customerCode) throw new BadRequestException('customerCode es requerido');
    await this.assertScope(managerGuid, key.companyCode);
    await this.client.removeCustomer(key, customerCode);
    await this.auditWarehouse('WAREHOUSE_CUSTOMER_REMOVE', key, actor, { customerCode });
  }

  // ---- Escrituras de grupo (validadas por alcance) ----

  async addCustomerGroup(
    managerGuid: string,
    raw: GroupWriteRaw,
    actor: Actor,
  ): Promise<AddCustomerGroupResult> {
    const key = this.requireKey(raw);
    const customerGroupCode = normalizeCustomerGroupCode(raw.customerGroupCode);
    await this.assertScope(managerGuid, key.companyCode);
    const result = await this.client.addCustomerGroup(
      key,
      customerGroupCode,
      this.mwActor(actor),
    );
    await this.auditWarehouse('WAREHOUSE_CUSTOMER_GROUP_ADD', key, actor, {
      customerGroupCode,
      estado: result.alreadyExisted
        ? 'ya-reservado'
        : result.reactivated
          ? 'reactivado'
          : 'reservado',
    });
    return result;
  }

  async removeCustomerGroup(
    managerGuid: string,
    raw: GroupWriteRaw,
    actor: Actor,
  ): Promise<RemoveCustomerGroupResult> {
    const key = this.requireKey(raw);
    // Quitar NO rechaza el 37: si alguna vez quedó reservado por fuera, hay que poder sacarlo.
    const customerGroupCode = (raw.customerGroupCode ?? '').trim();
    if (!customerGroupCode) throw new BadRequestException(CUSTOMER_GROUP_MESSAGES.required);
    if (customerGroupCode.length > CUSTOMER_GROUP_CODE_MAX_LENGTH) {
      throw new BadRequestException(CUSTOMER_GROUP_MESSAGES.invalid);
    }
    await this.assertScope(managerGuid, key.companyCode);
    const result = await this.client.removeCustomerGroup(key, customerGroupCode);
    await this.auditWarehouse('WAREHOUSE_CUSTOMER_GROUP_REMOVE', key, actor, {
      customerGroupCode,
      estado: result.stillRestricted ? 'restringido' : 'disponible',
    });
    return result;
  }

  // ---- Disponibilidad del almacén y restricción del centro ----

  async setAvailability(
    managerGuid: string,
    raw: AvailabilityRaw,
    actor: Actor,
  ): Promise<void> {
    const key = this.requireKey(raw);
    if (typeof raw.restricted !== 'boolean') {
      throw new BadRequestException('restricted (boolean) es requerido');
    }
    await this.assertScope(managerGuid, key.companyCode);
    await this.client.setAvailability(key, raw.restricted);
    await this.auditWarehouse(
      raw.restricted ? 'WAREHOUSE_RESTRICT' : 'WAREHOUSE_ENABLE',
      key,
      actor,
      { estado: raw.restricted ? 'restringido' : 'habilitado' },
    );
  }

  /**
   * Restringe o libera un CENTRO entero, para todos.
   *
   * ⚠️ A diferencia de `setAvailability`, la clave es (sociedad, centro) — sin almacén. El
   * centro no es una entidad: es el par que agrupa a los almacenes, así que no hay nada que
   * validar contra un maestro. Lo que sí se valida es el alcance, igual que en toda
   * escritura de este módulo.
   */
  async setCenterRestricted(
    managerGuid: string,
    raw: CenterRestrictionRaw,
    actor: Actor,
  ): Promise<void> {
    const companyCode = (raw.companyCode ?? '').trim();
    const centerCode = (raw.centerCode ?? '').trim();
    if (!companyCode || !centerCode) {
      throw new BadRequestException('companyCode y centerCode son requeridos');
    }
    if (typeof raw.restricted !== 'boolean') {
      throw new BadRequestException('restricted (boolean) es requerido');
    }
    await this.assertScope(managerGuid, companyCode);

    // El motivo se recorta al largo de la columna antes de salir: si viaja más largo, muere
    // en el INSERT con un error de SQL que el usuario no puede interpretar.
    const reason =
      raw.reason != null ? String(raw.reason).trim().slice(0, REASON_MAX_LENGTH) : null;

    await this.client.setCenterRestricted({
      companyCode,
      centerCode,
      centerName: raw.centerName ?? null,
      restricted: raw.restricted,
      reason,
      userEmail: actor.email ?? null,
    });

    await this.audit.safeRecord({
      guidUsers: actor.guid ?? null,
      guidApiLoginClients: actor.guidApiLoginClients ?? null,
      actorEmail: actor.email ?? null,
      action: raw.restricted ? 'CENTER_RESTRICT' : 'CENTER_ENABLE',
      entity: 'DistributionCenter',
      entityId: `${companyCode}/${centerCode}`,
      category: AuditCategory.Warehouses,
      detail: [
        actor.email ?? 'desconocido',
        `sociedad=${companyCode}`,
        `centro=${centerCode}`,
        `estado=${raw.restricted ? 'restringido' : 'habilitado'}`,
        reason ? `motivo=${reason}` : null,
      ]
        .filter(Boolean)
        .join(' | '),
    });
  }

  // ---- Internos ----

  private requireKey(raw: WarehouseKeyRaw): WarehouseKey {
    const companyCode = (raw.companyCode ?? '').trim();
    const centerCode = (raw.centerCode ?? '').trim();
    const warehouseCode = (raw.warehouseCode ?? '').trim();
    if (!companyCode || !centerCode || !warehouseCode) {
      throw new BadRequestException('companyCode, centerCode y warehouseCode son requeridos');
    }
    return { companyCode, centerCode, warehouseCode };
  }

  private async assertScope(managerGuid: string, companyCode: string): Promise<void> {
    const { isAdmin, companyCodes } = await this.scope.getScopeCompanyCodes(managerGuid);
    if (!isAdmin && !companyCodes.includes(companyCode)) {
      throw new ForbiddenException('El almacén no pertenece a tu alcance');
    }
  }

  /** Quién hace el cambio, como lo espera el middleware en `WarehouseCustomers`. */
  private mwActor(actor: Actor): { userEmail?: string } {
    return { userEmail: actor.email };
  }

  /**
   * Audita en `AuditLogs` una escritura ya ejecutada sobre un almacén (best-effort: el CRUD
   * ya ocurrió y un fallo del audit central no debe romper la respuesta).
   *
   * El `EntityId` es el `warehouseCode`; el resto de la clave compuesta y el sujeto (cliente,
   * grupo o estado) van en `Detail`. `guidApiLoginClients` no es decorativo: sin él, ITManager
   * no muestra la fila.
   */
  private auditWarehouse(
    action: WarehouseAuditAction,
    key: WarehouseKey,
    actor: Actor,
    extra: { customerCode?: string; customerGroupCode?: string; estado?: string },
  ): Promise<void> {
    const parts = [
      actor.email ?? 'desconocido',
      `sociedad=${key.companyCode}`,
      `centro=${key.centerCode}`,
      `almacen=${key.warehouseCode}`,
    ];
    if (extra.customerCode) parts.push(`cliente=${extra.customerCode}`);
    if (extra.customerGroupCode) parts.push(`grupo=${extra.customerGroupCode}`);
    if (extra.estado) parts.push(`estado=${extra.estado}`);

    return this.audit.safeRecord({
      guidUsers: actor.guid ?? null,
      guidApiLoginClients: actor.guidApiLoginClients ?? null,
      actorEmail: actor.email ?? null,
      action,
      entity: 'Warehouse',
      entityId: key.warehouseCode,
      category: AuditCategory.Warehouses,
      detail: parts.join(' | '),
    });
  }

  private toInt(value: string | undefined, def: number, min: number): number {
    const n = parseInt(value ?? '', 10);
    return Number.isFinite(n) && n >= min ? n : def;
  }

  /** Whitelist de orden: lo que no esté en la lista cae al default, nunca viaja crudo. */
  static toSortField(value: string | undefined): CenterSortField {
    return CENTER_SORT_FIELDS.includes(value as CenterSortField)
      ? (value as CenterSortField)
      : 'companyCode';
  }
}
