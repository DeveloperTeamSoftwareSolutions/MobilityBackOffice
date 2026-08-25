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
