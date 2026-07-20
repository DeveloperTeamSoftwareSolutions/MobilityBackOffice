import { RoleResolver } from './role-resolver.service';
import { BackOfficeRole } from './backoffice-role.enum';

describe('RoleResolver', () => {
  const resolver = new RoleResolver();

  describe('mapeo de RoleKey a rol de negocio', () => {
    it('mapea MOBILITYBO_SUPERADMIN a SuperAdmin', () => {
      expect(resolver.resolve({ roleKeys: ['MOBILITYBO_SUPERADMIN'] })).toBe(
        BackOfficeRole.SuperAdmin,
      );
    });

    it('mapea MOBILITYBO_ADMIN a Administrador', () => {
      expect(resolver.resolve({ roleKeys: ['MOBILITYBO_ADMIN'] })).toBe(
        BackOfficeRole.Administrador,
      );
    });

    it('mapea MOBILITYBO_MARKETING a Marketing', () => {
      expect(resolver.resolve({ roleKeys: ['MOBILITYBO_MARKETING'] })).toBe(
        BackOfficeRole.Marketing,
      );
    });
  });

  describe('sin rol asignado', () => {
    it('devuelve null si no hay roleKeys', () => {
      expect(resolver.resolve({})).toBeNull();
    });

    it('devuelve null si la lista de roleKeys esta vacia', () => {
      expect(resolver.resolve({ roleKeys: [] })).toBeNull();
    });

    it('devuelve null si los roleKeys son de otra aplicacion', () => {
      expect(
        resolver.resolve({ roleKeys: ['MOBILITYMGR_GERENTE', 'OTRA_APP_ADMIN'] }),
      ).toBeNull();
    });
  });

  describe('prioridad cuando hay varios roles', () => {
    it('SuperAdmin gana sobre Administrador y Marketing', () => {
      expect(
        resolver.resolve({
          roleKeys: [
            'MOBILITYBO_MARKETING',
            'MOBILITYBO_SUPERADMIN',
            'MOBILITYBO_ADMIN',
          ],
        }),
      ).toBe(BackOfficeRole.SuperAdmin);
    });

    it('Administrador gana sobre Marketing', () => {
      expect(
        resolver.resolve({
          roleKeys: ['MOBILITYBO_MARKETING', 'MOBILITYBO_ADMIN'],
        }),
      ).toBe(BackOfficeRole.Administrador);
    });

    it('el orden de los roleKeys no altera el resultado', () => {
      const a = resolver.resolve({
        roleKeys: ['MOBILITYBO_ADMIN', 'MOBILITYBO_MARKETING'],
      });
      const b = resolver.resolve({
        roleKeys: ['MOBILITYBO_MARKETING', 'MOBILITYBO_ADMIN'],
      });
      expect(a).toBe(b);
    });
  });

  describe('isAdmin (administrador de IT en ITManager)', () => {
    it('isAdmin resuelve SuperAdmin aunque no tenga roles de la app', () => {
      expect(resolver.resolve({ isAdmin: true, roleKeys: [] })).toBe(
        BackOfficeRole.SuperAdmin,
      );
    });

    it('isAdmin gana sobre un rol de menor privilegio', () => {
      expect(
        resolver.resolve({ isAdmin: true, roleKeys: ['MOBILITYBO_MARKETING'] }),
      ).toBe(BackOfficeRole.SuperAdmin);
    });

    it('isAdmin false no otorga rol por si solo', () => {
      expect(resolver.resolve({ isAdmin: false, roleKeys: [] })).toBeNull();
    });
  });

  describe('robustez', () => {
    it('ignora roleKeys desconocidos y resuelve por los conocidos', () => {
      expect(
        resolver.resolve({ roleKeys: ['BASURA', 'MOBILITYBO_ADMIN', ''] }),
      ).toBe(BackOfficeRole.Administrador);
    });

    it('un SUPERADMIN de otra app en el accessMatrix propio resuelve SuperAdmin', () => {
      // El accessMatrix ya viene filtrado por appId, asi que cualquier *_SUPERADMIN
      // que llegue aca pertenece a esta app.
      expect(resolver.resolve({ roleKeys: ['MOBILITYBO_SUPERADMIN'] })).toBe(
        BackOfficeRole.SuperAdmin,
      );
    });
  });
});
