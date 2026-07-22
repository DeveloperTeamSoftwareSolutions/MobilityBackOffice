import type { BackOfficeRole } from '../types';

/**
 * Regla unica de visibilidad por rol en el frontend. SuperAdmin ve todo; el resto
 * ve una seccion si su rol esta en la lista permitida. La usan RoleGuard, el sidebar
 * y las tarjetas del inicio, para no repetir el criterio en cada lugar.
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
  return allow.includes(role);
}
