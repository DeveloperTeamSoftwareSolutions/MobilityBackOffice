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

describe('SupportController — override de estado', () => {
  const resultado = {
    ok: true as const,
    noop: false,
    documentNumber: 'ORD-00005413',
    fromCode: 'Draft',
    toCode: 'ReadyForApprove',
    isTerminal: false,
  };
  let service: jest.Mocked<Pick<SupportService, 'overrideStatus'>>;
  let controller: SupportController;

  const req = { user: { email: 'soporte@duwest.com', guid: 'guid-soporte' } };

  beforeEach(() => {
    service = { overrideStatus: jest.fn().mockResolvedValue(resultado) };
    controller = new SupportController(service as unknown as SupportService);
  });

  it('aplica el override y responde con success', async () => {
    const res = await controller.overrideStatus(
      'order',
      'guid-doc',
      { toCode: 'ReadyForApprove', reasonNotes: 'Ticket 1234' },
      req,
    );
    expect(res).toEqual({ success: true, data: resultado });
  });

  it('propaga el actor logueado, no el que venga en el body', async () => {
    await controller.overrideStatus(
      'order',
      'guid-doc',
      { toCode: 'Draft', reasonNotes: 'motivo' },
      req,
    );
    const [payload, actor] = service.overrideStatus.mock.calls[0];
    expect(payload.actorEmail).toBe('soporte@duwest.com');
    expect(actor).toEqual({ email: 'soporte@duwest.com', guid: 'guid-soporte' });
  });

  it('exige toCode', async () => {
    await expect(
      controller.overrideStatus('order', 'guid-doc', { reasonNotes: 'x' }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.overrideStatus).not.toHaveBeenCalled();
  });

  it('exige motivo, y un motivo en blanco no cuenta', async () => {
    await expect(
      controller.overrideStatus(
        'order',
        'guid-doc',
        { toCode: 'Draft', reasonNotes: '    ' },
        req,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.overrideStatus).not.toHaveBeenCalled();
  });

  it('recorta el motivo antes de mandarlo', async () => {
    await controller.overrideStatus(
      'order',
      'guid-doc',
      { toCode: 'Draft', reasonNotes: '  Ticket 1234  ' },
      req,
    );
    expect(service.overrideStatus.mock.calls[0][0].reasonNotes).toBe('Ticket 1234');
  });

  it('un reasonCode vacio viaja como null', async () => {
    await controller.overrideStatus(
      'order',
      'guid-doc',
      { toCode: 'Draft', reasonNotes: 'motivo', reasonCode: '   ' },
      req,
    );
    expect(service.overrideStatus.mock.calls[0][0].reasonCode).toBeNull();
  });

  it('rechaza un tipo invalido', async () => {
    await expect(
      controller.overrideStatus(
        'factura',
        'guid-doc',
        { toCode: 'Draft', reasonNotes: 'motivo' },
        req,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.overrideStatus).not.toHaveBeenCalled();
  });

  it('rechaza un guid vacio', async () => {
    await expect(
      controller.overrideStatus(
        'order',
        '   ',
        { toCode: 'Draft', reasonNotes: 'motivo' },
        req,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
