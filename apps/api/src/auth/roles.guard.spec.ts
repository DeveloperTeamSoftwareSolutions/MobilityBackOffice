import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { BackOfficeRole } from './backoffice-role.enum';

/** ExecutionContext mínimo: solo lo que el guard realmente usa. */
function contextWith(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

/** Reflector que devuelve siempre los roles indicados para la ruta. */
function reflectorReturning(roles: BackOfficeRole[] | undefined): Reflector {
  return {
    getAllAndOverride: () => roles,
  } as unknown as Reflector;
}

describe('RolesGuard', () => {
  describe('rutas sin @Roles', () => {
    it('deja pasar si la ruta no declara roles', () => {
      const guard = new RolesGuard(reflectorReturning(undefined));
      expect(
        guard.canActivate(contextWith({ role: BackOfficeRole.Marketing })),
      ).toBe(true);
    });

    it('deja pasar si la lista de roles esta vacia', () => {
      const guard = new RolesGuard(reflectorReturning([]));
      expect(
        guard.canActivate(contextWith({ role: BackOfficeRole.Marketing })),
      ).toBe(true);
    });
  });

  describe('rol permitido', () => {
    it('deja pasar al rol exacto que la ruta permite', () => {
      const guard = new RolesGuard(
        reflectorReturning([BackOfficeRole.Administrador]),
      );
      expect(
        guard.canActivate(contextWith({ role: BackOfficeRole.Administrador })),
      ).toBe(true);
    });

    it('deja pasar si el rol esta entre varios permitidos', () => {
      const guard = new RolesGuard(
        reflectorReturning([
          BackOfficeRole.Administrador,
          BackOfficeRole.Marketing,
        ]),
      );
      expect(
        guard.canActivate(contextWith({ role: BackOfficeRole.Marketing })),
      ).toBe(true);
    });
  });

  describe('SuperAdmin', () => {
    it('pasa aunque la ruta no lo liste explicitamente', () => {
      const guard = new RolesGuard(
        reflectorReturning([BackOfficeRole.Marketing]),
      );
      expect(
        guard.canActivate(contextWith({ role: BackOfficeRole.SuperAdmin })),
      ).toBe(true);
    });
  });

  describe('rol insuficiente', () => {
    it('rechaza a Marketing en una ruta de Administrador', () => {
      const guard = new RolesGuard(
        reflectorReturning([BackOfficeRole.Administrador]),
      );
      expect(() =>
        guard.canActivate(contextWith({ role: BackOfficeRole.Marketing })),
      ).toThrow(ForbiddenException);
    });

    it('rechaza a Administrador en una ruta solo de Marketing', () => {
      const guard = new RolesGuard(
        reflectorReturning([BackOfficeRole.Marketing]),
      );
      expect(() =>
        guard.canActivate(contextWith({ role: BackOfficeRole.Administrador })),
      ).toThrow(ForbiddenException);
    });
  });

  describe('token sin rol — el agujero que se esta cerrando', () => {
    it('rechaza si el token no trae rol', () => {
      const guard = new RolesGuard(
        reflectorReturning([BackOfficeRole.Administrador]),
      );
      expect(() => guard.canActivate(contextWith({ email: 'x@y.com' }))).toThrow(
        ForbiddenException,
      );
    });

    it('rechaza si no hay usuario en el request', () => {
      const guard = new RolesGuard(
        reflectorReturning([BackOfficeRole.Administrador]),
      );
      expect(() => guard.canActivate(contextWith(undefined))).toThrow(
        ForbiddenException,
      );
    });

    it('NO acepta isAdmin como sustituto del rol de la app', () => {
      // isAdmin de ManageIT es global: lo activa cualquier *_SUPERADMIN de
      // CUALQUIER aplicacion. No debe autorizar nada en BackOffice por si solo.
      const guard = new RolesGuard(
        reflectorReturning([BackOfficeRole.Administrador]),
      );
      expect(() =>
        guard.canActivate(contextWith({ isAdmin: true, email: 'x@y.com' })),
      ).toThrow(ForbiddenException);
    });

    it('rechaza un rol desconocido que no pertenece al enum', () => {
      const guard = new RolesGuard(
        reflectorReturning([BackOfficeRole.Administrador]),
      );
      expect(() =>
        guard.canActivate(contextWith({ role: 'Director' })),
      ).toThrow(ForbiddenException);
    });
  });
});
