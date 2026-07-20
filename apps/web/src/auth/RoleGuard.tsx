import { ReactNode } from 'react';
import { useAuth } from './useAuth';
import type { BackOfficeRole } from '../types';

/**
 * Muestra el contenido solo si el rol de la sesión está permitido.
 *
 * ES UNA AYUDA DE INTERFAZ, NO UNA BARRERA DE SEGURIDAD. El rol sale de
 * localStorage, así que cualquiera puede editarlo y ver la sección. Lo único que
 * evita es ofrecerle al usuario acciones que el backend le va a rechazar.
 *
 * Toda ruta sensible DEBE estar protegida en el backend con `@Roles(...)` +
 * `RolesGuard`. Si una sección solo está protegida acá, está desprotegida.
 */
export function RoleGuard({
  allow,
  children,
  fallback = null,
}: {
  allow: BackOfficeRole[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { role } = useAuth();

  // SuperAdmin ve todo el back-office, igual que en el RolesGuard del backend.
  const permitido =
    role !== null && (role === 'SuperAdmin' || allow.includes(role));

  return <>{permitido ? children : fallback}</>;
}
