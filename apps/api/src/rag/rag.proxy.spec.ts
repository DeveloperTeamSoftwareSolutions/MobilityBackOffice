import type { Request, Response } from 'express';
import {
  bearerFromCookie,
  rewriteRedirectLocation,
  createRagAuthGuard,
  RAG_PREFIX,
  RAG_COOKIE,
} from './rag.proxy';
import { BackOfficeRole } from '../auth/backoffice-role.enum';

describe('bearerFromCookie', () => {
  it('extrae el token de la cookie por nombre', () => {
    expect(bearerFromCookie('bo_rag_token=abc.def.ghi', RAG_COOKIE)).toBe('abc.def.ghi');
  });

  it('lo encuentra entre varias cookies', () => {
    expect(
      bearerFromCookie('otra=1; bo_rag_token=xyz; mas=2', RAG_COOKIE),
    ).toBe('xyz');
  });

  it('devuelve undefined si no esta', () => {
    expect(bearerFromCookie('otra=1', RAG_COOKIE)).toBeUndefined();
  });

  it('devuelve undefined sin header de cookies', () => {
    expect(bearerFromCookie(undefined, RAG_COOKIE)).toBeUndefined();
  });

  it('devuelve undefined si la cookie esta vacia', () => {
    expect(bearerFromCookie('bo_rag_token=', RAG_COOKIE)).toBeUndefined();
  });
});

describe('rewriteRedirectLocation', () => {
  it('antepone el prefijo a un redirect absoluto local', () => {
    expect(rewriteRedirectLocation('/login', RAG_PREFIX)).toBe('/rag/login');
  });

  it('no toca una URL absoluta http', () => {
    expect(rewriteRedirectLocation('http://x.com/a', RAG_PREFIX)).toBe('http://x.com/a');
  });

  it('no toca protocol-relative //', () => {
    expect(rewriteRedirectLocation('//x.com/a', RAG_PREFIX)).toBe('//x.com/a');
  });

  it('no duplica el prefijo si ya esta', () => {
    expect(rewriteRedirectLocation('/rag/x', RAG_PREFIX)).toBe('/rag/x');
    expect(rewriteRedirectLocation('/rag', RAG_PREFIX)).toBe('/rag');
  });
});

describe('createRagAuthGuard', () => {
  function mockRes() {
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

  function reqWithCookie(cookie?: string): Request {
    return { headers: cookie ? { cookie } : {} } as unknown as Request;
  }

  const okPayload = (role: BackOfficeRole) => ({
    sub: 'g',
    guid: 'g',
    email: 'x@y.com',
    username: 'X',
    isAdmin: false,
    role,
  });

  it('deja pasar a un usuario Marketing con token valido', async () => {
    const verify = jest.fn().mockResolvedValue(okPayload(BackOfficeRole.Marketing));
    const guard = createRagAuthGuard(verify);
    const next = jest.fn();
    const res = mockRes();

    await guard(reqWithCookie('bo_rag_token=t'), res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });

  it('deja pasar a SuperAdmin', async () => {
    const verify = jest.fn().mockResolvedValue(okPayload(BackOfficeRole.SuperAdmin));
    const guard = createRagAuthGuard(verify);
    const next = jest.fn();
    await guard(reqWithCookie('bo_rag_token=t'), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('401 si no hay cookie', async () => {
    const verify = jest.fn();
    const guard = createRagAuthGuard(verify);
    const next = jest.fn();
    const res = mockRes();

    await guard(reqWithCookie(undefined), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(verify).not.toHaveBeenCalled();
  });

  it('401 si el token es invalido', async () => {
    const verify = jest.fn().mockRejectedValue(new Error('bad token'));
    const guard = createRagAuthGuard(verify);
    const next = jest.fn();
    const res = mockRes();

    await guard(reqWithCookie('bo_rag_token=t'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('403 si el rol no es Marketing ni SuperAdmin', async () => {
    const verify = jest
      .fn()
      .mockResolvedValue(okPayload(BackOfficeRole.Administrador));
    const guard = createRagAuthGuard(verify);
    const next = jest.fn();
    const res = mockRes();

    await guard(reqWithCookie('bo_rag_token=t'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('403 si el payload no trae rol', async () => {
    const verify = jest.fn().mockResolvedValue({ email: 'x@y.com' });
    const guard = createRagAuthGuard(verify);
    const next = jest.fn();
    const res = mockRes();

    await guard(reqWithCookie('bo_rag_token=t'), res, next);

    expect(res.statusCode).toBe(403);
  });
});
