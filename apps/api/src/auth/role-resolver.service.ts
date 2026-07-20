import { Injectable } from '@nestjs/common';
import { BackOfficeRole } from './backoffice-role.enum';

/**
 * Datos para resolver el rol. El rol lo decide ITManager: provienen del
 * accessMatrix de la app (roles asignados) + la bandera isAdmin del JWT.
 */
export interface RoleResolutionInput {
  roleKeys?: string[];
  isAdmin?: boolean;
}

/** RoleKey de ITManager (app MobilityBackOffice) → rol de negocio. */
const ROLE_KEY_MAP: Readonly<Record<string, BackOfficeRole>> = {
  MOBILITYBO_SUPERADMIN: BackOfficeRole.SuperAdmin,
  MOBILITYBO_ADMIN: BackOfficeRole.Administrador,
  MOBILITYBO_MARKETING: BackOfficeRole.Marketing,
};

/** Prioridad: si el usuario tiene varios roles, gana el de mayor privilegio. */
const PRIORITY: readonly BackOfficeRole[] = [
  BackOfficeRole.SuperAdmin,
  BackOfficeRole.Administrador,
  BackOfficeRole.Marketing,
];

@Injectable()
export class RoleResolver {
  /**
   * Resuelve el rol a partir de los roles asignados en ITManager.
   * Devuelve null si el usuario no tiene ningún rol de MobilityBackOffice
   * (el login lo traduce a 403).
   */
  resolve(input: RoleResolutionInput): BackOfficeRole | null {
    const { roleKeys = [], isAdmin = false } = input;
    const candidates = new Set<BackOfficeRole>();

    // El administrador de IT (isAdmin de ITManager) entra siempre como SuperAdmin.
    if (isAdmin || roleKeys.some((k) => k.endsWith('_SUPERADMIN'))) {
      candidates.add(BackOfficeRole.SuperAdmin);
    }
    for (const key of roleKeys) {
      const role = ROLE_KEY_MAP[key];
      if (role) candidates.add(role);
    }

    return PRIORITY.find((role) => candidates.has(role)) ?? null;
  }
}
