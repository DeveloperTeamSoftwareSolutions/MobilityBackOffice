import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { TemplatesClient } from './templates.client';

/**
 * El cliente hacia WABA.
 *
 * Lo que se fija acá es la traducción de errores: WABA valida las plantillas con el mismo
 * validador que usa su asistente, y esos mensajes son lo único que le explica a alguien
 * por qué META rechazó algo. Perderlos deja la pantalla sin nada que mostrar.
 */
describe('TemplatesClient', () => {
  function armar(config: Record<string, string | undefined> = {}) {
    const http = { post: jest.fn(), get: jest.fn() };
    const cfg = {
      get: (k: string) =>
        ({
          'waba.apiUrl': 'http://waba.local',
          'waba.apiKey': 'k',
          ...config,
        })[k],
    };
    return {
      http,
      client: new TemplatesClient(
        http as unknown as HttpService,
        cfg as unknown as ConfigService,
      ),
    };
  }

  /** Error de axios con la respuesta de WABA adentro. */
  function fallo(status: number, data: unknown) {
    return throwError(() => ({ response: { status, data } }));
  }

  describe('validate', () => {
    it('devuelve el payload que armó WABA', async () => {
      const { http, client } = armar();
      http.post.mockReturnValue(
        of({
          data: {
            data: { valid: true, errors: [], payload: { name: 'x' }, payloadError: null },
          },
        }),
      );

      const res = await client.validate({ name: 'x' });

      expect(res.valid).toBe(true);
      expect(res.payload).toEqual({ name: 'x' });
    });

    it('una respuesta sin cuerpo no rompe: queda inválida y sin payload', async () => {
      const { http, client } = armar();
      http.post.mockReturnValue(of({ data: {} }));

      const res = await client.validate({});

      expect(res).toEqual({ valid: false, errors: [], payload: null, payloadError: null });
    });
  });

  describe('traducción de errores', () => {
    it('un 4xx conserva el mensaje de WABA', async () => {
      // Es la validación de META explicada: sin ella no hay nada que corregir.
      const { http, client } = armar();
      http.post.mockReturnValue(
        fallo(400, { message: 'Las variables deben numerarse desde {{1}}' }),
      );

      await expect(client.validate({})).rejects.toThrow(BadRequestException);
      await expect(client.validate({})).rejects.toThrow(
        'Las variables deben numerarse desde {{1}}',
      );
    });

    it('un 409 es conflicto, no error del servidor', async () => {
      // META tiene una revisión en curso: no es que algo falló, es que ahora no se puede.
      const { http, client } = armar();
      http.post.mockReturnValue(fallo(409, { message: 'La plantilla está en revisión' }));

      await expect(client.saveDraft({})).rejects.toThrow(ConflictException);
    });

    it('un 5xx conserva el motivo que mandó WABA', async () => {
      // WABA arma ese texto con `friendlyError`: ya extrajo el mensaje de META y le
      // enmascaró el token. Tirarlo deja un 503 mudo, imposible de diagnosticar.
      const { http, client } = armar();
      http.post.mockReturnValue(
        fallo(500, { success: false, message: 'Malformed access token EAAM4V12****Dxxx' }),
      );

      const error: unknown = await client.saveDraft({}).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as Error).message).toContain('Malformed access token');
    });

    it('un 5xx sin cuerpo se queda con el mensaje genérico', async () => {
      // Una caída sin sobre JSON (un proxy, un HTML de error) no aporta nada que mostrar.
      const { http, client } = armar();
      http.post.mockReturnValue(fallo(502, '<html>Bad Gateway</html>'));

      const error: unknown = await client.saveDraft({}).catch((e: unknown) => e);

      expect((error as Error).message).toBe('No se pudo guardar el borrador');
    });
  });

  it('sin URL ni key la sección no puede funcionar', async () => {
    // Se corta acá: sin configuración, la llamada iría a una URL vacía.
    const { client } = armar({ 'waba.apiUrl': undefined, 'waba.apiKey': undefined });

    await expect(client.validate({})).rejects.toThrow();
  });
});
