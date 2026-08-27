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
  hasNode: boolean | null = false,
  nodeMembers: unknown[] | null = [],
) {
  const client = {
    getMatrix: jest.fn().mockResolvedValue(rows),
    getProfitCenterNames: jest.fn().mockResolvedValue(names),
    getCountryManagers: jest.fn().mockResolvedValue(countryManagers),
    hasCountryManagerNode: jest.fn().mockResolvedValue(hasNode),
    getNodeMembers: jest.fn().mockResolvedValue(nodeMembers),
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
  /**
   * EL PUNTO DE ESTE BLOQUE. El endpoint se llama `country-manager` pero devuelve los
   * INTEGRANTES de un nodo que se llama "COUNTRY MANAGER X" — y ese nodo es un puesto
   * del organigrama, con su equipo colgando. En QATEST, dos de los tres integrantes de
   * "COUNTRY MANAGER BAN" son `Role: "Vendedor"`.
   *
   * La app NO filtra por rol: no le corresponde decidir quien es country manager cuando
   * Duwest no publica un flag que lo diga. Lo que si hace es exponer el rol de cada uno
   * y no esconder a nadie del nodo.
   */
  const filaDeSociedad = (over = {}) => ({
    nodeGuid: 'n1',
    nodeName: 'COUNTRY MANAGER BAN',
    country: 'GUATEMALA',
    memberGuid: 'm1',
    guidUsers: 'u1',
    name: 'ALONSO ARROYAVE',
    role: 'Vendedor',
    sapUserId: '2100425',
    email: 'alonso@duwest.com',
    companyCode: '2100',
    ...over,
  });

  it('devuelve los integrantes agrupados por nodo, con su rol', async () => {
    const { service } = makeService([], new Map(), [filaDeSociedad()], false, []);

    const res = await service.countryManagers('2100');
    expect(res.available).toBe(true);
    expect(res.diagnosis).toBe('ok');
    expect(res.nodes).toHaveLength(1);
    expect(res.nodes[0].nodeName).toBe('COUNTRY MANAGER BAN');
    expect(res.nodes[0].members[0]).toMatchObject({ role: 'Vendedor', inCompany: true });
  });

  it('NO filtra por rol: un Vendedor del nodo se muestra igual, con su rol a la vista', async () => {
    const { service } = makeService([], new Map(), [filaDeSociedad()], false, []);

    const res = await service.countryManagers('2100');
    expect(res.nodes[0].members.map((m) => m.role)).toEqual(['Vendedor']);
  });

  it('trae al integrante de OTRA sociedad, marcado', async () => {
    // El caso real: el gerente de "COUNTRY MANAGER BAN" figura bajo la 2200 mientras sus
    // vendedores estan en la 2100. Sin esto, consultar 2100 muestra al equipo y no al jefe.
    const { service } = makeService([], new Map(), [filaDeSociedad()], false, [
      { memberGuid: 'm1', guidUsers: 'u1', name: 'ALONSO ARROYAVE', role: 'Vendedor', sapUserId: '2100425' },
      { memberGuid: 'm3', guidUsers: 'u3', name: 'JORGE MARTINEZ', role: 'Gerente', sapUserId: '2100144' },
    ]);

    const res = await service.countryManagers('2100');
    expect(res.nodes[0].members).toHaveLength(2);

    const jorge = res.nodes[0].members.find((m) => m.name === 'JORGE MARTINEZ');
    expect(jorge).toMatchObject({ inCompany: false, email: null, companyCode: null });
  });

  it('el de conduccion va primero, aunque sea el de otra sociedad', async () => {
    const { service } = makeService([], new Map(), [filaDeSociedad()], false, [
      { memberGuid: 'm1', guidUsers: 'u1', name: 'ALONSO ARROYAVE', role: 'Vendedor', sapUserId: '2100425' },
      { memberGuid: 'm3', guidUsers: 'u3', name: 'JORGE MARTINEZ', role: 'Gerente', sapUserId: '2100144' },
    ]);

    const res = await service.countryManagers('2100');
    expect(res.nodes[0].members[0].name).toBe('JORGE MARTINEZ');
  });

  it('el integrante sin rol va antes que el equipo: puede ser el titular', async () => {
    // En QATEST el unico integrante de "COUNTRY MANAGER GT" tiene `Role` null y es el CM.
    const { service } = makeService([], new Map(), [filaDeSociedad()], false, [
      { memberGuid: 'm1', guidUsers: 'u1', name: 'ALONSO ARROYAVE', role: 'Vendedor', sapUserId: '2100425' },
      { memberGuid: 'm9', guidUsers: 'u9', name: 'JUAN BARRIOS', role: null, sapUserId: '2100270' },
    ]);

    const res = await service.countryManagers('2100');
    expect(res.nodes[0].members[0].name).toBe('JUAN BARRIOS');
  });

  it('no duplica a quien esta en las dos fuentes', async () => {
    const { service } = makeService([], new Map(), [filaDeSociedad()], false, [
      { memberGuid: 'm1', guidUsers: 'u1', name: 'ALONSO ARROYAVE', role: 'Vendedor', sapUserId: '2100425' },
    ]);

    const res = await service.countryManagers('2100');
    expect(res.nodes[0].members).toHaveLength(1);
    expect(res.nodes[0].members[0].inCompany).toBe(true);
  });

  it('si el detalle del nodo falla, no se pierde lo que si vino', async () => {
    const { service } = makeService([], new Map(), [filaDeSociedad()], false, null);

    const res = await service.countryManagers('2100');
    expect(res.nodes[0].members).toHaveLength(1);
    expect(res.nodes[0].members[0].inCompany).toBe(true);
  });

  it('un fallo del middleware NO se confunde con "no hay ninguno"', async () => {
    const { service } = makeService([], new Map(), null);

    const res = await service.countryManagers('2100');
    expect(res.available).toBe(false);
    expect(res.diagnosis).toBe('unavailable');
    expect(res.nodes).toEqual([]);
  });

  /**
   * Los tres casos de "200 con lista vacia". Solo UNO es un hecho del negocio; los otros
   * dos son problemas de carga y la pantalla no debe presentarlos como
   * "nadie autoriza otra forma de pago".
   */
  it('sin nodo COUNTRY MANAGER en la jerarquia: los esconde a todos', async () => {
    const { service } = makeService([], new Map(), [], false);

    const res = await service.countryManagers('2100');
    expect(res).toEqual({ available: true, diagnosis: 'sin_nodo', nodes: [] });
  });

  it('con nodo pero sin miembros de esta sociedad', async () => {
    const { service } = makeService([], new Map(), [], true);

    const res = await service.countryManagers('2100');
    expect(res).toEqual({ available: true, diagnosis: 'sin_miembros', nodes: [] });
  });

  it('si no se pudo mirar el arbol, no se afirma ninguna causa', async () => {
    const { service } = makeService([], new Map(), [], null);

    const res = await service.countryManagers('2100');
    expect(res.diagnosis).toBe('unavailable');
  });

  it('el arbol se consulta SOLO cuando la lista vino vacia', async () => {
    const { service, client } = makeService([], new Map(), [], true);

    await service.countryManagers('2100');
    expect(client.hasCountryManagerNode).toHaveBeenCalledTimes(1);
  });

  it('con resultados NO consulta el arbol: seria una llamada de mas', async () => {
    const { service, client } = makeService([], new Map(), [filaDeSociedad()], false, []);

    await service.countryManagers('2100');
    expect(client.hasCountryManagerNode).not.toHaveBeenCalled();
  });

  it('el maestro de sociedades sale de Regiones, sin segundo cliente', async () => {
    const { service, regions } = makeService([]);

    await service.companies('duwy', 10);
    expect(regions.searchCompanies).toHaveBeenCalledWith('duwy', 10);
  });
});
