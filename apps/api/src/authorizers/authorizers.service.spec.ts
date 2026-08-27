import { AuthorizersService } from './authorizers.service';
import { AuthorizersClient } from './authorizers.client';
import { RegionsClient } from '../regions/regions.client';
import { AuthorizerRow, MatrixQuery } from './authorizers.types';

/** Fila de la matriz con los defaults de un autorizador sano. */
function row(over: Partial<AuthorizerRow> = {}): AuthorizerRow {
  return {
    companyCode: '1000',
    authorizerLimitGuid: 'g-1',
    userEmail: 'gerente@duwy.com',
    userId: 'U1',
    minimumPercentage: 10,
    maximumPercentage: 30,
    approvalLevel: 'N1',
    profitCenter: 'CEBE-01',
    validFrom: null,
    validUntil: null,
    ...over,
  };
}

function query(over: Partial<MatrixQuery> = {}): MatrixQuery {
  return {
    companyCode: '1000',
    page: 1,
    limit: 25,
    search: '',
    sortBy: 'userEmail',
    sortDir: 'ASC',
    filter: 'all',
    activeOnly: false,
    ...over,
  };
}

function makeService(
  rows: AuthorizerRow[],
  names: Map<string, string> = new Map(),
  countryManagers: unknown[] | null = [],
) {
  const client = {
    getMatrix: jest.fn().mockResolvedValue(rows),
    getProfitCenterNames: jest.fn().mockResolvedValue(names),
    getCountryManagers: jest.fn().mockResolvedValue(countryManagers),
  };
  const regions = { searchCompanies: jest.fn().mockResolvedValue([]) };
  return {
    service: new AuthorizersService(
      client as unknown as AuthorizersClient,
      regions as unknown as RegionsClient,
    ),
    client,
    regions,
  };
}

describe('AuthorizersService — agrupacion', () => {
  it('un gerente con varios CEBEs es UNA fila', async () => {
    const { service } = makeService([
      row({ profitCenter: 'CEBE-01' }),
      row({ profitCenter: 'CEBE-02' }),
      row({ profitCenter: 'CEBE-03' }),
    ]);

    const res = await service.getMatrix(query());

    expect(res.data).toHaveLength(1);
    expect(res.pagination.total).toBe(1);
    expect(res.data[0].profitCenters.map((p) => p.code)).toEqual([
      'CEBE-01',
      'CEBE-02',
      'CEBE-03',
    ]);
  });

  it('agrupa sin importar como venga escrito el mail', async () => {
    // SAP no garantiza el case del email, y la vista joinea por UserEmail.
    const { service } = makeService([
      row({ userEmail: 'Gerente@Duwy.com', profitCenter: 'CEBE-01' }),
      row({ userEmail: 'gerente@duwy.com', profitCenter: 'CEBE-02' }),
    ]);

    const res = await service.getMatrix(query());
    expect(res.data).toHaveLength(1);
    expect(res.data[0].profitCenters).toHaveLength(2);
  });

  it('el CEBE nulo es COMODIN: firma en toda la sociedad, no es "sin CEBE"', async () => {
    // El middleware lo resuelve como `ProfitCenter = @Pc OR ProfitCenter IS NULL`:
    // es la fila de MAYOR alcance. Leerla al reves invierte el significado.
    const { service } = makeService([row({ profitCenter: null })]);

    const res = await service.getMatrix(query());
    expect(res.data).toHaveLength(1);
    expect(res.data[0].coversWholeCompany).toBe(true);
    expect(res.data[0].profitCenters).toEqual([]);
  });

  it('el comodin convive con CEBEs puntuales sin ensuciar la lista', async () => {
    const { service } = makeService([
      row({ profitCenter: null }),
      row({ profitCenter: 'CEBE-01' }),
    ]);

    const res = await service.getMatrix(query());
    expect(res.data[0].coversWholeCompany).toBe(true);
    expect(res.data[0].profitCenters.map((p) => p.code)).toEqual(['CEBE-01']);
  });

  it('quien no tiene comodin queda marcado como acotado', async () => {
    const { service } = makeService([row({ profitCenter: 'CEBE-01' })]);

    const res = await service.getMatrix(query());
    expect(res.data[0].coversWholeCompany).toBe(false);
  });

  it('los CEBEs salen ordenados por codigo', async () => {
    const { service } = makeService([
      row({ profitCenter: 'CEBE-09' }),
      row({ profitCenter: 'CEBE-02' }),
    ]);

    const res = await service.getMatrix(query());
    expect(res.data[0].profitCenters.map((p) => p.code)).toEqual(['CEBE-02', 'CEBE-09']);
  });
});

describe('AuthorizersService — banda interpretada', () => {
  it('la fila 0/0 llega marcada como bloqueada, no como un rango de cero', async () => {
    const { service } = makeService([row({ minimumPercentage: 0, maximumPercentage: 0 })]);

    const res = await service.getMatrix(query());
    expect(res.data[0].band).toEqual({
      min: null,
      max: null,
      blocked: true,
      reason: 'sin_configurar',
    });
  });

  it('conserva los crudos de SAP junto a la lectura', async () => {
    // Los crudos se exponen para poder auditar contra SAP sin abrir la base.
    const { service } = makeService([row({ minimumPercentage: 200, maximumPercentage: 200 })]);

    const res = await service.getMatrix(query());
    expect(res.data[0].minimumPercentage).toBe(200);
    expect(res.data[0].maximumPercentage).toBe(200);
    expect(res.data[0].band.reason).toBe('sin_limite');
    expect(res.data[0].band.blocked).toBe(false);
  });
});

describe('AuthorizersService — vigencia de los CEBEs', () => {
  it('cuenta solo los CEBEs vigentes', async () => {
    const { service } = makeService([
      row({ profitCenter: 'VIGENTE', validFrom: null, validUntil: null }),
      row({ profitCenter: 'VENCIDO', validFrom: '2020-01-01', validUntil: '2020-12-31' }),
    ]);

    const res = await service.getMatrix(query());
    expect(res.data[0].profitCenters).toHaveLength(2);
    expect(res.data[0].activeProfitCenterCount).toBe(1);
  });
});

describe('AuthorizersService — resumen', () => {
  it('cuenta bloqueados, comodines y vencidos por separado', async () => {
    const { service } = makeService([
      row({ userEmail: 'ok@duwy.com' }),
      row({ userEmail: 'bloqueado@duwy.com', minimumPercentage: 0, maximumPercentage: 0 }),
      row({ userEmail: 'toda-la-sociedad@duwy.com', profitCenter: null }),
      row({
        userEmail: 'vencido@duwy.com',
        profitCenter: 'CEBE-X',
        validUntil: '2020-01-01',
      }),
    ]);

    const res = await service.getMatrix(query());
    expect(res.summary).toEqual({
      total: 4,
      blocked: 1,
      wholeCompany: 1,
      withoutActiveProfitCenters: 1,
    });
  });

  it('quien cubre toda la sociedad NO cuenta como "sin CEBEs vigentes"', async () => {
    // No depende de ninguna asignacion: castigarlo seria marcar como roto al de
    // mayor alcance.
    const { service } = makeService([row({ profitCenter: null })]);

    const res = await service.getMatrix(query());
    expect(res.summary.withoutActiveProfitCenters).toBe(0);
    expect(res.summary.wholeCompany).toBe(1);
  });

  it('el resumen NO cambia con el filtro ni con la pagina', async () => {
    // Es el semaforo de la sociedad: tiene que ser estable mientras se navega.
    const { service } = makeService([
      row({ userEmail: 'ok@duwy.com' }),
      row({ userEmail: 'bloqueado@duwy.com', minimumPercentage: 0, maximumPercentage: 0 }),
    ]);

    const completo = await service.getMatrix(query());
    const filtrado = await service.getMatrix(query({ filter: 'blocked' }));

    expect(filtrado.summary).toEqual(completo.summary);
    expect(filtrado.pagination.total).toBe(1);
    expect(filtrado.data[0].userEmail).toBe('bloqueado@duwy.com');
  });
});

describe('AuthorizersService — busqueda, orden y paginado', () => {
  it('busca tambien por codigo de CEBE', async () => {
    const { service } = makeService([
      row({ userEmail: 'a@duwy.com', profitCenter: 'NORTE-01' }),
      row({ userEmail: 'b@duwy.com', profitCenter: 'SUR-01' }),
    ]);

    const res = await service.getMatrix(query({ search: 'norte' }));
    expect(res.data.map((a) => a.userEmail)).toEqual(['a@duwy.com']);
  });

  it('los limites sin dato van al final, no al principio', async () => {
    const { service } = makeService([
      row({ userEmail: 'sin@duwy.com', maximumPercentage: null }),
      row({ userEmail: 'con@duwy.com', maximumPercentage: 20 }),
    ]);

    const res = await service.getMatrix(query({ sortBy: 'maximumPercentage' }));
    expect(res.data.map((a) => a.userEmail)).toEqual(['con@duwy.com', 'sin@duwy.com']);
  });

  it('ordena por cantidad de CEBEs', async () => {
    const { service } = makeService([
      row({ userEmail: 'uno@duwy.com', profitCenter: 'C1' }),
      row({ userEmail: 'dos@duwy.com', profitCenter: 'C1' }),
      row({ userEmail: 'dos@duwy.com', profitCenter: 'C2' }),
    ]);

    const res = await service.getMatrix(query({ sortBy: 'profitCenterCount', sortDir: 'DESC' }));
    expect(res.data.map((a) => a.userEmail)).toEqual(['dos@duwy.com', 'uno@duwy.com']);
  });

  it('pagina sobre autorizadores y no sobre filas crudas', async () => {
    // 2 gerentes, 5 filas: la pagina de 1 tiene que traer 1 GERENTE, no 1 fila.
    const { service } = makeService([
      row({ userEmail: 'a@duwy.com', profitCenter: 'C1' }),
      row({ userEmail: 'a@duwy.com', profitCenter: 'C2' }),
      row({ userEmail: 'a@duwy.com', profitCenter: 'C3' }),
      row({ userEmail: 'b@duwy.com', profitCenter: 'C1' }),
      row({ userEmail: 'b@duwy.com', profitCenter: 'C2' }),
    ]);

    const res = await service.getMatrix(query({ limit: 1 }));
    expect(res.pagination).toEqual({ total: 2, page: 1, limit: 1, totalPages: 2 });
    expect(res.data).toHaveLength(1);
    expect(res.data[0].profitCenters).toHaveLength(3);
  });

  it('una pagina fuera de rango cae a la ultima en vez de devolver vacio', async () => {
    const { service } = makeService([row()]);

    const res = await service.getMatrix(query({ page: 99 }));
    expect(res.pagination.page).toBe(1);
    expect(res.data).toHaveLength(1);
  });

  it('sin resultados devuelve una pagina vacia coherente', async () => {
    const { service } = makeService([row()]);

    const res = await service.getMatrix(query({ search: 'no-existe' }));
    expect(res.data).toEqual([]);
    expect(res.pagination).toEqual({ total: 0, page: 1, limit: 25, totalPages: 1 });
  });
});

describe('AuthorizersService — paso al middleware', () => {
  it('propaga companyCode y activeOnly tal cual', async () => {
    const { service, client } = makeService([]);

    await service.getMatrix(query({ companyCode: '2000', activeOnly: true }));
    expect(client.getMatrix).toHaveBeenCalledWith('2000', true);
  });

  it('el maestro de sociedades sale de Regiones, sin segundo cliente', async () => {
    const { service, regions } = makeService([]);

    await service.companies('duwy', 10);
    expect(regions.searchCompanies).toHaveBeenCalledWith('duwy', 10);
  });
});

describe('AuthorizersService — nombre del CEBE', () => {
  it('pega el nombre del maestro al chip', async () => {
    const { service } = makeService(
      [row({ profitCenter: '1002' })],
      new Map([['1002', 'CEBE Central']]),
    );

    const res = await service.getMatrix(query());
    expect(res.data[0].profitCenters[0]).toMatchObject({ code: '1002', name: 'CEBE Central' });
  });

  it('un codigo fuera del maestro queda sin nombre, no rompe', async () => {
    const { service } = makeService([row({ profitCenter: 'X-999' })], new Map());

    const res = await service.getMatrix(query());
    expect(res.data[0].profitCenters[0].name).toBeNull();
  });

  it('la busqueda encuentra por nombre y no solo por codigo', async () => {
    const { service } = makeService(
      [
        row({ userEmail: 'a@duwy.com', profitCenter: '1002' }),
        row({ userEmail: 'b@duwy.com', profitCenter: '2003' }),
      ],
      new Map([
        ['1002', 'CEBE Central'],
        ['2003', 'CEBE Norte'],
      ]),
    );

    const res = await service.getMatrix(query({ search: 'central' }));
    expect(res.data.map((a) => a.userEmail)).toEqual(['a@duwy.com']);
  });
});

describe('AuthorizersService — country managers', () => {
  it('los devuelve marcados como disponibles', async () => {
    const { service } = makeService([], new Map(), [
      { companyCode: '2100', email: 'cm@duwy.com', memberName: 'Ana', role: 'CM' },
    ]);

    const res = await service.countryManagers('2100');
    expect(res.available).toBe(true);
    expect(res.data).toHaveLength(1);
  });

  it('un fallo del middleware NO se confunde con "no hay ninguno"', async () => {
    // Decir "no hay country managers" cuando en realidad fallo la consulta es
    // justamente la afirmacion falsa que la pantalla intenta evitar.
    const { service } = makeService([], new Map(), null);

    const res = await service.countryManagers('2100');
    expect(res.available).toBe(false);
    expect(res.data).toEqual([]);
  });

  it('una sociedad sin country managers devuelve vacio pero disponible', async () => {
    const { service } = makeService([], new Map(), []);

    const res = await service.countryManagers('2100');
    expect(res).toEqual({ available: true, data: [] });
  });
});
