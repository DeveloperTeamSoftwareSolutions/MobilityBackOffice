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
  let client: jest.Mocked<
    Pick<
      RevisionSapClient,
      'changeItemDestination' | 'changeItemCenter' | 'changeGroupInvoice' | 'resendToSap'
    >
  >;
  let audit: jest.Mocked<Pick<AuditService, 'safeRecord'>>;
  let service: RevisionSapService;
  const actor = { email: 'bo@duwest.com', guid: 'g-1', guidApiLoginClients: 'c-1' };

  beforeEach(() => {
    client = {
      changeItemDestination: jest.fn(),
      changeItemCenter: jest.fn(),
      changeGroupInvoice: jest.fn(),
      resendToSap: jest.fn(),
    };
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

  it('cambio de centro: manda el email del token y audita solo si cambio', async () => {
    client.changeItemCenter.mockResolvedValue({ ok: true, unchanged: false, item: { ...item, centerCode: '2802' } });
    await service.changeItemCenter(ORDER, ITEM, '2802', null, actor);
    expect(client.changeItemCenter).toHaveBeenCalledWith(ORDER, ITEM, {
      centerCode: '2802',
      actorEmail: 'bo@duwest.com',
      reasonNotes: null,
    });
    expect(audit.safeRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REVISION_SAP_CENTER_CHANGE', category: AuditCategory.SapReview }),
    );
    expect(audit.safeRecord.mock.calls[0][0].detail).toContain('centro=2802');

    audit.safeRecord.mockClear();
    client.changeItemCenter.mockResolvedValue({ ok: true, unchanged: true, item });
    await service.changeItemCenter(ORDER, ITEM, '2802', null, actor);
    expect(audit.safeRecord).not.toHaveBeenCalled();

    await expect(
      service.changeItemCenter(ORDER, ITEM, '2802', null, { guid: 'g-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  /**
   * Agrupa factura no toca ninguna linea, pero decide si la orden entera puede salir
   * parcial: por eso se audita igual, sobre la ORDEN y no sobre un item.
   */
  it('agrupa factura: audita sobre la orden, y solo si cambio', async () => {
    client.changeGroupInvoice.mockResolvedValue({ ok: true, unchanged: false, groupInvoice: true });
    await service.changeGroupInvoice(ORDER, true, 'lo pidio el cliente', actor);

    expect(client.changeGroupInvoice).toHaveBeenCalledWith(ORDER, {
      groupInvoice: true,
      actorEmail: 'bo@duwest.com',
      reasonNotes: 'lo pidio el cliente',
    });
    expect(audit.safeRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'REVISION_SAP_GROUP_INVOICE_CHANGE',
        category: AuditCategory.SapReview,
        entity: 'BusinessOrders',
        entityId: ORDER,
      }),
    );
    expect(audit.safeRecord.mock.calls[0][0].detail).toContain('agrupaFactura=si');

    audit.safeRecord.mockClear();
    client.changeGroupInvoice.mockResolvedValue({ ok: true, unchanged: true, groupInvoice: true });
    await service.changeGroupInvoice(ORDER, true, null, actor);
    expect(audit.safeRecord).not.toHaveBeenCalled();

    await expect(
      service.changeGroupInvoice(ORDER, false, null, { guid: 'g-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  /**
   * El reenvío se audita SIEMPRE, no sólo cuando sale bien: crea un pedido real en SAP
   * y un rechazo auditado es lo que explica por qué la orden sigue en la bandeja. Es la
   * diferencia con los cambios de línea, que no se auditan si no cambió nada.
   */
  describe('reenvío a SAP', () => {
    const aceptada = {
      accepted: true, skipped: false, skippedReason: null,
      sapOrderNumber: '0004500123', sapDispatchNumber: '0080001234',
      error: null, sapMessages: [], filteredItemsCount: 0, itemsSent: 3, stillInReview: false,
    };

    it('acepta: audita con el número de pedido y la orden sale de revisión', async () => {
      client.resendToSap.mockResolvedValue(aceptada);
      const r = await service.resendToSap(ORDER, actor);

      expect(client.resendToSap).toHaveBeenCalledWith(ORDER, 'bo@duwest.com');
      expect(r.stillInReview).toBe(false);
      expect(audit.safeRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'REVISION_SAP_RESEND',
          category: AuditCategory.SapReview,
          entity: 'BusinessOrders',
          entityId: ORDER,
        }),
      );
      const detail = audit.safeRecord.mock.calls[0][0].detail;
      expect(detail).toContain('resultado=aceptada');
      expect(detail).toContain('pedido=0004500123');
    });

    it('rechaza: TAMBIÉN audita, con el motivo', async () => {
      client.resendToSap.mockResolvedValue({
        ...aceptada, accepted: false, sapOrderNumber: null, sapDispatchNumber: null,
        error: '[E] El material no está ampliado para el centro 2802.', stillInReview: true,
      });
      await service.resendToSap(ORDER, actor);

      const detail = audit.safeRecord.mock.calls[0][0].detail;
      expect(detail).toContain('resultado=rechazada');
      expect(detail).toContain('no está ampliado');
    });

    it('sin email en la sesión no llama al middleware', async () => {
      await expect(service.resendToSap(ORDER, { guid: 'g-1' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(client.resendToSap).not.toHaveBeenCalled();
    });
  });

  it('si el middleware rechaza, no queda auditoria de un cambio que no ocurrio', async () => {
    client.changeItemDestination.mockRejectedValue(new BadRequestException('fuera del area'));
    await expect(
      service.changeItemDestination(ORDER, ITEM, '39999999', null, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.safeRecord).not.toHaveBeenCalled();
  });
});
