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
   * Reenvío a SAP — CONECTADO el 2026-09-21 (Middleware ≥ 1.361.1).
   *
   * Lo que se fija acá es la auditoría, porque es la única huella que queda de una
   * acción irreversible. Con la orden partida por centro, un resumen no alcanza: si
   * mañana hay que reconstruir qué pasó, el detalle tiene que decir QUÉ centro salió y
   * con qué número de pedido.
   */
  describe('reenvío a SAP, partido por centro', () => {
    const resultado = (over: Record<string, unknown> = {}) => ({
      accepted: true,
      partial: false,
      skipped: false,
      skippedReason: null,
      buckets: [
        {
          centerCode: '2801',
          itemsCount: 1,
          status: 'accepted' as const,
          sapOrderNumber: '0004500123',
          sapDispatchNumber: '0080001234',
          error: null,
          sapMessages: [],
        },
      ],
      totalBuckets: 1,
      acceptedBuckets: 1,
      failedBuckets: 0,
      error: null,
      filteredItemsCount: 0,
      itemsSent: 1,
      stillInReview: false,
      ...over,
    });

    it('manda el email de la sesión y devuelve el resultado por centro', async () => {
      client.resendToSap.mockResolvedValue(resultado());

      const r = await service.resendToSap(ORDER, actor);

      expect(client.resendToSap).toHaveBeenCalledWith(ORDER, 'bo@duwest.com');
      expect(r.buckets).toHaveLength(1);
    });

    it('la auditoría dice qué centro salió y con qué número de pedido', async () => {
      client.resendToSap.mockResolvedValue(resultado());

      await service.resendToSap(ORDER, actor);

      const registro = audit.safeRecord.mock.calls[0][0];
      expect(registro.action).toBe('REVISION_SAP_RESEND');
      expect(registro.category).toBe(AuditCategory.SapReview);
      expect(registro.detail).toContain('resultado=aceptada');
      expect(registro.detail).toContain('centros=1/1');
      expect(registro.detail).toContain('2801:accepted/0004500123');
    });

    /**
     * El fallo parcial deja pedidos YA creados en SAP. Que se distinga en la auditoría
     * no es cosmético: es la diferencia entre "no salió" y "salió a medias", y sólo el
     * segundo caso hace que reintentar duplique.
     */
    it('un fallo parcial se marca como tal, no como un rechazo', async () => {
      client.resendToSap.mockResolvedValue(
        resultado({
          accepted: false,
          partial: true,
          buckets: [
            ...resultado().buckets,
            {
              centerCode: '2802',
              itemsCount: 1,
              status: 'rejected' as const,
              sapOrderNumber: null,
              sapDispatchNumber: null,
              error: '[E] material no ampliado',
              sapMessages: [],
            },
          ],
          totalBuckets: 2,
          acceptedBuckets: 1,
          failedBuckets: 1,
          stillInReview: true,
        }),
      );

      await service.resendToSap(ORDER, actor);

      const detalle = audit.safeRecord.mock.calls[0][0].detail;
      expect(detalle).toContain('resultado=PARCIAL');
      expect(detalle).toContain('centros=1/2');
      expect(detalle).toContain('2802:rejected');
    });

    /** Se audita aunque SAP rechace todo: el intento también es un hecho. */
    it('audita igual cuando SAP rechaza', async () => {
      client.resendToSap.mockResolvedValue(
        resultado({ accepted: false, buckets: [], totalBuckets: 0, acceptedBuckets: 0, stillInReview: true }),
      );

      await service.resendToSap(ORDER, actor);

      expect(audit.safeRecord).toHaveBeenCalledTimes(1);
      expect(audit.safeRecord.mock.calls[0][0].detail).toContain('resultado=rechazada');
    });

    it('sin email en la sesión no se envía nada', async () => {
      await expect(service.resendToSap(ORDER, { guid: 'g-1' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(client.resendToSap).not.toHaveBeenCalled();
      expect(audit.safeRecord).not.toHaveBeenCalled();
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
