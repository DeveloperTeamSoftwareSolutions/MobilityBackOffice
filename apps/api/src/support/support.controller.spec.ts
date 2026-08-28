import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { DocumentTimeline, TimelineQuery } from './support.types';

/** Bitácora mínima para las aserciones. */
const timeline: DocumentTimeline = {
  document: {
    guid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    documentNumber: 'ORD-00005234',
    sellerEmail: 'vendedor@duwest.com',
    customerCode: '0001234',
    customerName: 'Cliente Demo',
    statusCode: 'AwaitingAuthorization',
    sentAt: '2026-08-20T14:03:00.000Z',
    cancelledAt: null,
    cancelledByEmail: null,
    cancellationReasonCode: null,
    cancellationReasonNotes: null,
  },
  events: [
    {
      at: '2026-08-20T14:03:00.000Z',
      kind: 'sent',
      title: 'El vendedor la envió a aprobación',
      detail: null,
      actorEmail: 'vendedor@duwest.com',
      actorRole: 'seller',
      source: 'BusinessOrders.SentAt',
    },
  ],
};

describe('SupportController', () => {
  let service: jest.Mocked<Pick<SupportService, 'getTimeline' | 'getDocument'>>;
  let controller: SupportController;

  beforeEach(() => {
    service = {
      getTimeline: jest.fn().mockResolvedValue(timeline),
      getDocument: jest.fn().mockResolvedValue(timeline.document),
    };
    controller = new SupportController(service as unknown as SupportService);
  });

  describe('validacion del tipo de documento', () => {
    it('acepta order', async () => {
      await controller.getTimeline('order', 'ORD-00005234');
      const query = service.getTimeline.mock.calls[0][0] as TimelineQuery;
      expect(query.type).toBe('order');
    });

    it('acepta quote', async () => {
      await controller.getTimeline('quote', 'COT-0000001');
      const query = service.getTimeline.mock.calls[0][0] as TimelineQuery;
      expect(query.type).toBe('quote');
    });

    it('normaliza mayusculas y espacios', async () => {
      await controller.getTimeline('  ORDER  ', 'ORD-00005234');
      const query = service.getTimeline.mock.calls[0][0] as TimelineQuery;
      expect(query.type).toBe('order');
    });

    it('rechaza un tipo desconocido con 400', async () => {
      await expect(
        controller.getTimeline('invoice', 'ORD-00005234'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(service.getTimeline).not.toHaveBeenCalled();
    });
  });

  describe('validacion del numero de documento', () => {
    it('rechaza un numero vacio con 400', async () => {
      await expect(
        controller.getTimeline('order', '   '),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(service.getTimeline).not.toHaveBeenCalled();
    });

    it('recorta espacios alrededor del numero', async () => {
      await controller.getTimeline('order', '  ORD-00005234 ');
      const query = service.getTimeline.mock.calls[0][0] as TimelineQuery;
      expect(query.number).toBe('ORD-00005234');
    });
  });

  describe('flags de la bitacora', () => {
    it('includeViews queda apagado por default', async () => {
      await controller.getTimeline('order', 'ORD-00005234');
      const query = service.getTimeline.mock.calls[0][0] as TimelineQuery;
      expect(query.includeViews).toBe(false);
    });

    it("'1' y 'true' encienden includeViews", async () => {
      await controller.getTimeline('order', 'ORD-00005234', '1');
      await controller.getTimeline('order', 'ORD-00005234', 'true');
      const first = service.getTimeline.mock.calls[0][0] as TimelineQuery;
      const second = service.getTimeline.mock.calls[1][0] as TimelineQuery;
      expect(first.includeViews).toBe(true);
      expect(second.includeViews).toBe(true);
    });

    it('cualquier otro valor deja includeViews apagado', async () => {
      await controller.getTimeline('order', 'ORD-00005234', 'si');
      const query = service.getTimeline.mock.calls[0][0] as TimelineQuery;
      expect(query.includeViews).toBe(false);
    });
  });

  describe('respuestas', () => {
    it('la bitacora responde con success y los datos del middleware', async () => {
      const res = await controller.getTimeline('order', 'ORD-00005234');
      expect(res).toEqual({ success: true, data: timeline });
    });

    it('la cabecera responde solo el documento', async () => {
      const res = await controller.getDocument('order', 'ORD-00005234');
      expect(res).toEqual({ success: true, data: timeline.document });
    });

    it('propaga el 404 del servicio', async () => {
      service.getTimeline.mockRejectedValueOnce(new NotFoundException());
      await expect(
        controller.getTimeline('order', 'NO-EXISTE'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('SupportController — listado', () => {
  const paged = {
    data: [],
    pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
  };
  let service: jest.Mocked<Pick<SupportService, 'listDocuments' | 'listStatuses'>>;
  let controller: SupportController;

  beforeEach(() => {
    service = {
      listDocuments: jest.fn().mockResolvedValue(paged),
      listStatuses: jest.fn().mockResolvedValue([]),
    };
    controller = new SupportController(service as unknown as SupportService);
  });

  const lastQuery = () => service.listDocuments.mock.calls[0][0];

  it('usa order, pagina 1 y orden por fecha descendente como default', async () => {
    await controller.list();
    expect(lastQuery()).toMatchObject({
      type: 'order',
      page: 1,
      limit: 20,
      search: '',
      status: '',
      sortBy: 'documentDate',
      sortDir: 'DESC',
    });
  });

  it('clampea el limit al maximo de 200', async () => {
    await controller.list('order', '1', '5000');
    expect(lastQuery().limit).toBe(200);
  });

  it('un limit invalido o menor a 1 cae al default', async () => {
    await controller.list('order', '1', '0');
    await controller.list('order', '1', 'abc');
    expect(service.listDocuments.mock.calls[0][0].limit).toBe(20);
    expect(service.listDocuments.mock.calls[1][0].limit).toBe(20);
  });

  it('una pagina menor a 1 cae a 1', async () => {
    await controller.list('order', '-3');
    expect(lastQuery().page).toBe(1);
  });

  it('rechaza un sortBy fuera de la whitelist y cae al default', async () => {
    await controller.list('order', '1', '20', '', '', 'DROP TABLE');
    expect(lastQuery().sortBy).toBe('documentDate');
  });

  it('acepta un sortBy de la whitelist', async () => {
    await controller.list('order', '1', '20', '', '', 'customerName', 'ASC');
    expect(lastQuery()).toMatchObject({ sortBy: 'customerName', sortDir: 'ASC' });
  });

  it('cualquier sortDir que no sea ASC resuelve DESC', async () => {
    await controller.list('order', '1', '20', '', '', 'total', 'lateral');
    expect(lastQuery().sortDir).toBe('DESC');
  });

  it('recorta espacios de search y status', async () => {
    await controller.list('order', '1', '20', '  AGROSAK ', '  Draft ');
    expect(lastQuery()).toMatchObject({ search: 'AGROSAK', status: 'Draft' });
  });

  it('rechaza un tipo invalido con 400', async () => {
    await expect(controller.list('factura')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.listDocuments).not.toHaveBeenCalled();
  });

  it('los estados responden con success y el tipo normalizado', async () => {
    const res = await controller.statuses('QUOTE');
    expect(service.listStatuses).toHaveBeenCalledWith('quote');
    expect(res).toEqual({ success: true, data: [] });
  });
});
describe('SupportController — decisiones sobre lineas y plazos de pago', () => {
  const resultado = {
    ok: true as const,
    documentNumber: 'ORD-00005409',
    statusBefore: 'ReadyForApprove',
    statusAfter: 'Processed',
  };
  let service: jest.Mocked<
    Pick<
      SupportService,
      | 'decideItem'
      | 'respondItem'
      | 'decidePaymentTerms'
      | 'respondPaymentTerms'
      | 'listItems'
      | 'recompute'
    >
  >;
  let controller: SupportController;
  const req = { user: { email: 'soporte@duwest.com', guid: 'guid-soporte' } };

  beforeEach(() => {
    service = {
      decideItem: jest.fn().mockResolvedValue(resultado),
      respondItem: jest.fn().mockResolvedValue(resultado),
      decidePaymentTerms: jest.fn().mockResolvedValue(resultado),
      respondPaymentTerms: jest.fn().mockResolvedValue(resultado),
      listItems: jest.fn().mockResolvedValue({ items: [] }),
      recompute: jest.fn().mockResolvedValue({}),
    };
    controller = new SupportController(service as unknown as SupportService);
  });

  const itemPayload = () => service.decideItem.mock.calls[0][0];
  const pagoPayload = () => service.decidePaymentTerms.mock.calls[0][0];

  it('acepta aprobar y rechazar una linea', async () => {
    await controller.decideItem('order', 'g', 'PROD-1', { status: 'approved', reasonNotes: 'ticket 42' }, req);
    expect(itemPayload().status).toBe('approved');
    expect(itemPayload().productCode).toBe('PROD-1');
  });

  it('ACEPTA contraofertar, ahora que viaja con el precio', async () => {
    await controller.decideItem(
      'order',
      'g',
      'PROD-1',
      { status: 'countered', proposedPrice: 12.5, reasonNotes: 'lo pidio el gerente' },
      req,
    );
    expect(itemPayload().status).toBe('countered');
    expect(itemPayload().proposedPrice).toBe(12.5);
  });

  it('rechaza contraofertar SIN precio: dejaria al vendedor viendo una propuesta vacia', async () => {
    await expect(
      controller.decideItem('order', 'g', 'PROD-1', { status: 'countered', reasonNotes: 'x' }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.decideItem).not.toHaveBeenCalled();
  });

  it('rechaza un precio propuesto que no es un numero positivo', async () => {
    for (const precio of [0, -5, 'ocho']) {
      await expect(
        controller.decideItem(
          'order',
          'g',
          'PROD-1',
          { status: 'countered', proposedPrice: precio, reasonNotes: 'x' },
          req,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(service.decideItem).not.toHaveBeenCalled();
  });

  it('rechaza una decision que no esta en el vocabulario', async () => {
    await expect(
      controller.decideItem('order', 'g', 'PROD-1', { status: 'maybe', reasonNotes: 'x' }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exige motivo en las cuatro decisiones', async () => {
    await expect(
      controller.decideItem('order', 'g', 'PROD-1', { status: 'approved', reasonNotes: '  ' }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.respondItem('order', 'g', 'PROD-1', { action: 'accept' }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.decidePaymentTerms('order', 'g', { status: 'approved' }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.respondPaymentTerms('order', 'g', { action: 'accept' }, req),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(service.decideItem).not.toHaveBeenCalled();
    expect(service.respondItem).not.toHaveBeenCalled();
    expect(service.decidePaymentTerms).not.toHaveBeenCalled();
    expect(service.respondPaymentTerms).not.toHaveBeenCalled();
  });

  it('exige el codigo de producto', async () => {
    await expect(
      controller.decideItem('order', 'g', '   ', { status: 'approved', reasonNotes: 'x' }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('la respuesta del vendedor solo acepta aceptar o rechazar', async () => {
    await controller.respondItem('order', 'g', 'PROD-1', { action: 'accept', reasonNotes: 'x' }, req);
    expect(service.respondItem.mock.calls[0][0].action).toBe('accept');

    await expect(
      controller.respondItem('order', 'g', 'PROD-1', { action: 'countered', reasonNotes: 'x' }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el plazo de pago acepta observed solo con el plazo propuesto', async () => {
    await controller.decidePaymentTerms(
      'order',
      'g',
      { status: 'observed', value: '30 dias', reasonNotes: 'x' },
      req,
    );
    expect(pagoPayload().status).toBe('observed');
    expect(pagoPayload().value).toBe('30 dias');

    await expect(
      controller.decidePaymentTerms('order', 'g', { status: 'observed', reasonNotes: 'x' }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el actor sale del token, no del body', async () => {
    await controller.decideItem('order', 'g', 'PROD-1', { status: 'rejected', reasonNotes: 'x' }, req);
    expect(itemPayload().actorEmail).toBe('soporte@duwest.com');
    expect(service.decideItem.mock.calls[0][1]).toEqual({
      email: 'soporte@duwest.com',
      guid: 'guid-soporte',
    });
  });

  it('el recalculo responde con success', async () => {
    const res = await controller.recompute('order', 'g', req);
    expect(res).toEqual({ success: true, data: {} });
    expect(service.recompute).toHaveBeenCalledWith('order', 'g', {
      email: 'soporte@duwest.com',
      guid: 'guid-soporte',
    });
  });
});

describe('SupportController — vuelta atras', () => {
  /**
   * El destino de una vuelta atras viaja en el BODY, no en la URL: `annul` y
   * `revert_annulment` no tienen destino, asi que no puede ser un parametro de ruta.
   *
   * Esto se rompio una vez: el controller no leia `target` del body y el middleware
   * respondia "No se puede volver a 'null' en este documento" mientras el modal se
   * quedaba abierto, como si no hubiera pasado nada. Estas aserciones existen para
   * que el dato no se vuelva a perder en el camino.
   */
  let service: jest.Mocked<Pick<SupportService, 'runAction'>>;
  let controller: SupportController;
  const req = { user: { email: 'soporte@qa.local', guid: 'guid-soporte' } };

  beforeEach(() => {
    service = {
      runAction: jest.fn().mockResolvedValue({
        ok: true,
        action: 'revert_to',
        target: 'Draft',
        documentNumber: 'ORD-00005418',
        statusBefore: 'ReadyForApprove',
        statusAfter: 'Draft',
        expected: 'Draft',
        achieved: true,
      }),
    };
    controller = new SupportController(service as unknown as SupportService);
  });

  it('reenvia el destino de la vuelta atras al servicio', async () => {
    await controller.runAction('order', 'g', 'revert_to', {
      reasonNotes: 'ticket 42',
      target: 'Draft',
    }, req);
    expect(service.runAction).toHaveBeenCalledWith(
      'order',
      'g',
      'revert_to',
      'ticket 42',
      { email: 'soporte@qa.local', guid: 'guid-soporte' },
      'Draft',
    );
  });

  it('las acciones sin destino mandan null, no una cadena vacia', async () => {
    await controller.runAction('order', 'g', 'annul', { reasonNotes: 'ticket 42' }, req);
    expect(service.runAction.mock.calls[0][5]).toBeNull();
  });

  it('un destino en blanco tambien es null', async () => {
    await controller.runAction('order', 'g', 'annul', {
      reasonNotes: 'ticket 42',
      target: '   ',
    }, req);
    expect(service.runAction.mock.calls[0][5]).toBeNull();
  });

  it('sigue exigiendo el motivo antes de llamar al servicio', async () => {
    await expect(
      controller.runAction('order', 'g', 'revert_to', { reasonNotes: '  ', target: 'Draft' }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.runAction).not.toHaveBeenCalled();
  });
});
