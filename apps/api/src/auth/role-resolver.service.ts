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
  MOBILITYBO_SUPPORT: BackOfficeRole.Soporte,
  MOBILITYBO_ADMIN: BackOfficeRole.Administrador,
  MOBILITYBO_MARKETING: BackOfficeRole.Marketing,
};

/**
 * Prioridad: si el usuario tiene varios roles, gana el de mayor privilegio.
 *
 * `Soporte` va segundo (arriba de Administrador) porque es un rol tecnico que se
 * asigna deliberadamente al DevelopersTeam: si alguien lo tiene, es porque se
 * espera que opere la consola. OJO — la app resuelve UN SOLO rol: quien tenga
 * ADMIN + SUPPORT pierde Regiones. Quien necesite ambos accesos va con SuperAdmin.
 * Ver docs/SPEC_CONSOLA_SOPORTE.md (riesgo R2).
 */
const PRIORITY: readonly BackOfficeRole[] = [
  BackOfficeRole.SuperAdmin,
  BackOfficeRole.Soporte,
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
