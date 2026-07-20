import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BackOfficeRole } from './backoffice-role.enum';
import { ROLES_KEY } from './roles.decorator';

interface AuthRequest {
  user?: { role?: unknown };
}

const KNOWN_ROLES: readonly string[] = Object.values(BackOfficeRole);

/**
 * Autoriza por el rol de BackOffice que viaja en el JWT propio de la app.
 *
 * Deliberadamente NO acepta `isAdmin` como sustituto: ese flag lo emite ManageIT
 * de forma global (`IsAdmin` del usuario OR cualquier rol `*_SUPERADMIN` de
 * CUALQUIER aplicación), así que un superadmin de otro sistema lo traería en true
 * sin tener ningún rol asignado en BackOffice. La autoridad acá es el claim `role`,
 * resuelto en el login contra el accessMatrix de esta app.
 *
 * Debe usarse DESPUÉS de `JwtGuard` (que popula `req.user`).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<BackOfficeRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Ruta sin @Roles: la autenticación ya la cubrió JwtGuard.
    if (!allowed || allowed.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthRequest>();
    const role = req.user?.role;

    if (typeof role !== 'string' || !KNOWN_ROLES.includes(role)) {
      throw new ForbiddenException(
        'El usuario no tiene un rol válido en MobilityBackOffice',
      );
    }

    // SuperAdmin accede a todo el back-office; no hace falta listarlo en cada ruta.
    if (role === BackOfficeRole.SuperAdmin) {
      return true;
    }

    if (!allowed.includes(role as BackOfficeRole)) {
      throw new ForbiddenException(
        `Esta acción requiere uno de los roles: ${allowed.join(', ')}`,
      );
    }

    return true;
  }
}
