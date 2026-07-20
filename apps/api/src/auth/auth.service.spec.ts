import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RoleResolver } from './role-resolver.service';
import { BackOfficeRole } from './backoffice-role.enum';
import type { ItmanagerClient, ItmanagerLoginResult } from './itmanager.client';
import type { TokenService } from './token.service';
import type { AuditService, AuditEntry } from '../audit/audit.service';

const ITM_OK: ItmanagerLoginResult = {
  token: 'token-de-manageit',
  user: {
    guid: 'guid-usuario',
    email: 'juan@duwest.com',
    name: 'Juan Perez',
    isAdmin: false,
  },
  roleKeys: ['MOBILITYBO_ADMIN'],
  permissions: ['REGIONS_WRITE'],
};

function build(overrides: {
  itm?: Partial<ItmanagerClient>;
  audit?: Partial<AuditService>;
  token?: Partial<TokenService>;
}) {
  const audited: AuditEntry[] = [];

  const itmanager = {
    login: jest.fn().mockResolvedValue(ITM_OK),
    ...overrides.itm,
  } as unknown as ItmanagerClient;

  const audit = {
    record: jest.fn((e: AuditEntry) => {
      audited.push(e);
      return Promise.resolve();
    }),
    ...overrides.audit,
  } as unknown as AuditService;

  const tokens = {
    sign: jest.fn().mockResolvedValue('token-propio-backoffice'),
    ...overrides.token,
  } as unknown as TokenService;

  const service = new AuthService(itmanager, new RoleResolver(), audit, tokens);
  return { service, audited, itmanager, tokens };
}

const CREDS = { email: 'juan@duwest.com', password: 'secreto' };

describe('AuthService.login', () => {
  describe('login exitoso', () => {
    it('devuelve el token PROPIO de BackOffice, no el de ManageIT', async () => {
      const { service } = build({});
      const res = await service.login(CREDS);
      expect(res.token).toBe('token-propio-backoffice');
      expect(res.token).not.toBe('token-de-manageit');
    });

    it('firma el token con el rol resuelto y la identidad del usuario', async () => {
      const { service, tokens } = build({});
      await service.login(CREDS);
      expect(tokens.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'guid-usuario',
          guid: 'guid-usuario',
          email: 'juan@duwest.com',
          username: 'Juan Perez',
          isAdmin: false,
          role: BackOfficeRole.Administrador,
        }),
      );
    });

    it('devuelve rol, usuario y permisos', async () => {
      const { service } = build({});
      const res = await service.login(CREDS);
      expect(res.role).toBe(BackOfficeRole.Administrador);
      expect(res.user).toEqual({
        email: 'juan@duwest.com',
        name: 'Juan Perez',
        guidUsers: 'guid-usuario',
      });
      expect(res.permissions).toEqual(['REGIONS_WRITE']);
    });

    it('audita el acceso con accion LOGIN y el guid del usuario', async () => {
      const { service, audited } = build({});
      await service.login(CREDS);
      expect(audited).toHaveLength(1);
      expect(audited[0]).toMatchObject({
        action: 'LOGIN',
        entity: 'Auth',
        category: 'auth',
        guidUsers: 'guid-usuario',
      });
      expect(audited[0].detail).toContain('juan@duwest.com');
      expect(audited[0].detail).toContain('Administrador');
    });
  });

  describe('usuario sin rol en BackOffice', () => {
    const sinRol = {
      itm: {
        login: jest.fn().mockResolvedValue({
          ...ITM_OK,
          roleKeys: ['MOBILITYMGR_GERENTE'], // rol de otra app
        }),
      },
    };

    it('rechaza con 403', async () => {
      const { service } = build(sinRol);
      await expect(service.login(CREDS)).rejects.toThrow(ForbiddenException);
    });

    it('no emite ningun token', async () => {
      const { service, tokens } = build(sinRol);
      await expect(service.login(CREDS)).rejects.toThrow();
      expect(tokens.sign).not.toHaveBeenCalled();
    });

    it('audita LOGIN_FAILED explicando el motivo', async () => {
      const { service, audited } = build(sinRol);
      await expect(service.login(CREDS)).rejects.toThrow();
      expect(audited[0]).toMatchObject({ action: 'LOGIN_FAILED' });
      expect(audited[0].detail).toContain('sin rol asignado');
    });
  });

  describe('isAdmin global de ManageIT', () => {
    it('un superadmin de otra app SIN rol de BackOffice entra como SuperAdmin', async () => {
      // Comportamiento heredado y deliberado: isAdmin de ManageIT ya incluye
      // cualquier *_SUPERADMIN. Se documenta con un test para que el dia que se
      // quiera cerrar, el cambio sea visible y no accidental.
      const { service } = build({
        itm: {
          login: jest.fn().mockResolvedValue({
            ...ITM_OK,
            user: { ...ITM_OK.user, isAdmin: true },
            roleKeys: [],
          }),
        },
      });
      const res = await service.login(CREDS);
      expect(res.role).toBe(BackOfficeRole.SuperAdmin);
    });
  });

  describe('credenciales invalidas', () => {
    const malas = {
      itm: {
        login: jest
          .fn()
          .mockRejectedValue(new UnauthorizedException('Credenciales inválidas')),
      },
    };

    it('propaga el error de ITManager', async () => {
      const { service } = build(malas);
      await expect(service.login(CREDS)).rejects.toThrow(UnauthorizedException);
    });

    it('audita LOGIN_FAILED sin guid (el usuario no se identifico)', async () => {
      const { service, audited } = build(malas);
      await expect(service.login(CREDS)).rejects.toThrow();
      expect(audited[0]).toMatchObject({
        action: 'LOGIN_FAILED',
        guidUsers: null,
      });
      expect(audited[0].detail).toContain('juan@duwest.com');
    });
  });
});
