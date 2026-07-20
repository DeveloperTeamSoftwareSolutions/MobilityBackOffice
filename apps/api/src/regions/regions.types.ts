/**
 * Tipos del módulo de Regiones comerciales por CEBE. Ver `docs/SPEC_BACKOFFICE_REGIONES.md`.
 * DTOs en camelCase (la capa de datos mapea desde PascalCase de SQL).
 */

/**
 * Región comercial (negocio). Las regiones atómicas son filas de la tabla `Continents`
 * (CA/CB/AN/NA, solo lectura). Las agrupaciones (CAYCAR) son **virtuales** (config,
 * `isGroup=true`, sin fila propia): su `guid` es su `code` y no se pueden editar.
 */
export interface Region {
  id: number;
  guid: string;
  timeStamp: number;
  serverTimestamp: number;
  deletedTimestamp: number | null;
  code: string;
  name: string;
  sortOrder: number;
  isGroup: boolean; // true = agrupación config (CAYCAR); false = región atómica (Continents)
  cebeCount: number; // CEBEs vinculados (para grupos: unión de sus miembros)
}

/**
 * Un CEBE vinculado a una región **para una sociedad** (fila de ContinentProfitCenters).
 * La clave de negocio es el triple (región, CEBE, sociedad): un CEBE transversal
 * (p. ej. "Duwest Banano") se vincula a una región tantas veces como sociedades
 * de esa región lo operen. Ver docs/SPEC_BACKOFFICE_REGIONES.md.
 */
export interface RegionCebe {
  id: number;
  guid: string;
  guidRegions: string;
  profitCenterCode: string;
  profitCenterName: string | null;
  companyCode: string; // sociedad (SAPServices.dbo.Companies.CompanyCode)
  companyName: string | null; // snapshot del maestro de sociedades
  source: string;
  createdBy: string | null;
  updatedBy: string | null;
  version: number;
}

/** Detalle de una región: sus datos + los CEBEs propios. */
export interface RegionDetail extends Region {
  cebes: RegionCebe[];
}

/** CEBE del maestro de SAP (para typeahead y como fuente de "gaps"). */
export interface AvailableCebe {
  code: string;
  name: string | null;
}

/** Sociedad del maestro de SAP (`Companies`) para el typeahead del ABM. */
export interface AvailableCompany {
  code: string;
  name: string | null;
  country: string | null;
}

/**
 * CEBE efectivo de una región: par (CEBE, sociedad). Es lo que consumen los reportes
 * para consolidar por región limitando cada CEBE a las sociedades de esa región.
 */
export interface ResolvedCebe {
  profitCenterCode: string;
  profitCenterName: string | null;
  companyCode: string;
  companyName: string | null;
}

/** CEBE que existe en el maestro pero no está vinculado a ninguna región. */
export type UnmappedCebe = AvailableCebe;

/** CEBE vinculado a más de una región (posible solapamiento a revisar). */
export interface MultiRegionCebe {
  code: string;
  name: string | null;
  regionCount: number;
  regions: { code: string; name: string }[];
}

/** Reconciliación de links para el sync (qué agregar / qué quitar). */
export interface LinkReconciliation {
  toAdd: string[];
  toRemove: string[];
}

/** Un CEBE a vincular desde la UI: (CEBE, sociedad) + nombre opcional del typeahead. */
export interface CebeInput {
  code: string;
  companyCode: string; // sociedad — obligatoria (clave triple)
  name?: string | null;
}

/** Un par (CEBE, sociedad) deseado en el payload del sync. */
export interface CebeSyncInput {
  code: string;
  companyCode: string;
  name?: string | null;
}

/** Una región en el payload del web service de sync (estado deseado de sus links). */
export interface SyncRegionInput {
  code: string; // debe existir en el catálogo Continents (no se crean regiones)
  cebes?: CebeSyncInput[]; // lista completa de pares (CEBE, sociedad) deseados
}

/** Payload del web service de sync. */
export interface SyncPayload {
  regions: SyncRegionInput[];
  source?: string;
}

/** Resumen del resultado de un sync. */
export interface SyncResult {
  regions: number;
  added: number;
  removed: number;
  skipped: string[]; // codes del payload que no existen en el catálogo Continents
}
