import { SetMetadata, CustomDecorator } from '@nestjs/common';
import { BackOfficeRole } from './backoffice-role.enum';

export const ROLES_KEY = 'backoffice_roles';

/**
 * Restringe una ruta a los roles indicados. Se aplica junto con `RolesGuard`.
 * `SuperAdmin` siempre pasa, no hace falta listarlo.
 *
 *   @Roles(BackOfficeRole.Administrador)
 *   @UseGuards(JwtGuard, RolesGuard)
 */
export const Roles = (...roles: BackOfficeRole[]): CustomDecorator<string> =>
  SetMetadata(ROLES_KEY, roles);
