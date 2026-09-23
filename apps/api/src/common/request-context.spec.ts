import { run, setActor, actorRole, actorEmail } from './request-context';
import { middlewareHeaders, SOURCE_APP } from './middleware-request';
import type { ConfigService } from '@nestjs/config';

/**
 * El middleware audita cada movimiento de una orden o cotización en
 * DocumentAuditLog y guarda CON QUÉ ROL se disparó (header `x-actor-role`). La
 * app sola no alcanza: en la misma app actúan roles distintos, y el rol es lo
 * que explica la acción.
 */
const config = { get: (k: string): string | undefined => (k === 'middleware.apiKey' ? undefined : '') } as unknown as ConfigService;

describe('request-context', () => {
  it('fuera de una request no hay rol y los headers salen como antes', () => {
    expect(actorRole()).toBeNull();
    expect(middlewareHeaders(config)).toEqual({ 'x-source-app': SOURCE_APP });
  });

  it('con el usuario autenticado el rol viaja en los headers', () => {
    run(() => {
      setActor({ email: 'c@duwest.com', roles: ['creditos'] });
      expect(actorRole()).toBe('creditos');
      expect(actorEmail()).toBe('c@duwest.com');
      expect(middlewareHeaders(config)['x-actor-role']).toBe('creditos');
    });
  });

  it('admin gana: es el rol que explica lo que los demás no pueden hacer', () => {
    run(() => {
      setActor({ email: 'a@duwest.com', roles: ['seller'], isAdmin: true });
      expect(actorRole()).toBe('admin');
    });
  });

  it('sin roles no se manda el header, no se manda vacío', () => {
    run(() => {
      setActor({ email: 'x@duwest.com', roles: [] });
      expect(actorRole()).toBeNull();
      expect(middlewareHeaders(config)['x-actor-role']).toBeUndefined();
    });
  });

  it('un payload que no es objeto no rompe', () => {
    run(() => {
      setActor('no soy un usuario');
      expect(actorRole()).toBeNull();
    });
  });

  it('el rol se recorta a lo que entra en la columna del middleware', () => {
    run(() => {
      setActor({ email: 'x@duwest.com', roles: ['r'.repeat(80)] });
      expect(actorRole()?.length).toBe(32);
    });
  });

  it('cada request tiene su propio contexto', () => {
    run(() => {
      setActor({ email: 'uno@duwest.com', roles: ['manager'] });
      run(() => {
        expect(actorRole()).toBeNull();
      });
      expect(actorRole()).toBe('manager');
    });
  });
});
