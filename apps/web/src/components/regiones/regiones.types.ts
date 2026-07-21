/** Tipos de la sección Regiones comerciales por CEBE. Espeja el contrato del API. */

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface Paged<T> {
  data: T[];
  pagination: Pagination;
}

/** Región comercial. Atómica (Continents: CA/CB/AN/NA) o agrupación virtual (CAYCAR). */
export interface Region {
  guid: string; // para agrupaciones, el guid es el propio code
  code: string;
  name: string;
  isGroup: boolean;
  cebeCount: number;
}

/** Un CEBE vinculado a una región para una sociedad (clave triple región+CEBE+sociedad). */
export interface RegionCebe {
  profitCenterCode: string;
  profitCenterName: string | null;
  companyCode: string;
  companyName: string | null;
}

/** Par (CEBE, sociedad) efectivo de una región (salida del resolver). */
export type ResolvedCebe = RegionCebe;

/** Región + sus CEBEs vinculados (detalle). */
export interface RegionDetail extends Region {
  cebes: RegionCebe[];
}

/** CEBE del maestro (typeahead / gaps). */
export interface AvailableCebe {
  code: string;
  name: string | null;
}

/** Sociedad del maestro (typeahead del ABM). */
export interface AvailableCompany {
  code: string;
  name: string | null;
  country: string | null;
}

/** CEBE vinculado a más de una región (diagnóstico de solapamiento). */
export interface MultiRegionCebe {
  code: string;
  name: string | null;
  regionCount: number;
  regions: { code: string; name: string }[];
}
