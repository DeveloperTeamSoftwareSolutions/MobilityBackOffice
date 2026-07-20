import { describe, it, expect, vi, afterEach } from 'vitest';
import { jwtExpiryMs, isJwtExpired } from './jwt';

/** Arma un JWT de mentira (firma irrelevante: estos helpers no la verifican). */
function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256' })}.${b64(claims)}.firma-irrelevante`;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('jwtExpiryMs', () => {
  it('convierte exp (segundos) a milisegundos', () => {
    expect(jwtExpiryMs(fakeJwt({ exp: 1_700_000_000 }))).toBe(1_700_000_000_000);
  });

  it('devuelve null si el token no declara exp', () => {
    expect(jwtExpiryMs(fakeJwt({ email: 'x@y.com' }))).toBeNull();
  });

  it('devuelve null si exp no es numerico', () => {
    expect(jwtExpiryMs(fakeJwt({ exp: 'manana' }))).toBeNull();
  });

  it('devuelve null si el token no tiene tres partes', () => {
    expect(jwtExpiryMs('no-es-un-jwt')).toBeNull();
  });

  it('devuelve null si el payload no es base64 valido', () => {
    expect(jwtExpiryMs('abc.@@@no-base64@@@.def')).toBeNull();
  });
});

describe('isJwtExpired', () => {
  it('es false para un token que vence en el futuro', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const enUnaHora = Math.floor(Date.now() / 1000) + 3600;
    expect(isJwtExpired(fakeJwt({ exp: enUnaHora }))).toBe(false);
  });

  it('es true para un token ya vencido', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const haceUnaHora = Math.floor(Date.now() / 1000) - 3600;
    expect(isJwtExpired(fakeJwt({ exp: haceUnaHora }))).toBe(true);
  });

  it('es true justo en el instante de expiracion', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const ahora = Math.floor(Date.now() / 1000);
    expect(isJwtExpired(fakeJwt({ exp: ahora }))).toBe(true);
  });

  describe('ante la duda, se cierra la sesion', () => {
    it('un token sin exp se considera vencido', () => {
      expect(isJwtExpired(fakeJwt({ email: 'x@y.com' }))).toBe(true);
    });

    it('un token ilegible se considera vencido', () => {
      expect(isJwtExpired('basura')).toBe(true);
    });

    it('el string vacio se considera vencido', () => {
      expect(isJwtExpired('')).toBe(true);
    });
  });
});
