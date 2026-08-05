import type { ConfigService } from '@nestjs/config';
import {
  SOURCE_APP,
  middlewareBase,
  middlewareHeaders,
} from './middleware-request';

/** ConfigService mínimo: solo `get`. */
function configWith(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('middleware-request', () => {
  describe('middlewareBase', () => {
    it('normaliza quitando las barras finales', () => {
      expect(
        middlewareBase(configWith({ 'middleware.url': 'http://localhost:6002/api///' })),
      ).toBe('http://localhost:6002/api');
    });

    it('devuelve cadena vacía si no está configurado', () => {
      expect(middlewareBase(configWith({}))).toBe('');
    });
  });

  describe('middlewareHeaders', () => {
    it('SIEMPRE manda x-source-app — es lo que hace atribuible la auditoría del MW', () => {
      const headers = middlewareHeaders(configWith({}));
      expect(headers['x-source-app']).toBe(SOURCE_APP);
      expect(SOURCE_APP).toBe('MobilityBackOffice');
    });

    it('agrega x-api-key solo si MIDDLEWARE_API_KEY está configurada', () => {
      const conHeaders = middlewareHeaders(configWith({ 'middleware.apiKey': 'secreto' }));
      expect(conHeaders['x-api-key']).toBe('secreto');

      const sinHeaders = middlewareHeaders(configWith({}));
      expect(sinHeaders['x-api-key']).toBeUndefined();
    });

    it('sin api key igual manda el source (no se pierde la atribución)', () => {
      expect(middlewareHeaders(configWith({}))).toEqual({
        'x-source-app': 'MobilityBackOffice',
      });
    });

    it('con api key manda ambos headers', () => {
      expect(middlewareHeaders(configWith({ 'middleware.apiKey': 'k' }))).toEqual({
        'x-source-app': 'MobilityBackOffice',
        'x-api-key': 'k',
      });
    });

    it('api key vacía se trata como no configurada', () => {
      expect(
        middlewareHeaders(configWith({ 'middleware.apiKey': '' }))['x-api-key'],
      ).toBeUndefined();
    });
  });
});
