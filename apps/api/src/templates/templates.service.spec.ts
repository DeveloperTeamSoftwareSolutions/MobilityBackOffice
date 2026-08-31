import { TemplatesService } from './templates.service';
import { TemplatesClient } from './templates.client';
import { TemplatesQuery, WabaTemplateRow } from './templates.types';

function row(over: Partial<WabaTemplateRow> = {}): WabaTemplateRow {
  return {
    Id: 1,
    Name: 'template_reminder',
    Language: 'es_MX',
    Category: 'MARKETING',
    Status: 'APPROVED',
    BodyText: 'Hola {{1}}',
    ButtonsJson: null,
    VariablesJson: null,
    ...over,
  };
}

function query(over: Partial<TemplatesQuery> = {}): TemplatesQuery {
  return {
    page: 1,
    limit: 25,
    search: '',
    sortBy: 'name',
    sortDir: 'ASC',
    status: null,
    ...over,
  };
}

function makeService(rows: WabaTemplateRow[], configured = true) {
  const client = {
    getTemplates: jest.fn().mockResolvedValue(rows),
    isConfigured: jest.fn().mockReturnValue(configured),
  };
  return {
    service: new TemplatesService(client as unknown as TemplatesClient),
    client,
  };
}

describe('TemplatesService — listado', () => {
  it('mapea y devuelve las plantillas', async () => {
    const { service } = makeService([row(), row({ Name: 'otra' })]);

    const res = await service.getAll(query());
    expect(res.data).toHaveLength(2);
    expect(res.pagination.total).toBe(2);
  });

  it('descarta filas sin nombre en vez de romper', async () => {
    const { service } = makeService([row(), row({ Name: null })]);

    const res = await service.getAll(query());
    expect(res.data).toHaveLength(1);
  });

  it('una fila con JSON roto no tumba el listado', async () => {
    // Las plantillas viejas sincronizadas de META pueden traer columnas mal formadas.
    const { service } = makeService([row({ ButtonsJson: '[roto', VariablesJson: '{{' })]);

    const res = await service.getAll(query());
    expect(res.data).toHaveLength(1);
    expect(res.data[0].buttons).toEqual([]);
  });
});

describe('TemplatesService — busqueda y filtro', () => {
  const dataset = [
    row({ Name: 'saludo_navidad', BodyText: 'Feliz Navidad {{1}}', Category: 'MARKETING' }),
    row({ Name: 'aviso_pago', BodyText: 'Tu factura vence', Category: 'UTILITY' }),
    row({ Name: 'codigo_otp', BodyText: 'Tu codigo', Category: 'AUTHENTICATION', Language: 'en_US' }),
  ];

  it('busca por nombre', async () => {
    const { service } = makeService(dataset);
    const res = await service.getAll(query({ search: 'navidad' }));
    expect(res.data.map((t) => t.name)).toEqual(['saludo_navidad']);
  });

  it('busca tambien dentro del texto del mensaje', async () => {
    const { service } = makeService(dataset);
    const res = await service.getAll(query({ search: 'factura' }));
    expect(res.data.map((t) => t.name)).toEqual(['aviso_pago']);
  });

  it('busca por categoria y por idioma', async () => {
    const { service } = makeService(dataset);
    expect((await service.getAll(query({ search: 'utility' }))).data).toHaveLength(1);
    expect((await service.getAll(query({ search: 'en_us' }))).data).toHaveLength(1);
  });

  it('filtra por estado', async () => {
    const { service } = makeService([
      row({ Name: 'a', Status: 'APPROVED' }),
      row({ Name: 'b', Status: 'PENDING' }),
    ]);
    const res = await service.getAll(query({ status: 'PENDING' }));
    expect(res.data.map((t) => t.name)).toEqual(['b']);
  });
});

describe('TemplatesService — resumen', () => {
  it('cuenta por estado sobre TODAS, no sobre el filtro', async () => {
    // El resumen es el semaforo de la cuenta: tiene que ser estable al navegar.
    const { service } = makeService([
      row({ Name: 'a', Status: 'APPROVED' }),
      row({ Name: 'b', Status: 'PENDING' }),
      row({ Name: 'c', Status: 'PENDING' }),
    ]);

    const res = await service.getAll(query({ status: 'APPROVED' }));
    expect(res.summary).toEqual({ APPROVED: 1, PENDING: 2 });
    expect(res.data).toHaveLength(1);
  });

  /**
   * Hoy WABA publica solo las aprobadas (`findAllApproved`), asi que las PENDING y
   * REJECTED no llegan — justo las que habria que atender. La UI tiene que poder
   * avisarlo en vez de dar a entender que no existen.
   */
  it('avisa cuando todo lo que llego esta aprobado', async () => {
    const { service } = makeService([row({ Status: 'APPROVED' })]);
    expect((await service.getAll(query())).onlyApproved).toBe(true);
  });

  it('deja de avisar solo cuando aparece otro estado', async () => {
    // Cuando WABA publique todos los estados, el aviso desaparece sin tocar codigo.
    const { service } = makeService([
      row({ Name: 'a', Status: 'APPROVED' }),
      row({ Name: 'b', Status: 'PENDING' }),
    ]);
    expect((await service.getAll(query())).onlyApproved).toBe(false);
  });

  it('sin plantillas no avisa nada', async () => {
    const { service } = makeService([]);
    const res = await service.getAll(query());
    expect(res.onlyApproved).toBe(false);
    expect(res.summary).toEqual({});
  });
});

describe('TemplatesService — orden y paginado', () => {
  it('ordena por nombre y respeta la direccion', async () => {
    const { service } = makeService([row({ Name: 'b' }), row({ Name: 'a' })]);
    expect((await service.getAll(query())).data.map((t) => t.name)).toEqual(['a', 'b']);
    expect(
      (await service.getAll(query({ sortDir: 'DESC' }))).data.map((t) => t.name),
    ).toEqual(['b', 'a']);
  });

  it('al ordenar por idioma desempata por nombre', async () => {
    // Sin desempate, dos plantillas del mismo idioma bailan entre recargas.
    const { service } = makeService([
      row({ Name: 'z', Language: 'es_MX' }),
      row({ Name: 'a', Language: 'es_MX' }),
    ]);
    const res = await service.getAll(query({ sortBy: 'language' }));
    expect(res.data.map((t) => t.name)).toEqual(['a', 'z']);
  });

  it('pagina', async () => {
    const { service } = makeService([row({ Name: 'a' }), row({ Name: 'b' }), row({ Name: 'c' })]);
    const res = await service.getAll(query({ limit: 2 }));
    expect(res.data).toHaveLength(2);
    expect(res.pagination).toEqual({ total: 3, page: 1, limit: 2, totalPages: 2 });
  });

  it('una pagina fuera de rango cae a la ultima en vez de devolver vacio', async () => {
    const { service } = makeService([row()]);
    const res = await service.getAll(query({ page: 99 }));
    expect(res.pagination.page).toBe(1);
    expect(res.data).toHaveLength(1);
  });
});

describe('TemplatesService — por nombre', () => {
  it('encuentra sin importar mayusculas', async () => {
    const { service } = makeService([row({ Name: 'Saludo_Navidad' })]);
    const t = await service.getByName('saludo_navidad');
    expect(t?.name).toBe('Saludo_Navidad');
  });

  it('devuelve null si no existe', async () => {
    const { service } = makeService([row()]);
    expect(await service.getByName('no_existe')).toBeNull();
  });
});

describe('TemplatesService — configuracion', () => {
  it('informa cuando falta la configuracion', async () => {
    // El front necesita distinguir "no hay plantillas" de "esto no esta configurado":
    // en pantalla se ven igual.
    const { service } = makeService([], false);
    expect(service.isConfigured()).toBe(false);
  });
});
