import { BadRequestException } from '@nestjs/common';
import { RevisionSapController } from './revision-sap.controller';
import { RevisionSapService } from './revision-sap.service';

const ORDER = '11111111-2222-3333-4444-555555555555';
const ITEM = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('RevisionSapController', () => {
  let service: jest.Mocked<
    Pick<
      RevisionSapService,
      | 'listQueue'
      | 'getOrder'
      | 'getOptions'
      | 'changeItemDestination'
      | 'changeItemCenter'
      | 'listSapOrders'
      | 'getProductStock'
      | 'changeGroupInvoice'
      | 'resendToSap'
    >
  >;
  let controller: RevisionSapController;

  beforeEach(() => {
    service = {
      listQueue: jest.fn().mockResolvedValue({ data: [], pagination: { total: 0, page: 1, limit: 20, totalPages: 0 } }),
      getOrder: jest.fn().mockResolvedValue({ guid: ORDER }),
      getOptions: jest.fn().mockResolvedValue({ centers: [] }),
      changeItemDestination: jest.fn().mockResolvedValue({ ok: true, unchanged: false, item: {} }),
      changeItemCenter: jest.fn().mockResolvedValue({ ok: true, unchanged: false, item: {} }),
      listSapOrders: jest.fn().mockResolvedValue([]),
      getProductStock: jest.fn().mockResolvedValue({ rows: [] }),
      changeGroupInvoice: jest.fn().mockResolvedValue({ ok: true, unchanged: false, groupInvoice: true }),
      resendToSap: jest.fn().mockResolvedValue({ accepted: true, stillInReview: false }),
    };
    controller = new RevisionSapController(service as unknown as RevisionSapService);
  });

  it('la bandeja acota el limite y descarta un orden que no esta en la lista', async () => {
    await controller.list('0', '9999', '  ORD  ', 'Id;DROP', 'sideways');
    expect(service.listQueue).toHaveBeenCalledWith({
      page: 1,
      limit: 200,
      search: 'ORD',
      sortBy: 'sapLastAttemptAt',
      sortDir: 'DESC',
    });
  });

  it('rechaza un guid invalido sin llamar al servicio', async () => {
    await expect(controller.getOrder('no-es-guid')).rejects.toBeInstanceOf(BadRequestException);
    expect(service.getOrder).not.toHaveBeenCalled();
  });

  it('el stock solo se pide explicitamente', async () => {
    await controller.options(ORDER);
    expect(service.getOptions).toHaveBeenLastCalledWith(ORDER, false);
    await controller.options(ORDER, '1');
    expect(service.getOptions).toHaveBeenLastCalledWith(ORDER, true);
  });

  it('el actor del cambio sale del token, no del body', async () => {
    await controller.changeDestination(
      ORDER,
      ITEM,
      { destinationCode: ' 30000112 ', reasonNotes: ' SAP rechazo el destino ', actorEmail: 'otro@x.com' } as never,
      { user: { email: 'bo@duwest.com', guid: 'g-1', guidApiLoginClients: 'c-1' } },
    );
    expect(service.changeItemDestination).toHaveBeenCalledWith(
      ORDER,
      ITEM,
      '30000112',
      'SAP rechazo el destino',
      { email: 'bo@duwest.com', guid: 'g-1', guidApiLoginClients: 'c-1' },
    );
  });

  it('cambio de centro: valida el codigo y toma el actor del token', async () => {
    const req = { user: { email: 'bo@duwest.com', guid: 'g-1' } };
    await expect(
      controller.changeCenter(ORDER, ITEM, { centerCode: "28'02" }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.changeCenter(ORDER, ITEM, { centerCode: '123456789' }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.changeItemCenter).not.toHaveBeenCalled();

    await controller.changeCenter(ORDER, ITEM, { centerCode: ' 2802 ' }, req);
    expect(service.changeItemCenter).toHaveBeenCalledWith(ORDER, ITEM, '2802', null, {
      email: 'bo@duwest.com',
      guid: 'g-1',
      guidApiLoginClients: null,
    });
  });

  it('stock: valida el guid y el codigo de producto', async () => {
    await expect(controller.productStock('x', '1001917')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.productStock(ORDER, "100'--")).rejects.toBeInstanceOf(BadRequestException);
    expect(service.getProductStock).not.toHaveBeenCalled();

    await controller.productStock(ORDER, ' 1001917 ');
    expect(service.getProductStock).toHaveBeenCalledWith(ORDER, '1001917');
  });

  it('ordenes SAP: valida el guid antes de pedirlas', async () => {
    await expect(controller.sapOrders('x')).rejects.toBeInstanceOf(BadRequestException);
    await controller.sapOrders(ORDER);
    expect(service.listSapOrders).toHaveBeenCalledWith(ORDER);
  });

  it('agrupa factura: exige un booleano, no "si" ni 1', async () => {
    const req = { user: { email: 'bo@duwest.com', guid: 'g-1' } };
    await expect(
      controller.changeGroupInvoice(ORDER, { groupInvoice: 'si' }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.changeGroupInvoice(ORDER, { groupInvoice: 1 }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.changeGroupInvoice(ORDER, {}, req)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      controller.changeGroupInvoice('no-es-guid', { groupInvoice: true }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.changeGroupInvoice).not.toHaveBeenCalled();

    await controller.changeGroupInvoice(
      ORDER,
      { groupInvoice: false, reasonNotes: ' el cliente acepta parcial ' },
      req,
    );
    expect(service.changeGroupInvoice).toHaveBeenCalledWith(
      ORDER,
      false,
      'el cliente acepta parcial',
      { email: 'bo@duwest.com', guid: 'g-1', guidApiLoginClients: null },
    );
  });

  /**
   * El reenvío no lleva body: QUÉ se manda lo decide el servidor con lo que está
   * guardado, y QUIÉN lo manda sale del token. Nada de eso se acepta del cliente.
   */
  it('reenvío: valida el guid y toma el actor del token, sin body', async () => {
    await expect(controller.resend('no-es-guid', { user: { email: 'bo@duwest.com' } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.resendToSap).not.toHaveBeenCalled();

    await controller.resend(ORDER, {
      user: { email: 'bo@duwest.com', guid: 'g-1', guidApiLoginClients: 'c-1' },
    });
    expect(service.resendToSap).toHaveBeenCalledWith(ORDER, {
      email: 'bo@duwest.com',
      guid: 'g-1',
      guidApiLoginClients: 'c-1',
    });
  });

  it('valida el destino y el motivo antes de llamar al servicio', async () => {
    const req = { user: { email: 'bo@duwest.com' } };
    await expect(
      controller.changeDestination(ORDER, ITEM, { destinationCode: "30'--" }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.changeDestination(ORDER, ITEM, {}, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.changeDestination(ORDER, ITEM, { destinationCode: '30000112', reasonNotes: 5 }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.changeDestination(ORDER, 'x', { destinationCode: '30000112' }, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.changeItemDestination).not.toHaveBeenCalled();
  });
});
