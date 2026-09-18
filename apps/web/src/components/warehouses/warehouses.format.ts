/**
 * Reglas de presentación de la sección de almacenes, en funciones puras.
 *
 * Viven fuera de los componentes a propósito: `removalFreesWarehouse` es la que decide si
 * quitar una reserva dispara la confirmación, y esa decisión se puede probar sin montar la
 * pantalla entera.
 */

/** "1 cliente" / "715 clientes", con separador de miles. */
export function countLabel(n: number, singular: string, plural: string): string {
  return `${n.toLocaleString('es-AR')} ${n === 1 ? singular : plural}`;
}

/**
 * A qué está reservado un almacén: "3 clientes · 2 grupos". Omite lo que vale 0 y
 * devuelve `null` si no tiene ninguna reserva.
 */
export function reservationsLabel(customerCount: number, groupCount: number): string | null {
  const parts: string[] = [];
  if (customerCount > 0) parts.push(countLabel(customerCount, 'cliente', 'clientes'));
  if (groupCount > 0) parts.push(countLabel(groupCount, 'grupo', 'grupos'));
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * ¿Quitar UNA reserva deja el almacén disponible para todos? Pasa cuando es la última: el
 * middleware lo libera sólo cuando no le quedan ni clientes ni grupos.
 */
export function removalFreesWarehouse(customerCount: number, groupCount: number): boolean {
  return customerCount + groupCount <= 1;
}

/**
 * Por qué un grupo no se puede reservar. Hoy el único es el 37 ("Clientes Terceros"):
 * junta a los clientes sin holding, así que reservarle un almacén sería no reservarlo.
 */
export const NON_ASSIGNABLE_GROUP_REASON =
  'Grupo genérico de clientes sin holding: no se puede usar para reservar';
