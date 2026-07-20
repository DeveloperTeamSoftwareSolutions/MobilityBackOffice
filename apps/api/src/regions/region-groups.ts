/**
 * Agrupaciones de regiones = unión de continentes/regiones. Hoy la única es
 * **CAYCAR = Centroamérica (CA) + Caribe (CB)**, y no muta; por eso se modela como
 * **configuración** y no como tabla ni fila en `Continents` (tabla compartida que no
 * se toca). Si en el futuro hubiera más agrupaciones, se agregan acá.
 *
 * `resolve(CAYCAR)` = unión de los CEBEs de CA y CB. Ver docs/SPEC_BACKOFFICE_REGIONES.md.
 */
export const REGION_GROUPS: Readonly<Record<string, string[]>> = {
  CAYCAR: ['CA', 'CB'],
};

/** Nombre para mostrar de cada agrupación (para el listado/selector). */
export const REGION_GROUP_NAMES: Readonly<Record<string, string>> = {
  CAYCAR: 'CAYCAR (Centroamérica + Caribe)',
};

/** ¿El código es una agrupación configurada? */
export function isRegionGroup(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGION_GROUPS, (code || '').trim());
}

/**
 * Expande un código a la lista de continentes/regiones atómicas a consultar.
 * Agrupación (CAYCAR) → sus miembros; continente atómico → él mismo; vacío → [].
 */
export function expandRegionCode(code: string): string[] {
  const c = (code || '').trim();
  if (!c) return [];
  return REGION_GROUPS[c] ? [...REGION_GROUPS[c]] : [c];
}

/** Lista de agrupaciones configuradas, para el selector/reportes. */
export function listRegionGroups(): { code: string; name: string; members: string[] }[] {
  return Object.keys(REGION_GROUPS).map((code) => ({
    code,
    name: REGION_GROUP_NAMES[code] ?? code,
    members: [...REGION_GROUPS[code]],
  }));
}
