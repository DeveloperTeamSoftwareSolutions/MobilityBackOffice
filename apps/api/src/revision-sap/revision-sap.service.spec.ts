import { BadRequestException } from '@nestjs/common';
import { RevisionSapService } from './revision-sap.service';
import { RevisionSapClient } from './revision-sap.client';
import { AuditService } from '../audit/audit.service';
import { AuditCategory } from '../audit/audit.categories';

const ORDER = '11111111-2222-3333-4444-555555555555';
const ITEM = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const item = {
  guid: ITEM,
  lineNumber: 2,
  productCode: '1001917',
  productDescription: 'ACTIV 80',
  quantity: 1,
  unitOfMeasure: 'UN',
  centerCode: null,
  deliveryDestinationCode: '30000124',
  deliveryDestinationName: 'Inversiones',
  destinationExplicit: true,
};

describe('RevisionSapService — cambio de destino', () => {
  let client: jest.Mocked<Pick<RevisionSapClient, 'changeItemDestination'>>;
  let audit: jest.Mocked<Pick<AuditService, 'safeRecord'>>;
  let service: RevisionSapService;
  const actor = { email: 'bo@duwest.com', guid: 'g-1', guidApiLoginClients: 'c-1' };

  beforeEach(() => {
    client = { changeItemDestination: jest.fn() };
    audit = { safeRecord: jest.fn().mockResolvedValue(undefined) };
    service = new RevisionSapService(
      client as unknown as RevisionSapClient,
      audit as unknown as AuditService,
    );
  });

  it('manda el email del token al middleware y audita el cambio', async () => {
    client.changeItemDestination.mockResolvedValue({ ok: true, unchanged: false, item });
    await service.changeItemDestination(ORDER, ITEM, '30000124', 'motivo', actor);

    expect(client.changeItemDestination).toHaveBeenCalledWith(ORDER, ITEM, {
      destinationCode: '30000124',
      actorEmail: 'bo@duwest.com',
      reasonNotes: 'motivo',
    });
    expect(audit.safeRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'REVISION_SAP_DESTINATION_CHANGE',
        category: AuditCategory.SapReview,
        entityId: ITEM,
        guidApiLoginClients: 'c-1',
        actorEmail: 'bo@duwest.com',
      }),
    );
    expect(audit.safeRecord.mock.calls[0][0].detail).toContain('destino=30000124');
  });

  it('si el destino ya era ese, no audita nada', async () => {
    client.changeItemDestination.mockResolvedValue({ ok: true, unchanged: true, item });
    await service.changeItemDestination(ORDER, ITEM, '30000124', null, actor);
    expect(audit.safeRecord).not.toHaveBeenCalled();
  });

  it('sin email en la sesion no llama al middleware', async () => {
    await expect(
      service.changeItemDestination(ORDER, ITEM, '30000124', null, { guid: 'g-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(client.changeItemDestination).not.toHaveBeenCalled();
  });

  it('si el middleware rechaza, no queda auditoria de un cambio que no ocurrio', async () => {
    client.changeItemDestination.mockRejectedValue(new BadRequestException('fuera del area'));
    await expect(
      service.changeItemDestination(ORDER, ITEM, '39999999', null, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.safeRecord).not.toHaveBeenCalled();
  });
});
