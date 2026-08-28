import { AuthController } from './auth.controller';
import type { AuthService, LoginResult } from './auth.service';
import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { RAG_COOKIE, RAG_PREFIX } from '../rag/rag.proxy';
import { WABA_COOKIE, WABA_PREFIX } from '../waba/waba.proxy';
import { BackOfficeRole } from './backoffice-role.enum';

/** Token cuyo claim exp cae dentro de ~1h (para el maxAge de la cookie). */
function tokenConExp(offsetSeg: number): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + offsetSeg;
  return `${b64({ alg: 'HS256' })}.${b64({ exp })}.firma`;
}

function mockRes() {
  const cookies: Array<{ name: string; value: string; opts: unknown }> = [];
  const cleared: Array<{ name: string; opts: unknown }> = [];
  const res = {
    cookie(name: string, value: string, opts: unknown) {
      cookies.push({ name, value, opts });
      return this;
    },
    clearCookie(name: string, opts: unknown) {
      cleared.push({ name, opts });
      return this;
    },
  };
  return { res: res as unknown as Response, cookies, cleared };
}

function build(nodeEnv = 'development') {
  const token = tokenConExp(3600);
  const loginResult: LoginResult = {
    token,
    user: { email: 'mkt@duwest.com', name: 'Mkt', guidUsers: 'g1' },
    role: BackOfficeRole.Marketing,
    permissions: [],
  };
  const authService = {
    login: jest.fn().mockResolvedValue(loginResult),
  } as unknown as AuthService;
  const config = {
    get: jest.fn((k: string) => (k === 'nodeEnv' ? nodeEnv : undefined)),
  } as unknown as ConfigService;

  return { controller: new AuthController(authService, config), token };
}

describe('AuthController.login (cookies de los embebidos)', () => {
  /**
   * Una cookie por embebido, cada una scopeada a su prefijo. Un iframe no puede mandar
   * `Authorization`, asi que la sesion tiene que viajar por cookie; scoparla evita que
   * la del RAG llegue al proxy de WABA y viceversa.
   */
  it.each([
    [RAG_COOKIE, RAG_PREFIX],
    [WABA_COOKIE, WABA_PREFIX],
  ])('setea %s scopeada a %s, httpOnly y con vencimiento', async (name, prefix) => {
    const { controller, token } = build();
    const { res, cookies } = mockRes();

    await controller.login({ email: 'mkt@duwest.com', password: 'x' }, res);

    const c = cookies.find((x) => x.name === name);
    expect(c).toBeDefined();
    expect(c?.value).toBe(token);
    expect(c?.opts).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: prefix,
    });
    expect((c?.opts as { maxAge: number }).maxAge).toBeGreaterThan(0);
  });

  it('setea una cookie por embebido y ninguna mas', async () => {
    const { controller } = build();
    const { res, cookies } = mockRes();

    await controller.login({ email: 'mkt@duwest.com', password: 'x' }, res);

    expect(cookies.map((c) => c.name).sort()).toEqual([RAG_COOKIE, WABA_COOKIE].sort());
  });

  it('devuelve el token y el rol en el body', async () => {
    const { controller } = build();
    const { res } = mockRes();
    const out = await controller.login(
      { email: 'mkt@duwest.com', password: 'x' },
      res,
    );
    expect(out.success).toBe(true);
    expect(out.role).toBe(BackOfficeRole.Marketing);
  });

  it('en produccion la cookie es secure', async () => {
    const { controller } = build('production');
    const { res, cookies } = mockRes();
    await controller.login({ email: 'mkt@duwest.com', password: 'x' }, res);
    expect((cookies[0].opts as { secure: boolean }).secure).toBe(true);
  });

  it('en desarrollo la cookie NO es secure (si no, no se setea en http)', async () => {
    const { controller } = build('development');
    const { res, cookies } = mockRes();
    await controller.login({ email: 'mkt@duwest.com', password: 'x' }, res);
    expect((cookies[0].opts as { secure: boolean }).secure).toBe(false);
  });
});

describe('AuthController.logout', () => {
  it('limpia las cookies de los DOS embebidos, cada una con su path', () => {
    // Si quedara una sin limpiar, el iframe correspondiente seguiria autorizado
    // despues de cerrar sesion en BackOffice.
    const { controller } = build();
    const { res, cleared } = mockRes();

    const out = controller.logout(res);

    expect(out).toEqual({ success: true });
    expect(cleared).toHaveLength(2);

    const rag = cleared.find((c) => c.name === RAG_COOKIE);
    const waba = cleared.find((c) => c.name === WABA_COOKIE);
    expect(rag?.opts).toMatchObject({ path: RAG_PREFIX });
    expect(waba?.opts).toMatchObject({ path: WABA_PREFIX });
  });
});
