import { BadRequestException } from '@nestjs/common';
import { RevisionSapController } from './revision-sap.controller';
import { RevisionSapService } from './revision-sap.service';

const ORDER = '11111111-2222-3333-4444-555555555555';
const ITEM = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('RevisionSapController', () => {
  let service: jest.Mocked<
    Pick<RevisionSapService, 'listQueue' | 'getOrder' | 'getOptions' | 'changeItemDestination'>
  >;
  let controller: RevisionSapController;

  beforeEach(() => {
    service = {
      listQueue: jest.fn().mockResolvedValue({ data: [], pagination: { total: 0, page: 1, limit: 20, totalPages: 0 } }),
      getOrder: jest.fn().mockResolvedValue({ guid: ORDER }),
      getOptions: jest.fn().mockResolvedValue({ centers: [] }),
      changeItemDestination: jest.fn().mockResolvedValue({ ok: true, unchanged: false, item: {} }),
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
