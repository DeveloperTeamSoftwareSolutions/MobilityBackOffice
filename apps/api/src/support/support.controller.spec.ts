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

describe('SupportController — estado de lineas', () => {
  const resultado = {
    ok: true as const,
    documentNumber: 'ORD-00005409',
    lineNumber: 1,
    statusBefore: 'ReadyForApprove',
    statusAfter: 'Processed',
    recomputed: true,
  };
  let service: jest.Mocked<
    Pick<SupportService, 'setItemStatus' | 'listItems' | 'recompute'>
  >;
  let controller: SupportController;
  const req = { user: { email: 'soporte@duwest.com', guid: 'guid-soporte' } };

  beforeEach(() => {
    service = {
      setItemStatus: jest.fn().mockResolvedValue(resultado),
      listItems: jest.fn().mockResolvedValue({ items: [] }),
      recompute: jest.fn().mockResolvedValue({}),
    };
    controller = new SupportController(service as unknown as SupportService);
  });

  const payload = () => service.setItemStatus.mock.calls[0][0];

  it('acepta approved y rejected', async () => {
    await controller.setItemStatus(
      'order',
      'g',
      'i',
      { authorizationStatus: 'approved', reasonNotes: 'ticket' },
      req,
    );
    expect(payload().authorizationStatus).toBe('approved');
  });

  it('acepta volver la linea a pendiente con null', async () => {
    await controller.setItemStatus(
      'order',
      'g',
      'i',
      { authorizationStatus: null, reasonNotes: 'ticket' },
      req,
    );
    expect(payload().authorizationStatus).toBeNull();
  });

  it('RECHAZA countered: viaja con un precio y soporte no toca precios', async () => {
    await expect(
      controller.setItemStatus(
        'order',
        'g',
        'i',
        { authorizationStatus: 'countered', reasonNotes: 'ticket' },
        req,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.setItemStatus).not.toHaveBeenCalled();
  });

  it('rechaza una respuesta de vendedor invalida', async () => {
    await expect(
      controller.setItemStatus(
        'order',
        'g',
        'i',
        { sellerResponse: 'maybe', reasonNotes: 'ticket' },
        req,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exige motivo', async () => {
    await expect(
      controller.setItemStatus(
        'order',
        'g',
        'i',
        { authorizationStatus: 'approved', reasonNotes: '  ' },
        req,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.setItemStatus).not.toHaveBeenCalled();
  });

  it('exige al menos un campo de estado', async () => {
    await expect(
      controller.setItemStatus('order', 'g', 'i', { reasonNotes: 'ticket' }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no propaga campos que no vinieron en el body', async () => {
    await controller.setItemStatus(
      'order',
      'g',
      'i',
      { authorizationStatus: 'approved', reasonNotes: 'ticket' },
      req,
    );
    expect(payload()).not.toHaveProperty('sellerResponse');
    expect(payload()).not.toHaveProperty('authorizationRequired');
  });

  it('el actor sale del token', async () => {
    await controller.setItemStatus(
      'order',
      'g',
      'i',
      { authorizationStatus: 'rejected', reasonNotes: 'ticket' },
      req,
    );
    expect(payload().actorEmail).toBe('soporte@duwest.com');
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
