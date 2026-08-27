import type { BackOfficeRole } from '../types';

/**
 * Regla unica de visibilidad por rol en el frontend. La usan RoleGuard, el sidebar
 * y las tarjetas del inicio, para no repetir el criterio en cada lugar.
 *
 * - **SuperAdmin** ve todo.
 * - **Usuario** ve todo MENOS lo que pide `Soporte`. Se expresa como exclusion y no
 *   agregando `'Usuario'` a la lista de cada seccion a proposito: asi la regla vive
 *   en UN lugar y una seccion nueva queda visible sin que nadie se acuerde de
 *   sumarlo. Lo unico que hay que recordar es lo contrario —marcarla como de
 *   Soporte si corresponde—, que es justo lo que no se olvida.
 * - El resto ve una seccion si su rol esta en la lista permitida.
 *
 * OJO: es UX (ocultar lo que no corresponde), no seguridad. La barrera real es el
 * guard del backend.
 */
export function roleAllows(
  role: BackOfficeRole | null,
  allow: BackOfficeRole[],
): boolean {
  if (role === null) return false;
  if (role === 'SuperAdmin') return true;
  if (role === 'Usuario') return !allow.includes('Soporte');
  return allow.includes(role);
}
