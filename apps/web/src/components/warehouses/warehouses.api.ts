import { httpClient } from '../../api/httpClient';
import {
  Center,
  CenterSortField,
  CustomerGroupOption,
  GroupCustomer,
  Paged,
  Pagination,
  RemoveCustomerGroupResult,
  ReservedCustomer,
  ReservedCustomerGroup,
  SortDir,
  Warehouse,
} from './warehouses.types';

interface ApiPaged<T> {
  success: boolean;
  data: T[];
  pagination: Pagination;
}
interface ApiData<T> {
  success: boolean;
  data: T;
}

/**
 * Centros de distribución del alcance del logueado (vista inicial).
 *
 * El orden se resuelve **en el servidor**: la lista está paginada, así que ordenar en el
 * cliente sólo acomodaría las filas de la página visible y dejaría el resto donde estaba.
 */
export async function getCenters(
  search = '',
  page = 1,
  limit = 50,
  sortBy?: CenterSortField,
  sortDir?: SortDir,
): Promise<Paged<Center>> {
  const res = await httpClient.get<ApiPaged<Center>>('/api/warehouses/centers', {
    params: { search: search || undefined, page, limit, sortBy, sortDir },
  });
  return { data: res.data.data, pagination: res.data.pagination };
}

/** Almacenes de un centro (los en tránsito quedan ocultos). */
export async function getWarehousesOfCenter(
  companyCode: string,
  centerCode: string,
  opts: { search?: string; onlyRestricted?: boolean; page?: number; limit?: number } = {},
): Promise<Paged<Warehouse>> {
  const res = await httpClient.get<ApiPaged<Warehouse>>('/api/warehouses', {
    params: {
      companyCode,
      centerCode,
      search: opts.search || undefined,
      onlyRestricted: opts.onlyRestricted ? 1 : undefined,
      page: opts.page ?? 1,
      limit: opts.limit ?? 50,
    },
  });
  return { data: res.data.data, pagination: res.data.pagination };
}

/** Clientes reservados a un almacén restringido. */
export async function getReservedCustomers(
  companyCode: string,
  centerCode: string,
  warehouseCode: string,
): Promise<ReservedCustomer[]> {
  const res = await httpClient.get<ApiData<ReservedCustomer[]>>('/api/warehouses/customers', {
    params: { companyCode, centerCode, warehouseCode },
  });
  return res.data.data;
}

/** Typeahead de clientes (código/nombre) para el buscador. */
export async function searchCustomers(q: string): Promise<ReservedCustomer[]> {
  const res = await httpClient.get<ApiData<ReservedCustomer[]>>(
    '/api/warehouses/customer-search',
    { params: { q } },
  );
  return res.data.data;
}

/** Reserva un almacén a un cliente (la primera reserva lo restringe). */
export async function addReservedCustomer(
  companyCode: string,
  centerCode: string,
  warehouseCode: string,
  customerCode: string,
): Promise<void> {
  await httpClient.post('/api/warehouses/customers', {
    companyCode,
    centerCode,
    warehouseCode,
    customerCode,
  });
}

/** Quita un cliente reservado de un almacén. */
export async function removeReservedCustomer(
  companyCode: string,
  centerCode: string,
  warehouseCode: string,
  customerCode: string,
): Promise<void> {
  await httpClient.delete('/api/warehouses/customers', {
    params: { companyCode, centerCode, warehouseCode, customerCode },
  });
}

// ---- Grupos de clientes de SAP (requiere MW ≥ 1.357.0) ----

/** Grupos de clientes reservados a un almacén. */
export async function getReservedGroups(
  companyCode: string,
  centerCode: string,
  warehouseCode: string,
): Promise<ReservedCustomerGroup[]> {
  const res = await httpClient.get<ApiData<ReservedCustomerGroup[]>>('/api/warehouses/groups', {
    params: { companyCode, centerCode, warehouseCode },
  });
  return res.data.data;
}

/**
 * Typeahead de grupos con clientes en la sociedad del almacén. Sin `q` trae los más
 * grandes, así que abrir el buscador ya muestra opciones. El 37 viene con
 * `assignable: false`.
 */
export async function searchCustomerGroups(
  companyCode: string,
  q: string,
): Promise<CustomerGroupOption[]> {
  const res = await httpClient.get<ApiData<CustomerGroupOption[]>>(
    '/api/warehouses/group-search',
    { params: { companyCode, q: q || undefined } },
  );
  return res.data.data;
}

/** Clientes de un grupo en una sociedad, paginados en el servidor. */
export async function getGroupCustomers(
  companyCode: string,
  customerGroupCode: string,
  page = 1,
  limit = 20,
): Promise<Paged<GroupCustomer>> {
  const res = await httpClient.get<ApiPaged<GroupCustomer>>('/api/warehouses/groups/customers', {
    params: { companyCode, customerGroupCode, page, limit },
  });
  return { data: res.data.data, pagination: res.data.pagination };
}

/** Reserva un almacén a un grupo de clientes (la primera reserva lo restringe). */
export async function addReservedGroup(
  companyCode: string,
  centerCode: string,
  warehouseCode: string,
  customerGroupCode: string,
): Promise<void> {
  await httpClient.post('/api/warehouses/groups', {
    companyCode,
    centerCode,
    warehouseCode,
    customerGroupCode,
  });
}

/** Quita un grupo de un almacén. Sin clientes ni grupos, el almacén queda disponible. */
export async function removeReservedGroup(
  companyCode: string,
  centerCode: string,
  warehouseCode: string,
  customerGroupCode: string,
): Promise<RemoveCustomerGroupResult> {
  const res = await httpClient.delete<ApiData<RemoveCustomerGroupResult>>(
    '/api/warehouses/groups',
    { params: { companyCode, centerCode, warehouseCode, customerGroupCode } },
  );
  return res.data.data;
}

/**
 * Restringe o libera un CENTRO entero, para todos.
 *
 * ⚠️ Es un concepto distinto de reservar un almacén a un cliente: acá no hay reserva de por
 * medio. El CDI queda fuera de circulación aunque no tenga un solo cliente cargado.
 */
export async function setCenterRestricted(
  companyCode: string,
  centerCode: string,
  restricted: boolean,
  reason?: string | null,
  centerName?: string | null,
): Promise<void> {
  await httpClient.put('/api/warehouses/center-restriction', {
    companyCode,
    centerCode,
    centerName: centerName ?? null,
    restricted,
    reason: reason ?? null,
  });
}
