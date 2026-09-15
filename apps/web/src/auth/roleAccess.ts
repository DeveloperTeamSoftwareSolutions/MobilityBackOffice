import type { BackOfficeRole } from '../types';

/**
 * Roles que se asignan a propósito y que `Usuario` NO recibe por defecto: una
 * sección que pide cualquiera de ellos queda fuera de su regla por exclusión.
 *
 * - `Soporte`: la consola altera documentos del flujo y es del DevelopersTeam.
 * - `SuperAdmin`: lo que se declara exclusivo de SuperAdmin.
 * - `RevisionSap`: reasignar y reenviar órdenes a SAP es una tarea operativa que se
 *   le da a quien la hace, no a todo el que usa el back-office.
 */
const NOT_FOR_USUARIO: readonly BackOfficeRole[] = ['Soporte', 'SuperAdmin', 'RevisionSap'];

/**
 * Regla unica de visibilidad por rol en el frontend. La usan RoleGuard, el sidebar
 * y las tarjetas del inicio, para no repetir el criterio en cada lugar.
 *
 * - **SuperAdmin** ve todo.
 * - **Usuario** ve todo MENOS lo que pida alguno de `NOT_FOR_USUARIO`. Se expresa como
 *   exclusion y no agregando `'Usuario'` a la lista de cada seccion a proposito: asi
 *   la regla vive en UN lugar y una seccion nueva queda visible sin que nadie se
 *   acuerde de sumarlo. Lo unico que hay que recordar es lo contrario —marcarla con
 *   un rol deliberado si corresponde—, que es justo lo que no se olvida.
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
  if (role === 'Usuario') {
    return !allow.some((r) => NOT_FOR_USUARIO.includes(r));
  }
  return allow.includes(role);
}
