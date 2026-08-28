import type { Request, Response } from 'express';
import {
  bearerFromCookie,
  createWabaAuthGuard,
  rewriteRedirectLocation,
  stripBackOfficeCookie,
  WABA_COOKIE,
  WABA_PREFIX,
} from './waba.proxy';
import { BackOfficeRole } from '../auth/backoffice-role.enum';

describe('bearerFromCookie', () => {
  it('extrae el token por nombre', () => {
    expect(bearerFromCookie('bo_waba_token=abc.def', WABA_COOKIE)).toBe('abc.def');
  });

  it('lo encuentra entre varias cookies', () => {
    expect(bearerFromCookie('connect.sid=s1; bo_waba_token=xyz; a=2', WABA_COOKIE)).toBe('xyz');
  });

  it('devuelve undefined si no esta, si falta el header o si viene vacia', () => {
    expect(bearerFromCookie('otra=1', WABA_COOKIE)).toBeUndefined();
    expect(bearerFromCookie(undefined, WABA_COOKIE)).toBeUndefined();
    expect(bearerFromCookie('bo_waba_token=', WABA_COOKIE)).toBeUndefined();
  });
});

/**
 * Es la diferencia central con el proxy del RAG, que borra el header Cookie entero.
 * WABA tiene sesion propia: sin sus cookies no puede mantener a nadie logueado.
 */
describe('stripBackOfficeCookie', () => {
  it('conserva la cookie de sesion de WABA', () => {
    expect(stripBackOfficeCookie('connect.sid=s1; bo_waba_token=t', WABA_COOKIE)).toBe(
      'connect.sid=s1',
    );
  });

  it('saca la de BackOffice aunque este primera', () => {
    expect(stripBackOfficeCookie('bo_waba_token=t; connect.sid=s1', WABA_COOKIE)).toBe(
      'connect.sid=s1',
    );
  });

  it('conserva varias cookies ajenas', () => {
    expect(
      stripBackOfficeCookie('a=1; bo_waba_token=t; b=2; c=3', WABA_COOKIE),
    ).toBe('a=1; b=2; c=3');
  });

  it('devuelve undefined si solo estaba la de BackOffice', () => {
    // No se manda un header Cookie vacio al upstream.
    expect(stripBackOfficeCookie('bo_waba_token=t', WABA_COOKIE)).toBeUndefined();
  });

  it('devuelve undefined sin header', () => {
    expect(stripBackOfficeCookie(undefined, WABA_COOKIE)).toBeUndefined();
  });

  it('no toca una cookie cuyo nombre solo empieza igual', () => {
    expect(stripBackOfficeCookie('bo_waba_token_x=1', WABA_COOKIE)).toBe('bo_waba_token_x=1');
  });

  it('el token de BackOffice NUNCA sale hacia WABA', () => {
    const out = stripBackOfficeCookie('connect.sid=s1; bo_waba_token=secreto', WABA_COOKIE);
    expect(out).not.toContain('secreto');
    expect(out).not.toContain(WABA_COOKIE);
  });
});

describe('rewriteRedirectLocation', () => {
  it('antepone el prefijo a un redirect local', () => {
    // WABA redirige mucho: login, selector de cuenta, /no-account.
    expect(rewriteRedirectLocation('/login', WABA_PREFIX)).toBe('/waba/login');
    expect(rewriteRedirectLocation('/accounts/select', WABA_PREFIX)).toBe(
      '/waba/accounts/select',
    );
  });

  it('no toca URLs absolutas ni protocol-relative', () => {
    expect(rewriteRedirectLocation('http://x.com/a', WABA_PREFIX)).toBe('http://x.com/a');
    expect(rewriteRedirectLocation('//x.com/a', WABA_PREFIX)).toBe('//x.com/a');
  });

  it('no duplica el prefijo', () => {
    expect(rewriteRedirectLocation('/waba/x', WABA_PREFIX)).toBe('/waba/x');
    expect(rewriteRedirectLocation('/waba', WABA_PREFIX)).toBe('/waba');
  });
});

describe('createWabaAuthGuard', () => {
  function mkRes() {
    const res = {
      statusCode: 0,
      body: '',
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      send(b: string) {
        this.body = b;
        return this;
      },
    };
    return res as unknown as Response & { statusCode: number; body: string };
  }
  const mkReq = (cookie?: string) =>
    ({ headers: cookie ? { cookie } : {} }) as unknown as Request;

  const payload = (role: BackOfficeRole) => ({
    sub: 'g',
    guid: 'g',
    email: 'x@y.com',
    username: 'X',
    isAdmin: false,
    role,
  });

  it('deja pasar a Marketing', async () => {
    const next = jest.fn();
    const guard = createWabaAuthGuard(async () => payload(BackOfficeRole.Marketing));
    await guard(mkReq('bo_waba_token=t'), mkRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('deja pasar a SuperAdmin', async () => {
    const next = jest.fn();
    const guard = createWabaAuthGuard(async () => payload(BackOfficeRole.SuperAdmin));
    await guard(mkReq('bo_waba_token=t'), mkRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('401 sin cookie', async () => {
    const res = mkRes();
    const next = jest.fn();
    const guard = createWabaAuthGuard(async () => payload(BackOfficeRole.Marketing));
    await guard(mkReq(undefined), res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('401 con token invalido', async () => {
    const res = mkRes();
    const next = jest.fn();
    const guard = createWabaAuthGuard(async () => {
      throw new Error('bad token');
    });
    await guard(mkReq('bo_waba_token=t'), res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('403 con rol sin acceso', async () => {
    const res = mkRes();
    const next = jest.fn();
    const guard = createWabaAuthGuard(
      async () => payload(BackOfficeRole.Soporte),
    );
    await guard(mkReq('bo_waba_token=t'), res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('403 si el token no trae rol', async () => {
    const res = mkRes();
    const next = jest.fn();
    const guard = createWabaAuthGuard(async () => ({}) as never);
    await guard(mkReq('bo_waba_token=t'), res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('el guard NO reemplaza al login de WABA: solo evita el proxy abierto', async () => {
    // Pasar el guard habilita el proxy; adentro WABA sigue pidiendo su propia sesion.
    const next = jest.fn();
    const guard = createWabaAuthGuard(async () => payload(BackOfficeRole.Marketing));
    await guard(mkReq('bo_waba_token=t'), mkRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
