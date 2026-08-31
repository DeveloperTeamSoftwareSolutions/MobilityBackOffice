import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RegionsService } from './regions.service';
import { AuditCategory } from '../audit/audit.categories';
import type { RegionsRepository } from './regions.repository';
import type { AuditService, AuditEntry } from '../audit/audit.service';
import type { Region } from './regions.types';

const REGION_CA: Region = {
  id: 1,
  guid: 'guid-ca',
  timeStamp: 0,
  serverTimestamp: 0,
  deletedTimestamp: null,
  code: 'CA',
  name: 'Centroamérica',
  sortOrder: 1,
  isGroup: false,
  cebeCount: 0,
};

const ACTOR = {
  email: 'juan@duwest.com',
  guid: 'guid-usuario',
  guidApiLoginClients: 'guid-cliente',
};

function build(repoOverrides: Partial<RegionsRepository> = {}) {
  const audited: AuditEntry[] = [];

  const repo = {
    getByGuid: jest.fn().mockResolvedValue({ ...REGION_CA, cebes: [] }),
    getByCode: jest.fn().mockResolvedValue(REGION_CA),
    getActiveLinks: jest.fn().mockResolvedValue([]),
    linkCebe: jest.fn().mockResolvedValue(undefined),
    unlinkCebe: jest.fn().mockResolvedValue(true),
    resolveCebesByCodes: jest.fn().mockResolvedValue([]),
    ...repoOverrides,
  } as unknown as RegionsRepository;

  const audit = {
    safeRecord: jest.fn((e: AuditEntry) => {
      audited.push(e);
      return Promise.resolve();
    }),
  } as unknown as AuditService;

  return { service: new RegionsService(repo, audit), repo, audited };
}

describe('RegionsService.linkCebes', () => {
  it('vincula el CEBE con su sociedad y reporta cuantos', async () => {
    const { service, repo } = build();
    const res = await service.linkCebes(
      'guid-ca',
      [{ code: '1003', companyCode: '2100', name: 'Duwest Banano' }],
      ACTOR,
    );
    expect(res).toEqual({ linked: 1 });
    expect(repo.linkCebe).toHaveBeenCalledWith(
      'guid-ca',
      '1003',
      '2100',
      'Duwest Banano',
      'ui',
      'juan@duwest.com',
    );
  });

  it('audita cada vinculo con la region, el CEBE y la sociedad', async () => {
    const { service, audited } = build();
    await service.linkCebes('guid-ca', [{ code: '1003', companyCode: '2100' }], ACTOR);
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      action: 'REGION_CEBE_LINK',
      entity: 'ContinentProfitCenter',
      entityId: '1003',
      category: AuditCategory.Regions,
      guidUsers: 'guid-usuario',
      // Sin el cliente la fila no se ve desde ITManager; el email va en su columna.
      guidApiLoginClients: 'guid-cliente',
      actorEmail: 'juan@duwest.com',
    });
    expect(audited[0].detail).toContain('region=CA');
    expect(audited[0].detail).toContain('sociedad=2100');
  });

  it('recorta los espacios de code y companyCode', async () => {
    const { service, repo } = build();
    await service.linkCebes('guid-ca', [{ code: ' 1003 ', companyCode: ' 2100 ' }], ACTOR);
    expect(repo.linkCebe).toHaveBeenCalledWith(
      'guid-ca',
      '1003',
      '2100',
      null,
      'ui',
      'juan@duwest.com',
    );
  });

  describe('validaciones', () => {
    it('rechaza la lista vacia', async () => {
      const { service } = build();
      await expect(service.linkCebes('guid-ca', [], ACTOR)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza si algun CEBE viene sin sociedad', async () => {
      const { service } = build();
      await expect(
        service.linkCebes(
          'guid-ca',
          [
            { code: '1003', companyCode: '2100' },
            { code: '1080', companyCode: '' },
          ],
          ACTOR,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('no vincula NADA si un item del lote es invalido', async () => {
      const { service, repo } = build();
      await expect(
        service.linkCebes(
          'guid-ca',
          [
            { code: '1003', companyCode: '2100' },
            { code: '1080', companyCode: '' },
          ],
          ACTOR,
        ),
      ).rejects.toThrow();
      expect(repo.linkCebe).not.toHaveBeenCalled();
    });

    it('rechaza si la region no existe', async () => {
      const { service } = build({
        getByGuid: jest.fn().mockResolvedValue(null),
      });
      await expect(
        service.linkCebes('no-existe', [{ code: '1003', companyCode: '2100' }], ACTOR),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

describe('RegionsService.unlinkCebe', () => {
  it('desvincula y audita', async () => {
    const { service, audited } = build();
    const ok = await service.unlinkCebe('guid-ca', '1003', '2100', ACTOR);
    expect(ok).toBe(true);
    expect(audited[0]).toMatchObject({ action: 'REGION_CEBE_UNLINK', entityId: '1003' });
  });

  it('devuelve false si el vinculo no existia, y no audita', async () => {
    const { service, audited } = build({
      unlinkCebe: jest.fn().mockResolvedValue(false),
    });
    expect(await service.unlinkCebe('guid-ca', '1003', '2100', ACTOR)).toBe(false);
    expect(audited).toHaveLength(0);
  });

  it('exige la sociedad', async () => {
    const { service } = build();
    await expect(service.unlinkCebe('guid-ca', '1003', '  ', ACTOR)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('RegionsService.sync', () => {
  it('agrega los vinculos faltantes', async () => {
    const { service, repo } = build();
    const res = await service.sync(
      { regions: [{ code: 'CA', cebes: [{ code: '1003', companyCode: '2100' }] }] },
      'sap-sync',
    );
    expect(res).toMatchObject({ regions: 1, added: 1, removed: 0, skipped: [] });
    expect(repo.linkCebe).toHaveBeenCalledWith(
      'guid-ca',
      '1003',
      '2100',
      null,
      'sap',
      'sap-sync',
    );
  });

  it('quita los vinculos que ya no estan en el estado deseado', async () => {
    const { service, repo } = build({
      getActiveLinks: jest
        .fn()
        .mockResolvedValue([{ profitCenterCode: '9999', companyCode: '2100' }]),
    });
    const res = await service.sync(
      { regions: [{ code: 'CA', cebes: [] }] },
      'sap-sync',
    );
    expect(res).toMatchObject({ added: 0, removed: 1 });
    expect(repo.unlinkCebe).toHaveBeenCalledWith('guid-ca', '9999', '2100');
  });

  it('es idempotente: reenviar el mismo estado no cambia nada', async () => {
    const { service } = build({
      getActiveLinks: jest
        .fn()
        .mockResolvedValue([{ profitCenterCode: '1003', companyCode: '2100' }]),
    });
    const res = await service.sync(
      { regions: [{ code: 'CA', cebes: [{ code: '1003', companyCode: '2100' }] }] },
      'sap-sync',
    );
    expect(res).toMatchObject({ added: 0, removed: 0 });
  });

  it('NUNCA crea regiones: las desconocidas van a skipped', async () => {
    const { service, repo } = build({
      getByCode: jest.fn().mockResolvedValue(null),
    });
    const res = await service.sync(
      { regions: [{ code: 'INEXISTENTE', cebes: [{ code: '1', companyCode: '2' }] }] },
      'sap-sync',
    );
    expect(res.skipped).toEqual(['INEXISTENTE']);
    expect(repo.linkCebe).not.toHaveBeenCalled();
  });

  it('ignora los pares sin CEBE o sin sociedad', async () => {
    const { service, repo } = build();
    const res = await service.sync(
      {
        regions: [
          {
            code: 'CA',
            cebes: [
              { code: '1003', companyCode: '2100' },
              { code: '', companyCode: '2100' },
              { code: '1080', companyCode: '' },
            ],
          },
        ],
      },
      'sap-sync',
    );
    expect(res.added).toBe(1);
    expect(repo.linkCebe).toHaveBeenCalledTimes(1);
  });

  it('respeta el source del payload', async () => {
    const { service, repo } = build();
    await service.sync(
      {
        regions: [{ code: 'CA', cebes: [{ code: '1003', companyCode: '2100' }] }],
        source: 'erp-externo',
      },
      'sap-sync',
    );
    expect(repo.linkCebe).toHaveBeenCalledWith(
      'guid-ca',
      '1003',
      '2100',
      null,
      'erp-externo',
      'sap-sync',
    );
  });

  it('rechaza un payload sin array de regiones', async () => {
    const { service } = build();
    await expect(
      service.sync({ regions: undefined as never }, 'sap-sync'),
    ).rejects.toThrow(BadRequestException);
  });

  it('audita el resumen del sync', async () => {
    const { service, audited } = build();
    await service.sync(
      { regions: [{ code: 'CA', cebes: [{ code: '1003', companyCode: '2100' }] }] },
      'sap-sync',
    );
    const resumen = audited.find((e) => e.action === 'REGION_SYNC');
    expect(resumen).toBeDefined();
    expect(resumen?.detail).toContain('altas=1');
  });
});

describe('RegionsService.getGroups', () => {
  it('devuelve CAYCAR como region virtual con sus CEBEs efectivos', async () => {
    const { service, repo } = build({
      resolveCebesByCodes: jest.fn().mockResolvedValue([
        { profitCenterCode: '1003', profitCenterName: null, companyCode: '2100', companyName: null },
        { profitCenterCode: '1003', profitCenterName: null, companyCode: '3000', companyName: null },
      ]),
    });
    const [caycar] = await service.getGroups();
    expect(caycar).toMatchObject({
      code: 'CAYCAR',
      guid: 'CAYCAR',
      isGroup: true,
      cebeCount: 2,
    });
    expect(repo.resolveCebesByCodes).toHaveBeenCalledWith(['CA', 'CB']);
  });
});

describe('RegionsService.resolve', () => {
  it('expande la agrupacion antes de resolver', async () => {
    const { service, repo } = build();
    await service.resolve('CAYCAR');
    expect(repo.resolveCebesByCodes).toHaveBeenCalledWith(['CA', 'CB']);
  });

  it('una region atomica se resuelve sola', async () => {
    const { service, repo } = build();
    await service.resolve('AN');
    expect(repo.resolveCebesByCodes).toHaveBeenCalledWith(['AN']);
  });
});
