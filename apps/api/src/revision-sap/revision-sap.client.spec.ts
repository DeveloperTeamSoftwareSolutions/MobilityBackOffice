import { of, throwError } from 'rxjs';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { RevisionSapClient } from './revision-sap.client';

/**
 * Lo que se fija acá es CÓMO SE TRADUCE UN FALLO DEL ENVÍO, y no es un detalle de
 * redacción.
 *
 * El 2026-09-21, un 401 por API key equivocada se mostró como *"SAP no confirmó el
 * envío. Verificá en SAP si el pedido se creó antes de reintentar"*. El envío nunca
 * había salido y no existía ningún pedido: el mensaje mandó a buscar a SAP algo que no
 * estaba, por un problema de configuración. El mapeo tenía 409/404/400/422 y todo lo
 * demás caía en ese cajón.
 *
 * La regla que fijan estos tests: **"andá a mirar SAP" se dice SOLO cuando de verdad no
 * sabemos qué pasó.** Si sabemos que no se ejecutó nada, hay que decirlo.
 */

const ORDER = '11111111-2222-3333-4444-555555555555';

function make() {
  const http = { post: jest.fn(), get: jest.fn(), put: jest.fn() } as unknown as HttpService;
  const config = {
    get: (k: string) =>
      ({ 'middleware.url': 'http://mw:6002/api', 'middleware.apiKey': 'k' })[k],
  } as unknown as ConfigService;
  return { client: new RevisionSapClient(http, config), http };
}

/** Un fallo HTTP como lo entrega axios. */
const httpError = (status: number, error?: string) => ({
  response: { status, data: error ? { error } : undefined },
});

/** Un fallo de red/tiempo: no hay `response`, hay `code`. */
const netError = (code: string) => ({ code });

describe('RevisionSapClient.resendToSap — cómo se traduce cada fallo', () => {
  /**
   * EL CASO QUE ORIGINÓ ESTE ARCHIVO. El middleware exige `x-api-key` para aceptar
   * `asBackoffice: true` y responde 401 SIN ejecutar nada.
   */
  it('401 dice que es la credencial y que NO se creó nada en SAP', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(
      throwError(() => httpError(401, 'asBackoffice=true requiere header x-api-key valido')),
    );

    await expect(client.resendToSap(ORDER, 'bo@duwest.com')).rejects.toMatchObject({
      message: expect.stringContaining('No se creó ningún pedido en SAP'),
    });
    // Y NO manda a revisar SAP: no hay nada que revisar.
    await expect(client.resendToSap(ORDER, 'bo@duwest.com')).rejects.not.toMatchObject({
      message: expect.stringContaining('Verificá en SAP'),
    });
  });

  it('403 se trata igual que el 401: es la misma causa', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(throwError(() => httpError(403)));

    await expect(client.resendToSap(ORDER, 'bo@duwest.com')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(client.resendToSap(ORDER, 'bo@duwest.com')).rejects.toMatchObject({
      message: expect.stringContaining('MIDDLEWARE_API_KEY'),
    });
  });

  /** 422 = el middleware cortó antes de SAP (faltan centros). Es accionable y no creó nada. */
  it('422 trae el motivo del middleware y aclara que no se creó nada', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(
      throwError(() => httpError(422, 'Este endpoint agrupa por CenterCode y 2 item(s) no lo tienen.')),
    );

    await expect(client.resendToSap(ORDER, 'bo@duwest.com')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(client.resendToSap(ORDER, 'bo@duwest.com')).rejects.toMatchObject({
      message: expect.stringContaining('agrupa por CenterCode'),
    });
  });

  it('409 avisa que el pedido ya existe: reenviarlo lo duplicaría', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(throwError(() => httpError(409)));

    await expect(client.resendToSap(ORDER, 'bo@duwest.com')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('404 es orden inexistente', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(throwError(() => httpError(404)));

    await expect(client.resendToSap(ORDER, 'bo@duwest.com')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('si no se pudo contactar al middleware, lo dice: el envío no salió', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(throwError(() => netError('ECONNREFUSED')));

    await expect(client.resendToSap(ORDER, 'bo@duwest.com')).rejects.toMatchObject({
      message: expect.stringContaining('no se creó ningún pedido en SAP'),
    });
  });

  /**
   * EL ÚNICO CASO INCIERTO. La petición salió y se cortó por tiempo: puede haber
   * pedidos creados. Acá SÍ hay que mandar a mirar SAP — y avisar que, con la orden
   * partida, puede haber salido una parte.
   */
  it('un timeout SÍ manda a verificar en SAP, y avisa que puede haber salido una parte', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(throwError(() => netError('ECONNABORTED')));

    await expect(client.resendToSap(ORDER, 'bo@duwest.com')).rejects.toMatchObject({
      message: expect.stringContaining('Verificá en SAP'),
    });
    await expect(client.resendToSap(ORDER, 'bo@duwest.com')).rejects.toMatchObject({
      message: expect.stringContaining('puede haber salido una parte'),
    });
  });

  it('un 500 del middleware también es incierto: manda a verificar', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(throwError(() => httpError(500)));

    await expect(client.resendToSap(ORDER, 'bo@duwest.com')).rejects.toMatchObject({
      message: expect.stringContaining('Verificá en SAP'),
    });
  });
});

describe('RevisionSapClient.resendToSap — la respuesta por centro', () => {
  const respuesta = (sap: Record<string, unknown>) => of({ data: { success: true, data: { sap } } });

  it('pega al envío por centro, con asBackoffice y el email', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(respuesta({ buckets: [] }));

    await client.resendToSap(ORDER, 'bo@duwest.com');

    const [url, body] = (http.post as jest.Mock).mock.calls[0];
    expect(url).toContain('/v2/mobility/businessorders2sap-from-backoffice');
    expect(body).toEqual({
      guidBusinessOrders: ORDER,
      asBackoffice: true,
      actorEmail: 'bo@duwest.com',
    });
  });

  /**
   * El `success` de arriba del middleware MIENTE: viene `false` en ramas que sólo
   * avisan de ítems sin stock, aunque SAP haya aceptado todo. La verdad son los buckets.
   */
  it('con todos los centros aceptados, `accepted` sale de los buckets', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(
      of({
        data: {
          success: false, // ← el que miente
          data: {
            sap: {
              buckets: [
                { centerCode: '2801', itemsCount: 1, sent: true, success: true, orderId: '1', deliveryId: '9' },
              ],
            },
          },
        },
      }),
    );

    const r = await client.resendToSap(ORDER, 'bo@duwest.com');

    expect(r.accepted).toBe(true);
    expect(r.stillInReview).toBe(false);
  });

  it('un centro sin entrega se marca aparte, no como rechazo', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(
      respuesta({
        buckets: [
          { centerCode: '2801', itemsCount: 1, sent: true, success: true, orderId: '1', deliveryId: null },
        ],
      }),
    );

    const r = await client.resendToSap(ORDER, 'bo@duwest.com');

    expect(r.buckets[0].status).toBe('accepted_no_dispatch');
    expect(r.accepted).toBe(true);
  });

  it('con un centro afuera marca `partial`: lo que salió ya existe en SAP', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(
      respuesta({
        buckets: [
          { centerCode: '2801', itemsCount: 1, sent: true, success: true, orderId: '1', deliveryId: '9' },
          { centerCode: '2802', itemsCount: 1, sent: true, success: false, error: '[E] no ampliado' },
        ],
      }),
    );

    const r = await client.resendToSap(ORDER, 'bo@duwest.com');

    expect(r.partial).toBe(true);
    expect(r.accepted).toBe(false);
    expect(r.acceptedBuckets).toBe(1);
    expect(r.failedBuckets).toBe(1);
    expect(r.stillInReview).toBe(true);
  });

  it('el skip del middleware no es un rechazo', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(
      respuesta({ skipped: true, reason: 'GroupInvoice=1 con items sin stock' }),
    );

    const r = await client.resendToSap(ORDER, 'bo@duwest.com');

    expect(r.skipped).toBe(true);
    expect(r.accepted).toBe(false);
    expect(r.partial).toBe(false);
    expect(r.skippedReason).toContain('GroupInvoice');
  });
});
