import * as fs from 'fs';
import * as path from 'path';
import { CENTER_SORT_FIELDS, WarehousesService } from './warehouses.service';

/**
 * LAS COLUMNAS ORDENABLES TIENEN QUE COINCIDIR EN LAS TRES CAPAS.
 *
 * El orden de la lista de centros se resuelve server-side, así que el nombre de la columna
 * viaja como texto por tres archivos que viven separados:
 *
 *   1. `apps/web/.../warehouses.types.ts`   → `CenterSortField`, lo que la UI puede pedir
 *   2. `apps/api/.../warehouses.service.ts` → `CENTER_SORT_FIELDS`, lo que la API deja pasar
 *   3. MW `warehouseCustomers.repository.js` → `CENTER_SORTS`, lo único que ordena de verdad
 *
 * Si una capa suma una columna y otra no, **no hay error**: el valor cae al default y la
 * tabla queda ordenada por sociedad como si el click no hubiera existido. Es la peor forma
 * de fallar — silenciosa, y sólo se nota mirando los datos con atención.
 *
 * Este test cubre la costura 1↔2, que es la que vive en este repo. La 2↔3 es del middleware.
 * Vive del lado de la API y no del front porque es la API la que valida el `sortBy` que le
 * llega: el test mira el archivo del front como dato, no lo importa.
 */
describe('columnas ordenables de centros', () => {
  const WEB_TYPES = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'web',
    'src',
    'components',
    'warehouses',
    'warehouses.types.ts',
  );

  /** Extrae los miembros del union `CenterSortField` del archivo del front. */
  function webSortFields(): string[] {
    const src = fs.readFileSync(WEB_TYPES, 'utf8');
    const decl = /export type CenterSortField =([\s\S]*?);/.exec(src);
    if (!decl) throw new Error('No se encontró el type CenterSortField en el front');
    return [...decl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  }

  it('el front no puede pedir una columna que la API no acepta', () => {
    expect(webSortFields()).toEqual([...CENTER_SORT_FIELDS].sort());
  });

  it('son las 6 columnas de la tabla', () => {
    // El número es a propósito: si aparece una séptima columna ordenable, este test obliga
    // a decidir conscientemente si el middleware también la conoce.
    expect(CENTER_SORT_FIELDS).toHaveLength(6);
  });

  it('un sortBy inventado cae al default en vez de viajar al middleware', () => {
    expect(WarehousesService.toSortField('DROP TABLE Warehouses')).toBe('companyCode');
    expect(WarehousesService.toSortField(undefined)).toBe('companyCode');
    expect(WarehousesService.toSortField('centerName')).toBe('centerName');
  });
});
