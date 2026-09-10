import { of, throwError } from 'rxjs';
import { ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { RegionsClient, mapProfitCenter, MIN_MW_VERSION_REGION_GROUPS } from './regions.client';

function make(cfg: Record<string, string | undefined>) {
  const http = { get: jest.fn() } as unknown as HttpService;
  const config = { get: (k: string) => cfg[k] } as unknown as ConfigService;
  return { client: new RegionsClient(http, config), http };
}

const BASE = { 'middleware.url': 'http://mw:6002/api/' };
const URL = 'http://mw:6002/api/v2/mobility/profit-centers';

/** Respuesta del middleware: `data` en camelCase + `pagination` estándar. */
function page(items: { profitCenterCode: string; profitCenterName: string | null }[], total = items.length) {
  return of({
    data: {
      success: true,
      data: items,
      pagination: { total, page: 1, limit: 200, totalPages: 1 },
    },
  });
}

describe('mapProfitCenter', () => {
  it('mapea camelCase del middleware a { code, name } y trimea el código', () => {
    expect(mapProfitCenter({ profitCenterCode: '1080  ', profitCenterName: 'Qualicon' })).toEqual({
      code: '1080',
      name: 'Qualicon',
    });
  });

  it('name null si falta; code vacío si el middleware no lo manda', () => {
    expect(mapProfitCenter({ profitCenterCode: null, profitCenterName: null })).toEqual({
      code: '',
      name: null,
    });
  });
});

describe('RegionsClient.searchProfitCenters', () => {
  it('pega a /v2/mobility/profit-centers con search, limit y orden por código', async () => {
    const { client, http } = make(BASE);
    (http.get as jest.Mock).mockReturnValue(page([]));

    await client.searchProfitCenters('quali', 20);

    const [url, opts] = (http.get as jest.Mock).mock.calls[0];
    expect(url).toBe(URL);
    expect(opts.params).toEqual({
      search: 'quali',
      page: 1,
      limit: 20,
      sortBy: 'ProfitCenterCode',
      sortDir: 'ASC',
    });
    // Sin key → sin x-api-key, pero el source SIEMPRE viaja (helper compartido): es lo
    // que permite que el middleware atribuya la llamada en sus ApiLogs.
    expect(opts.headers).toEqual({ 'x-source-app': 'MobilityBackOffice' });
  });

  it('sin término de búsqueda no manda `search` (el middleware lista todo)', async () => {
    const { client, http } = make(BASE);
    (http.get as jest.Mock).mockReturnValue(page([]));

    await client.searchProfitCenters('', 20);

    expect((http.get as jest.Mock).mock.calls[0][1].params.search).toBeUndefined();
  });

  it('clampea el limit al tope del endpoint (200)', async () => {
    const { client, http } = make(BASE);
    (http.get as jest.Mock).mockReturnValue(page([]));

    await client.searchProfitCenters('x', 5000);

    expect((http.get as jest.Mock).mock.calls[0][1].params.limit).toBe(200);
  });

  it('mapea la data del middleware al DTO del módulo', async () => {
    const { client, http } = make(BASE);
    (http.get as jest.Mock).mockReturnValue(
      page([
        { profitCenterCode: '1080', profitCenterName: 'Qualicon' },
        { profitCenterCode: '1003', profitCenterName: null },
      ]),
    );

    expect(await client.searchProfitCenters('', 50)).toEqual([
      { code: '1080', name: 'Qualicon' },
      { code: '1003', name: null },
    ]);
  });

  it('manda x-api-key cuando MIDDLEWARE_API_KEY está configurada', async () => {
    const { client, http } = make({ ...BASE, 'middleware.apiKey': 'secret' });
    (http.get as jest.Mock).mockReturnValue(page([]));

    await client.searchProfitCenters('', 20);

    expect((http.get as jest.Mock).mock.calls[0][1].headers).toEqual({
      'x-source-app': 'MobilityBackOffice',
      'x-api-key': 'secret',
    });
  });

  it('traduce un fallo de red del middleware a 503', async () => {
    const { client, http } = make(BASE);
    (http.get as jest.Mock).mockReturnValue(throwError(() => new Error('ECONNREFUSED')));

    await expect(client.searchProfitCenters('', 20)).rejects.toThrow(ServiceUnavailableException);
  });
});

describe('RegionsClient.getAllProfitCenters', () => {
  it('pide el catálogo completo en modo export', async () => {
    const { client, http } = make(BASE);
    (http.get as jest.Mock).mockReturnValue(
      page([{ profitCenterCode: '1080', profitCenterName: 'Qualicon' }]),
    );

    expect(await client.getAllProfitCenters()).toEqual([{ code: '1080', name: 'Qualicon' }]);

    const [url, opts] = (http.get as jest.Mock).mock.calls[0];
    expect(url).toBe(URL);
    expect(opts.params).toEqual({
      export: 1,
      page: 1,
      limit: 50000,
      sortBy: 'ProfitCenterCode',
      sortDir: 'ASC',
    });
    expect((http.get as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it('sigue paginando mientras falten filas del total (no trunca en silencio)', async () => {
    const { client, http } = make(BASE);
    (http.get as jest.Mock)
      .mockReturnValueOnce(page([{ profitCenterCode: '1', profitCenterName: 'A' }], 2))
      .mockReturnValueOnce(page([{ profitCenterCode: '2', profitCenterName: 'B' }], 2));

    const out = await client.getAllProfitCenters();

    expect(out.map((c) => c.code)).toEqual(['1', '2']);
    expect((http.get as jest.Mock)).toHaveBeenCalledTimes(2);
    expect((http.get as jest.Mock).mock.calls[1][1].params.page).toBe(2);
  });

  it('corta si el middleware devuelve una página vacía', async () => {
    const { client, http } = make(BASE);
    (http.get as jest.Mock).mockReturnValue(page([], 99));

    expect(await client.getAllProfitCenters()).toEqual([]);
    expect((http.get as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it('traduce un fallo de red del middleware a 503', async () => {
    const { client, http } = make(BASE);
    (http.get as jest.Mock).mockReturnValue(throwError(() => ({ code: 'ECONNREFUSED' })));

    await expect(client.getAllProfitCenters()).rejects.toThrow(ServiceUnavailableException);
  });
});

/** Error de axios con status y cuerpo, como lo entrega HttpService. */
function httpError(status: number, data?: unknown) {
  return throwError(() => ({ response: { status, data } }));
}

describe('RegionsClient.listRegionGroups', () => {
  const GROUPS_URL = 'http://mw:6002/api/mobility/regions/groups';
  const CAYCAR = {
    code: 'CAYCAR',
    name: 'CAYCAR (común a Centroamérica y Caribe)',
    members: ['CA', 'CB'],
    pairs: 18,
  };

  it('pega a /mobility/regions/groups y devuelve la data tal cual (el repo la normaliza)', async () => {
    const { client, http } = make(BASE);
    (http.get as jest.Mock).mockReturnValue(of({ data: { success: true, data: [CAYCAR] } }));

    expect(await client.listRegionGroups()).toEqual([CAYCAR]);

    const [url, opts] = (http.get as jest.Mock).mock.calls[0];
    expect(url).toBe(GROUPS_URL);
    expect(opts.headers).toEqual({ 'x-source-app': 'MobilityBackOffice' });
  });

  it('una respuesta sin arreglo en `data` → lista vacía', async () => {
    const { client, http } = make(BASE);
    (http.get as jest.Mock).mockReturnValue(of({ data: { success: true } }));

    expect(await client.listRegionGroups()).toEqual([]);
  });

  it('404 sin cuerpo (middleware sin el router de regiones) → 503 que pide la versión mínima', async () => {
    const { client, http } = make(BASE);
    (http.get as jest.Mock).mockReturnValue(httpError(404, '<pre>Cannot GET /api/mobility/regions/groups</pre>'));

    const err = await client.listRegionGroups().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as Error).message).toContain(`MW ≥ ${MIN_MW_VERSION_REGION_GROUPS}`);
  });

  it('404 "Region not found" (MW 1.176–1.330: /groups cae en GET /:guid) → el mismo 503 de versión', async () => {
    // Un middleware con el router de regiones pero sin /groups interpreta "groups" como un
    // Guid y responde 404 CON cuerpo. Tomar ese cuerpo por una respuesta real diría
    // "región no encontrada" y escondería que falta desplegar el middleware.
    const { client, http } = make(BASE);
    (http.get as jest.Mock).mockReturnValue(
      httpError(404, { success: false, error: 'Region not found' }),
    );

    const err = await client.listRegionGroups().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as Error).message).toContain(`MW ≥ ${MIN_MW_VERSION_REGION_GROUPS}`);
  });

  it('caída o 5xx → 503 genérico, nunca una lista vacía', async () => {
    const { client, http } = make(BASE);
    (http.get as jest.Mock).mockReturnValue(httpError(500, { success: false, error: 'boom' }));

    const err = await client.listRegionGroups().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as Error).message).not.toContain('MW ≥');
  });
});

describe('RegionsClient.resolveByCodes', () => {
  it('manda los códigos de agrupación tal cual al resolver del middleware', async () => {
    const { client, http } = make(BASE);
    (http.get as jest.Mock).mockReturnValue(of({ data: { success: true, data: [] } }));

    await client.resolveByCodes(['CAYCAR']);

    const [url, opts] = (http.get as jest.Mock).mock.calls[0];
    expect(url).toBe('http://mw:6002/api/mobility/regions/resolve');
    expect(opts.params).toEqual({ codes: 'CAYCAR' });
  });

  it('sin códigos no llama al middleware', async () => {
    const { client, http } = make(BASE);

    expect(await client.resolveByCodes([])).toEqual([]);
    expect(http.get as jest.Mock).not.toHaveBeenCalled();
  });
});
