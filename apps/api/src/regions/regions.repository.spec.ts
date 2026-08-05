import {
  RegionsRepository,
  mapRegion,
  mapRegionCebe,
  mapResolvedCebe,
  groupMultiRegion,
  reconcileLinks,
  normalizeCebeCode,
  diffUnmapped,
  linkKey,
  parseLinkKey,
} from './regions.repository';
import { RegionsClient, mapCompany } from './regions.client';

// ---- Fixtures: lo que devuelve el MIDDLEWARE (camelCase), no filas de SQL ----
const mwRegion = {
  id: 1,
  guid: 'R-1',
  timeStamp: 1000,
  serverTimestamp: 2000,
  deletedTimestamp: null,
  code: 'CA',
  name: 'Centroamérica',
  sortOrder: 1,
  cebeCount: 3,
};
const mwLink = {
  id: 5,
  guid: 'L-1',
  guidContinents: 'R-1',
  profitCenterCode: '1080',
  profitCenterName: 'Qualicon',
  companyCode: '2100',
  companyName: 'Duwest Guatemala, S.A.',
  source: 'ui',
  createdBy: 'admin@x.com',
  updatedBy: null,
  version: 1,
};

describe('mappers del contrato del middleware', () => {
  it('mapRegion: numeriza timestamps, isGroup false, cebeCount', () => {
    const r = mapRegion(mwRegion);
    expect(r).toMatchObject({ guid: 'R-1', code: 'CA', isGroup: false, cebeCount: 3 });
    expect(r.timeStamp).toBe(1000);
    expect(r.serverTimestamp).toBe(2000);
  });

  it('mapRegion: cebeCount 0 si el middleware no lo mandó', () => {
    // El detalle por Guid no trae conteo (null); el DTO del módulo es no-nulo.
    expect(mapRegion({ ...mwRegion, cebeCount: null }).cebeCount).toBe(0);
  });

  it('mapRegion: una región de la base NUNCA es agrupación', () => {
    // Las agrupaciones (CAYCAR) las sintetiza el service desde configuración: no tienen
    // fila. Si esto devolviera true, una región real se comportaría como grupo.
    expect(mapRegion(mwRegion).isGroup).toBe(false);
  });

  it('mapRegionCebe: guidContinents del middleware → guidRegions del DTO', () => {
    // El middleware conserva el nombre de la columna; el módulo habla de regiones. La
    // traducción vive en el mapper para que el service no conozca las dos formas.
    const c = mapRegionCebe(mwLink);
    expect(c.guidRegions).toBe('R-1');
    expect(c).toMatchObject({ profitCenterCode: '1080', companyCode: '2100' });
  });

  it('mapRegionCebe: companyName null si falta', () => {
    expect(mapRegionCebe({ ...mwLink, companyName: null }).companyName).toBeNull();
  });

  it('mapCompany: code + name + country, con trim del código', () => {
    expect(mapCompany({ companyCode: '2100 ', companyName: 'Duwest GT', country: 'GT' })).toEqual({
      code: '2100',
      name: 'Duwest GT',
      country: 'GT',
    });
  });

  it('mapResolvedCebe: par (CEBE, sociedad)', () => {
    expect(
      mapResolvedCebe({
        profitCenterCode: '1003',
        profitCenterName: 'Banano',
        companyCode: '2100',
        companyName: 'GT',
      }),
    ).toEqual({
      profitCenterCode: '1003',
      profitCenterName: 'Banano',
      companyCode: '2100',
      companyName: 'GT',
    });
  });
});

describe('linkKey / parseLinkKey', () => {
  it('compone y descompone (code, companyCode)', () => {
    expect(linkKey('1080', '2100')).toBe('1080|2100');
    expect(parseLinkKey('1080|2100')).toEqual({ code: '1080', companyCode: '2100' });
  });

  it('parte solo por el primer separador', () => {
    expect(parseLinkKey('A|B|C')).toEqual({ code: 'A', companyCode: 'B|C' });
  });
});

describe('groupMultiRegion', () => {
  it('agrupa un CEBE en varias regiones', () => {
    const out = groupMultiRegion([
      { profitCenterCode: '1080', profitCenterName: 'Qualicon', regionCode: 'CA', regionName: 'Centroamérica' },
      { profitCenterCode: '1080', profitCenterName: 'Qualicon', regionCode: 'CB', regionName: 'Caribe' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].regionCount).toBe(2);
    expect(out[0].regions.map((r) => r.code)).toEqual(['CA', 'CB']);
  });

  it('mantiene separados los CEBEs distintos', () => {
    const out = groupMultiRegion([
      { profitCenterCode: '1080', profitCenterName: 'A', regionCode: 'CA', regionName: 'Centro' },
      { profitCenterCode: '1003', profitCenterName: 'B', regionCode: 'CB', regionName: 'Caribe' },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.code)).toEqual(['1080', '1003']);
  });

  it('devuelve lista vacía sin filas', () => {
    expect(groupMultiRegion([])).toEqual([]);
  });

  it('un regionCode nulo se mapea a string vacío', () => {
    const [entrada] = groupMultiRegion([
      { profitCenterCode: '1080', profitCenterName: 'A', regionCode: null, regionName: 'Sin codigo' },
    ]);
    expect(entrada.regions[0].code).toBe('');
  });
});

describe('reconcileLinks', () => {
  it('calcula altas y bajas', () => {
    expect(reconcileLinks(['a', 'b'], ['b', 'c'])).toEqual({ toAdd: ['c'], toRemove: ['a'] });
  });
  it('sin cambios → vacíos', () => {
    expect(reconcileLinks(['a'], ['a'])).toEqual({ toAdd: [], toRemove: [] });
  });
  it('un estado deseado vacío quita todo', () => {
    expect(reconcileLinks(['a', 'b'], [])).toEqual({ toAdd: [], toRemove: ['a', 'b'] });
  });
  it('desde vacío agrega todo', () => {
    expect(reconcileLinks([], ['a', 'b'])).toEqual({ toAdd: ['a', 'b'], toRemove: [] });
  });
});

describe('normalizeCebeCode', () => {
  it('trimea, sube a mayúsculas y quita acentos (replica la collation CI_AI)', () => {
    expect(normalizeCebeCode(' ábc ')).toBe('ABC');
    expect(normalizeCebeCode('AbC')).toBe('ABC');
  });
});

describe('diffUnmapped', () => {
  const catalog = [
    { code: '1080', name: 'Qualicon' },
    { code: '9999', name: 'Sin región' },
  ];

  it('deja solo los CEBEs del maestro sin link activo, en el orden del maestro', () => {
    expect(diffUnmapped(catalog, ['1080'])).toEqual([{ code: '9999', name: 'Sin región' }]);
  });

  it('compara normalizado: padding y case no generan falsos "sin región"', () => {
    expect(diffUnmapped(catalog, [' 1080 '])).toEqual([{ code: '9999', name: 'Sin región' }]);
  });

  it('sin links, todo el maestro está sin mapear', () => {
    expect(diffUnmapped(catalog, [])).toEqual(catalog);
  });
});

describe('RegionsRepository', () => {
  function make() {
    const mw = {
      listRegions: jest.fn(),
      getRegionByGuid: jest.fn(),
      getRegionByCode: jest.fn(),
      getRegionLinks: jest.fn(),
      linkCebe: jest.fn(),
      unlinkCebe: jest.fn(),
      resolveByCodes: jest.fn(),
      getLinkedCebeCodes: jest.fn(),
      getMultiRegionLinks: jest.fn(),
      searchCompanies: jest.fn(),
      searchProfitCenters: jest.fn(),
      getAllProfitCenters: jest.fn(),
    };
    return { repo: new RegionsRepository(mw as unknown as RegionsClient), mw };
  }

  it('getAll: pasa los parámetros al middleware y mapea las filas', async () => {
    const { repo, mw } = make();
    mw.listRegions.mockResolvedValue({
      data: [mwRegion],
      pagination: { total: 4, page: 1, limit: 50, totalPages: 1 },
    });

    const out = await repo.getAll({ page: 1, limit: 50, search: 'cen' });
    expect(mw.listRegions).toHaveBeenCalledWith({
      page: 1,
      limit: 50,
      search: 'cen',
      sortBy: 'sortOrder',
      sortDir: 'ASC',
    });
    expect(out.pagination).toEqual({ total: 4, page: 1, limit: 50, totalPages: 1 });
    expect(out.data[0].code).toBe('CA');
  });

  it('getByGuid: región + sus CEBEs; cebeCount = nº de links traídos', async () => {
    const { repo, mw } = make();
    mw.getRegionByGuid.mockResolvedValue(mwRegion);
    mw.getRegionLinks.mockResolvedValue([mwLink, { ...mwLink, id: 6, profitCenterCode: '1090' }]);

    const out = await repo.getByGuid('R-1');
    expect(out?.code).toBe('CA');
    expect(out?.cebes).toHaveLength(2);
    // 2, no el 3 que trae el fixture: el detalle cuenta los links que acaba de traer.
    expect(out?.cebeCount).toBe(2);
    expect(out?.cebes[0].companyCode).toBe('2100');
  });

  it('getByGuid: null si no existe, y NO pide los links', async () => {
    const { repo, mw } = make();
    mw.getRegionByGuid.mockResolvedValue(null);
    expect(await repo.getByGuid('nope')).toBeNull();
    expect(mw.getRegionLinks).not.toHaveBeenCalled();
  });

  it('getByCode: mapea o null', async () => {
    const { repo, mw } = make();
    mw.getRegionByCode.mockResolvedValue(mwRegion);
    expect((await repo.getByCode('CA'))?.code).toBe('CA');
    mw.getRegionByCode.mockResolvedValue(null);
    expect(await repo.getByCode('ZZ')).toBeNull();
  });

  it('linkCebe: UNA sola llamada — el upsert lo resuelve el middleware', async () => {
    // Antes eran dos statements (UPDATE y, si no afectó, INSERT). Resolverlo en dos
    // llamadas HTTP abriría una ventana entre el "¿existe?" y el alta.
    const { repo, mw } = make();
    await repo.linkCebe('R-1', '1080', '2100', 'Qualicon', 'ui', 'admin@x.com');
    expect(mw.linkCebe).toHaveBeenCalledTimes(1);
    expect(mw.linkCebe).toHaveBeenCalledWith('R-1', {
      profitCenterCode: '1080',
      companyCode: '2100',
      profitCenterName: 'Qualicon',
      source: 'ui',
      actor: 'admin@x.com',
    });
  });

  it('unlinkCebe: propaga el booleano del middleware', async () => {
    const { repo, mw } = make();
    mw.unlinkCebe.mockResolvedValue(true);
    expect(await repo.unlinkCebe('R-1', '1080', '2100')).toBe(true);
    mw.unlinkCebe.mockResolvedValue(false);
    expect(await repo.unlinkCebe('R-1', '1080', '2100')).toBe(false);
  });

  it('getActiveLinks: lista de pares (code, companyCode)', async () => {
    const { repo, mw } = make();
    mw.getRegionLinks.mockResolvedValue([
      mwLink,
      { ...mwLink, profitCenterCode: '1003', companyCode: '2100' },
    ]);
    expect(await repo.getActiveLinks('R-1')).toEqual([
      { profitCenterCode: '1080', companyCode: '2100' },
      { profitCenterCode: '1003', companyCode: '2100' },
    ]);
  });

  it('resolveCebesByCodes: mapea los pares del middleware', async () => {
    const { repo, mw } = make();
    mw.resolveByCodes.mockResolvedValue([
      { profitCenterCode: '1003', profitCenterName: 'Banano', companyCode: '2100', companyName: 'GT' },
      { profitCenterCode: '1003', profitCenterName: 'Banano', companyCode: '2700', companyName: 'NI' },
    ]);
    const out = await repo.resolveCebesByCodes(['CA']);
    expect(out.map((c) => `${c.profitCenterCode}|${c.companyCode}`)).toEqual(['1003|2100', '1003|2700']);
  });

  it('resolveCebesByCodes: sin códigos → [] sin llamar al middleware', async () => {
    const { repo, mw } = make();
    expect(await repo.resolveCebesByCodes([])).toEqual([]);
    expect(mw.resolveByCodes).not.toHaveBeenCalled();
  });

  it('getAvailableCompanies: delega en el middleware (adiós al cross-DB)', async () => {
    // Era el último SELECT de BackOffice contra [SAPServices].[dbo].[Companies].
    const { repo, mw } = make();
    mw.searchCompanies.mockResolvedValue([
      { code: '2100', name: 'Duwest Guatemala, S.A.', country: 'GT' },
    ]);
    expect(await repo.getAvailableCompanies('', 20)).toEqual([
      { code: '2100', name: 'Duwest Guatemala, S.A.', country: 'GT' },
    ]);
    expect(mw.searchCompanies).toHaveBeenCalledWith('', 20);
  });

  it('getAvailableCebes: delega el typeahead en el middleware', async () => {
    const { repo, mw } = make();
    mw.searchProfitCenters.mockResolvedValue([{ code: '1080', name: 'Qualicon' }]);
    expect(await repo.getAvailableCebes('quali', 20)).toEqual([{ code: '1080', name: 'Qualicon' }]);
    expect(mw.searchProfitCenters).toHaveBeenCalledWith('quali', 20);
  });

  it('getUnmappedCebes: cruza las dos puntas EN PARALELO y diffea en Node', async () => {
    const { repo, mw } = make();
    mw.getAllProfitCenters.mockResolvedValue([
      { code: '1080', name: 'Qualicon' },
      { code: '9999', name: 'Sin región' },
    ]);
    mw.getLinkedCebeCodes.mockResolvedValue(['1080']);

    expect(await repo.getUnmappedCebes()).toEqual([{ code: '9999', name: 'Sin región' }]);
    expect(mw.getAllProfitCenters).toHaveBeenCalledTimes(1);
    expect(mw.getLinkedCebeCodes).toHaveBeenCalledTimes(1);
  });

  it('getMultiRegionCebes: agrupa por CEBE', async () => {
    const { repo, mw } = make();
    mw.getMultiRegionLinks.mockResolvedValue([
      { profitCenterCode: '1080', profitCenterName: 'Qualicon', regionCode: 'CA', regionName: 'Centroamérica' },
      { profitCenterCode: '1080', profitCenterName: 'Qualicon', regionCode: 'CB', regionName: 'Caribe' },
    ]);
    const out = await repo.getMultiRegionCebes();
    expect(out).toHaveLength(1);
    expect(out[0].regionCount).toBe(2);
  });
});
