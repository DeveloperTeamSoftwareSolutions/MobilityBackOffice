import { httpClient } from '../../api/httpClient';
import {
  Region,
  RegionDetail,
  Paged,
  Pagination,
  AvailableCebe,
  AvailableCompany,
  ResolvedCebe,
  MultiRegionCebe,
} from './regiones.types';

interface ApiPaged<T> {
  success: boolean;
  data: T[];
  pagination: Pagination;
}
interface ApiData<T> {
  success: boolean;
  data: T;
}

/** Regiones atómicas (catálogo Continents), paginadas. */
export async function getRegions(search = '', page = 1, limit = 50): Promise<Paged<Region>> {
  const res = await httpClient.get<ApiPaged<Region>>('/api/regions', {
    params: { search: search || undefined, page, limit },
  });
  return { data: res.data.data, pagination: res.data.pagination };
}

/** Agrupaciones virtuales (CAYCAR = CA + CB). */
export async function getGroups(): Promise<Region[]> {
  const res = await httpClient.get<ApiData<Region[]>>('/api/regions/groups');
  return res.data.data;
}

/** Región + sus CEBEs vinculados (solo regiones atómicas). */
export async function getRegion(guid: string): Promise<RegionDetail> {
  const res = await httpClient.get<ApiData<RegionDetail>>(
    `/api/regions/${encodeURIComponent(guid)}`,
  );
  return res.data.data;
}

/** Pares (CEBE, sociedad) efectivos de una región o agrupación (CAYCAR → unión CA+CB). */
export async function resolveRegion(code: string): Promise<ResolvedCebe[]> {
  const res = await httpClient.get<ApiData<ResolvedCebe[]>>(
    `/api/regions/${encodeURIComponent(code)}/resolve`,
  );
  return res.data.data;
}

/** Typeahead de CEBEs del maestro (para vincular). */
export async function searchCebes(q: string): Promise<AvailableCebe[]> {
  const res = await httpClient.get<ApiData<AvailableCebe[]>>('/api/regions/cebes/available', {
    params: { q, limit: 20 },
  });
  return res.data.data;
}

/** Typeahead de sociedades del maestro (para vincular). */
export async function searchCompanies(q: string): Promise<AvailableCompany[]> {
  const res = await httpClient.get<ApiData<AvailableCompany[]>>('/api/regions/companies', {
    params: { q, limit: 20 },
  });
  return res.data.data;
}

/** Vincular un CEBE a una región para una sociedad (Administrador). */
export async function linkCebe(
  guid: string,
  code: string,
  companyCode: string,
  name: string | null,
): Promise<void> {
  await httpClient.post(`/api/regions/${encodeURIComponent(guid)}/cebes`, {
    cebes: [{ code, companyCode, name }],
  });
}

/** Desvincular un CEBE de una región para una sociedad (Administrador). */
export async function unlinkCebe(guid: string, code: string, companyCode: string): Promise<void> {
  await httpClient.delete(
    `/api/regions/${encodeURIComponent(guid)}/cebes/${encodeURIComponent(code)}/${encodeURIComponent(companyCode)}`,
  );
}

/** Diagnóstico: CEBEs del maestro sin ninguna región. */
export async function getUnmapped(): Promise<AvailableCebe[]> {
  const res = await httpClient.get<ApiData<AvailableCebe[]>>('/api/regions/diagnostics/unmapped');
  return res.data.data;
}

/** Diagnóstico: CEBEs vinculados a más de una región. */
export async function getMultiRegion(): Promise<MultiRegionCebe[]> {
  const res = await httpClient.get<ApiData<MultiRegionCebe[]>>('/api/regions/diagnostics/multi');
  return res.data.data;
}
