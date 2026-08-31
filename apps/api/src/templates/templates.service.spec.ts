import { TemplatesService } from './templates.service';
import { AuditService } from '../audit/audit.service';
import { AuditCategory } from '../audit/audit.categories';
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
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    sync: jest.fn(),
    submitDraft: jest.fn(),
    getById: jest.fn(),
    saveDraft: jest.fn(),
  };
  // Lo que se auditó, para poder mirarlo desde los tests.
  const audited: Record<string, unknown>[] = [];
  const audit = {
    safeRecord: jest.fn(async (e: Record<string, unknown>) => {
      audited.push(e);
    }),
  };
  return {
    service: new TemplatesService(
      client as unknown as TemplatesClient,
      audit as unknown as AuditService,
    ),
    client,
    audited,
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

/**
 * La traza de las plantillas.
 *
 * Existe para responder "quién mandó esto a META". Tres cosas la vuelven inútil si se
 * pierden, y por eso están fijadas acá: el cliente (sin él ITManager no muestra la fila),
 * el email del actor, y el nombre de la plantilla.
 */
describe('TemplatesService — auditoría', () => {
  const ACTOR = {
    email: 'marketing@duwest.com',
    guid: 'guid-usuario',
    guidApiLoginClients: 'guid-cliente',
  };

  const ALTA = {
    name: 'promo_navidad',
    language: 'es_MX',
    category: 'MARKETING',
    bodyText: 'Hola',
  };

  it('registra quién creó la plantilla', async () => {
    const { service, client, audited } = makeService([]);
    client.create.mockResolvedValue(row({ Name: 'promo_navidad' }));

    await service.create(ALTA, ACTOR);

    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      action: 'TEMPLATE_CREATE',
      entity: 'WhatsAppTemplate',
      entityId: 'promo_navidad',
      category: AuditCategory.Templates,
      guidUsers: 'guid-usuario',
      actorEmail: 'marketing@duwest.com',
    });
  });

  it('sin el cliente la fila no se ve desde ITManager', () => {
    // Es el campo por el que filtra su pantalla: se fija aparte para que no se caiga solo.
    const { service, client, audited } = makeService([]);
    client.create.mockResolvedValue(row());

    return service.create(ALTA, ACTOR).then(() => {
      expect(audited[0].guidApiLoginClients).toBe('guid-cliente');
    });
  });

  it('identifica la plantilla por su nombre, no por el id de WABA', async () => {
    // El id no significa nada para quien lee la auditoría desde ITManager.
    const { service, client, audited } = makeService([]);
    client.update.mockResolvedValue(row({ Id: 42, Name: 'promo_navidad' }));

    await service.update(42, { bodyText: 'otro' }, ACTOR);

    expect(audited[0].entityId).toBe('promo_navidad');
  });

  it('al editar deja dicho que vuelve a revisión', async () => {
    const { service, client, audited } = makeService([]);
    client.update.mockResolvedValue(row({ Name: 'promo_navidad' }));

    await service.update(42, { bodyText: 'otro' }, ACTOR);

    expect(audited[0].action).toBe('TEMPLATE_UPDATE');
    expect(audited[0].detail).toContain('revision');
  });

  it('enviar un borrador registra de cuál salió', async () => {
    const { service, client, audited } = makeService([]);
    client.submitDraft.mockResolvedValue(row({ Name: 'promo_navidad' }));

    await service.submitDraft(62, ALTA, ACTOR);

    expect(audited[0].action).toBe('TEMPLATE_SUBMIT');
    expect(audited[0].detail).toContain('borrador=62');
  });

  it('al borrar guarda el nombre, que después ya no existe', async () => {
    // Se consulta antes de borrar: si no, la traza diría que se borró algo sin decir qué.
    const { service, client, audited } = makeService([]);
    client.getById.mockResolvedValue({ template: row({ Name: 'promo_navidad' }), editPolicy: null });

    await service.remove(42, ACTOR);

    expect(client.getById).toHaveBeenCalledWith(42);
    expect(audited[0]).toMatchObject({
      action: 'TEMPLATE_DELETE',
      entityId: 'promo_navidad',
    });
  });

  it('si no se pudo saber el nombre, igual se borra y se registra', async () => {
    // Perder la traza sería malo; no poder borrar por eso, peor.
    const { service, client, audited } = makeService([]);
    client.getById.mockRejectedValue(new Error('WABA no responde'));

    await service.remove(42, ACTOR);

    expect(client.remove).toHaveBeenCalledWith(42);
    expect(audited[0].entityId).toBe('42');
  });

  it('el sync también queda registrado', async () => {
    const { service, client, audited } = makeService([]);
    client.sync.mockResolvedValue({});

    await service.sync(ACTOR);

    expect(audited[0].action).toBe('TEMPLATE_SYNC');
  });

  it('guardar un borrador NO se audita', async () => {
    // No sale de la aplicación y se guarda muchas veces por plantilla: llenaría la traza
    // de ruido hasta tapar lo que importa.
    const { service, client, audited } = makeService([]);
    client.saveDraft.mockResolvedValue(62);

    await service.saveDraft({ ...ALTA, draftId: null });

    expect(audited).toHaveLength(0);
  });

  it('usa el modo que no propaga errores', async () => {
    // La plantilla ya salió hacia META: un fallo del audit central no puede revertirla ni
    // romperle la respuesta a quien la mandó. Eso lo garantiza `safeRecord`, no `record`,
    // y la diferencia no se ve hasta que el middleware se cae.
    const { service, client } = makeService([]);
    client.create.mockResolvedValue(row());

    const audit = { record: jest.fn(), safeRecord: jest.fn() };
    const conAudit = new TemplatesService(
      client as unknown as TemplatesClient,
      audit as unknown as AuditService,
    );
    await conAudit.create(ALTA, ACTOR);

    expect(audit.safeRecord).toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(service).toBeDefined();
  });
});
