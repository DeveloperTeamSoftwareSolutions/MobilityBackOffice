import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WarehousesController } from './warehouses.controller';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { BackOfficeRole } from '../auth/backoffice-role.enum';

/**
 * ESTE ES EL TEST QUE EVITA LA PANTALLA VISIBLE Y ROTA.
 *
 * La visibilidad del front se resuelve **por exclusión**: `roleAccess.ts` le da a `Usuario`
 * todo lo que no pida un rol deliberado, así que una sección nueva le queda visible sola, sin
 * que nadie se acuerde de sumarlo. Si el controller declarara sólo `Administrador`, la sección
 * aparecería en el menú de `Usuario` y la API le respondería 403 en la primera pantalla.
 *
 * No hay error de compilación ni test que falle por esa combinación: las dos capas son
 * correctas por separado y sólo se contradicen en runtime. Por eso se fija acá, sobre el
 * controller real y el guard real — no sobre un mock que devuelve la lista que uno espera.
 */

/** ExecutionContext contra el controller REAL: el Reflector lee sus metadatos de verdad. */
function contextFor(role: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    getHandler: () => WarehousesController.prototype.centers,
    getClass: () => WarehousesController,
  } as unknown as ExecutionContext;
}

function guard(): RolesGuard {
  return new RolesGuard(new Reflector());
}

describe('WarehousesController — quién entra a la sección', () => {
  it('Administrador entra', () => {
    expect(guard().canActivate(contextFor(BackOfficeRole.Administrador))).toBe(true);
  });

  it('Usuario entra TAMBIÉN — es lo que evita la sección visible con la API en 403', () => {
    expect(guard().canActivate(contextFor(BackOfficeRole.Usuario))).toBe(true);
  });

  it('SuperAdmin entra sin estar listado (el guard lo deja pasar siempre)', () => {
    expect(guard().canActivate(contextFor(BackOfficeRole.SuperAdmin))).toBe(true);
  });

  it.each([
    [BackOfficeRole.Marketing],
    [BackOfficeRole.Soporte],
    [BackOfficeRole.RevisionSap],
  ])('%s no entra', (role) => {
    expect(() => guard().canActivate(contextFor(role))).toThrow(ForbiddenException);
  });

  it('un token sin rol válido no entra', () => {
    expect(() => guard().canActivate(contextFor(undefined))).toThrow(ForbiddenException);
    expect(() => guard().canActivate(contextFor('MOBILITYBO_ADMIN'))).toThrow(
      ForbiddenException,
    );
  });

  it('la regla está a nivel de CLASE: vale igual para una lectura y para una escritura', () => {
    // Las lecturas también van gateadas por el rol de la sección, que es la diferencia con
    // MobilityManager. Si alguien moviera el decorador a un handler, los demás quedarían
    // abiertos a cualquier autenticado sin que nada falle.
    const reflector = new Reflector();
    const desdeLaClase = reflector.get<BackOfficeRole[]>(
      'backoffice_roles',
      WarehousesController,
    );
    expect(desdeLaClase).toEqual([BackOfficeRole.Administrador, BackOfficeRole.Usuario]);
  });

  it('los dos guards están puestos, y JwtGuard antes que RolesGuard', () => {
    // RolesGuard lee `req.user.role`, que lo popula JwtGuard. Invertidos, el rol llega
    // siempre indefinido y la sección le responde 403 a todo el mundo.
    const guards = Reflect.getMetadata('__guards__', WarehousesController) as unknown[];
    expect(guards).toEqual([JwtGuard, RolesGuard]);
  });
});
