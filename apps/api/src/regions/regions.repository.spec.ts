import {
  mapRegion,
  mapRegionCebe,
  mapAvailableCebe,
  mapAvailableCompany,
  mapResolvedCebe,
  linkKey,
  parseLinkKey,
  groupMultiRegion,
  reconcileLinks,
} from './regions.repository';

describe('mappers', () => {
  describe('mapRegion', () => {
    const row = {
      Id: 1,
      Guid: 'guid-ca                             ',
      TimeStamp: 1700000000000n,
      ServerTimestamp: 1700000000001n,
      DeletedTimestamp: null,
      Code: 'CA',
      Name: 'Centroamérica',
      SortOrder: 1,
      CebeCount: 7n,
    };

    it('convierte PascalCase a camelCase', () => {
      expect(mapRegion(row)).toEqual({
        id: 1,
        guid: 'guid-ca',
        timeStamp: 1700000000000,
        serverTimestamp: 1700000000001,
        deletedTimestamp: null,
        code: 'CA',
        name: 'Centroamérica',
        sortOrder: 1,
        isGroup: false,
        cebeCount: 7,
      });
    });

    it('recorta el Guid (CHAR(36) viene con relleno)', () => {
      expect(mapRegion(row).guid).toBe('guid-ca');
    });

    it('convierte los BigInt a number', () => {
      const m = mapRegion(row);
      expect(typeof m.timeStamp).toBe('number');
      expect(typeof m.cebeCount).toBe('number');
    });

    it('una region atomica nunca es isGroup', () => {
      expect(mapRegion(row).isGroup).toBe(false);
    });

    it('CebeCount nulo cuenta como cero', () => {
      expect(mapRegion({ ...row, CebeCount: null }).cebeCount).toBe(0);
    });

    it('Code nulo se mapea a string vacio', () => {
      expect(mapRegion({ ...row, Code: null }).code).toBe('');
    });

    it('DeletedTimestamp 0 se normaliza a null (equivale a no eliminado)', () => {
      expect(mapRegion({ ...row, DeletedTimestamp: 0 }).deletedTimestamp).toBeNull();
    });
  });

  describe('mapRegionCebe', () => {
    const row = {
      Id: 5,
      Guid: 'guid-link  ',
      GuidContinents: 'guid-ca  ',
      ProfitCenterCode: '1003',
      ProfitCenterName: 'Duwest Banano',
      CompanyCode: '2100',
      CompanyName: 'Duwest Guatemala',
      Source: 'ui',
      CreatedBy: 'juan@duwest.com',
      UpdatedBy: null,
      Version: 2,
    };

    it('mapea el vinculo completo', () => {
      expect(mapRegionCebe(row)).toEqual({
        id: 5,
        guid: 'guid-link',
        guidRegions: 'guid-ca',
        profitCenterCode: '1003',
        profitCenterName: 'Duwest Banano',
        companyCode: '2100',
        companyName: 'Duwest Guatemala',
        source: 'ui',
        createdBy: 'juan@duwest.com',
        updatedBy: null,
        version: 2,
      });
    });

    it('la sociedad sin match en el maestro deja companyName null', () => {
      expect(mapRegionCebe({ ...row, CompanyName: null }).companyName).toBeNull();
    });
  });

  it('mapAvailableCebe mapea codigo y nombre', () => {
    expect(
      mapAvailableCebe({ ProfitCenterCode: '1080', ProfitCenterName: 'Qualicon' }),
    ).toEqual({ code: '1080', name: 'Qualicon' });
  });

  it('mapAvailableCompany mapea codigo, nombre y pais', () => {
    expect(
      mapAvailableCompany({
        CompanyCode: '2100',
        CompanyName: 'Duwest Guatemala',
        Country: 'GT',
      }),
    ).toEqual({ code: '2100', name: 'Duwest Guatemala', country: 'GT' });
  });

  it('mapResolvedCebe mapea el par (CEBE, sociedad)', () => {
    expect(
      mapResolvedCebe({
        ProfitCenterCode: '1003',
        ProfitCenterName: 'Duwest Banano',
        CompanyCode: '3000',
        CompanyName: 'Duwest Dominicana',
      }),
    ).toEqual({
      profitCenterCode: '1003',
      profitCenterName: 'Duwest Banano',
      companyCode: '3000',
      companyName: 'Duwest Dominicana',
    });
  });
});

describe('linkKey / parseLinkKey', () => {
  it('arma la clave compuesta (CEBE, sociedad)', () => {
    expect(linkKey('1003', '2100')).toBe('1003|2100');
  });

  it('parseLinkKey es la inversa de linkKey', () => {
    expect(parseLinkKey(linkKey('1003', '2100'))).toEqual({
      code: '1003',
      companyCode: '2100',
    });
  });

  it('parte solo por el primer separador', () => {
    expect(parseLinkKey('A|B|C')).toEqual({ code: 'A', companyCode: 'B|C' });
  });
});

describe('groupMultiRegion', () => {
  it('agrupa las filas planas por CEBE y cuenta sus regiones', () => {
    const resultado = groupMultiRegion([
      {
        ProfitCenterCode: '1003',
        ProfitCenterName: 'Duwest Banano',
        RegionCode: 'CA',
        RegionName: 'Centroamérica',
      },
      {
        ProfitCenterCode: '1003',
        ProfitCenterName: 'Duwest Banano',
        RegionCode: 'CB',
        RegionName: 'Caribe',
      },
    ]);

    expect(resultado).toEqual([
      {
        code: '1003',
        name: 'Duwest Banano',
        regionCount: 2,
        regions: [
          { code: 'CA', name: 'Centroamérica' },
          { code: 'CB', name: 'Caribe' },
        ],
      },
    ]);
  });

  it('mantiene separados los CEBEs distintos', () => {
    const resultado = groupMultiRegion([
      { ProfitCenterCode: '1003', ProfitCenterName: 'A', RegionCode: 'CA', RegionName: 'Centro' },
      { ProfitCenterCode: '1080', ProfitCenterName: 'B', RegionCode: 'CB', RegionName: 'Caribe' },
    ]);
    expect(resultado).toHaveLength(2);
    expect(resultado.map((r) => r.code)).toEqual(['1003', '1080']);
  });

  it('devuelve lista vacia sin filas', () => {
    expect(groupMultiRegion([])).toEqual([]);
  });

  it('un RegionCode nulo se mapea a string vacio', () => {
    const [entrada] = groupMultiRegion([
      { ProfitCenterCode: '1003', ProfitCenterName: 'A', RegionCode: null, RegionName: 'Sin codigo' },
    ]);
    expect(entrada.regions[0].code).toBe('');
  });
});

describe('reconcileLinks', () => {
  it('agrega los deseados que no estan', () => {
    expect(reconcileLinks(['a'], ['a', 'b'])).toEqual({
      toAdd: ['b'],
      toRemove: [],
    });
  });

  it('quita los actuales que ya no se desean', () => {
    expect(reconcileLinks(['a', 'b'], ['a'])).toEqual({
      toAdd: [],
      toRemove: ['b'],
    });
  });

  it('sin cambios cuando coinciden', () => {
    expect(reconcileLinks(['a', 'b'], ['b', 'a'])).toEqual({
      toAdd: [],
      toRemove: [],
    });
  });

  it('un estado deseado vacio quita todo', () => {
    expect(reconcileLinks(['a', 'b'], [])).toEqual({
      toAdd: [],
      toRemove: ['a', 'b'],
    });
  });

  it('desde vacio agrega todo', () => {
    expect(reconcileLinks([], ['a', 'b'])).toEqual({
      toAdd: ['a', 'b'],
      toRemove: [],
    });
  });

  it('es idempotente: reconciliar el resultado no produce cambios', () => {
    const actual = ['a', 'b'];
    const deseado = ['b', 'c'];
    const { toAdd, toRemove } = reconcileLinks(actual, deseado);
    const luego = actual.filter((c) => !toRemove.includes(c)).concat(toAdd);
    expect(reconcileLinks(luego, deseado)).toEqual({ toAdd: [], toRemove: [] });
  });
});
