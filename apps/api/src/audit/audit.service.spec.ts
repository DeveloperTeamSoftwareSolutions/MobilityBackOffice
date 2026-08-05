import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuditService } from './audit.service';
import { AuditClient } from './audit.client';

/**
 * Escritura centralizada en AuditLogs. `record` propaga; `safeRecord` es best-effort.
 * Colaboradores mockeados (cliente del middleware + config del AppId).
 */
describe('AuditService', () => {
  let service: AuditService;
  let auditCreate: jest.Mock;

  beforeEach(async () => {
    auditCreate = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: AuditClient, useValue: { create: auditCreate } },
        { provide: ConfigService, useValue: { get: () => 'MobilityBackOffice' } },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  describe('record', () => {
    it('mapea la entrada al cuerpo del middleware con AppId', async () => {
      await service.record({
        action: 'REGION_LINK',
        entity: 'ContinentProfitCenters',
        category: 'regions',
        guidUsers: 'GUID-ADMIN',
        entityId: '1080',
        detail: 'user@duwest.com',
      });

      expect(auditCreate).toHaveBeenCalledTimes(1);
      expect(auditCreate.mock.calls[0][0]).toEqual({
        action: 'REGION_LINK',
        entity: 'ContinentProfitCenters',
        entityId: '1080',
        category: 'regions',
        guidUsers: 'GUID-ADMIN',
        detail: 'user@duwest.com',
        appId: 'MobilityBackOffice',
      });
    });

    it('NO manda timestamps: los pone el middleware', async () => {
      // Antes los ponía BackOffice con Date.now(), así que la hora de la auditoría era la
      // del proceso que auditaba y no la del servidor de base donde queda la fila.
      await service.record({ action: 'LOGIN', entity: 'Auth', category: 'auth' });

      const body = auditCreate.mock.calls[0][0];
      expect(body).not.toHaveProperty('timeStamp');
      expect(body).not.toHaveProperty('serverTimestamp');
    });

    it('normaliza campos opcionales ausentes a null', async () => {
      await service.record({ action: 'LOGOUT', entity: 'Auth', category: 'auth' });

      const body = auditCreate.mock.calls[0][0];
      expect(body.guidUsers).toBeNull();
      expect(body.entityId).toBeNull();
      expect(body.detail).toBeNull();
    });

    it('propaga el error si el middleware falla', async () => {
      // El login audita con `record` a propósito: ahí la auditoría es parte del contrato
      // y su fallo tiene que verse. La política la decide el servicio, no el transporte.
      auditCreate.mockRejectedValue(new Error('middleware caido'));

      await expect(
        service.record({ action: 'LOGIN', entity: 'Auth', category: 'auth' }),
      ).rejects.toThrow('middleware caido');
    });
  });

  describe('safeRecord', () => {
    it('registra igual que record en el camino feliz', async () => {
      await service.safeRecord({
        action: 'REGION_UNLINK',
        entity: 'ContinentProfitCenters',
        category: 'regions',
      });

      expect(auditCreate).toHaveBeenCalledTimes(1);
    });

    it('no propaga si el middleware falla (best-effort)', async () => {
      auditCreate.mockRejectedValue(new Error('middleware caido'));

      await expect(
        service.safeRecord({
          action: 'REGION_UNLINK',
          entity: 'ContinentProfitCenters',
          category: 'regions',
        }),
      ).resolves.toBeUndefined();
    });
  });
});
