import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { WarehousesService, CENTER_SORT_FIELDS } from './warehouses.service';
import { ScopeService } from '../scope/scope.service';
import { WarehousesClient } from './warehouses.client';
import { AuditService } from '../audit/audit.service';
import { AuditCategory } from '../audit/audit.categories';
import { Actor } from '../common/actor';

function make(scope: { isAdmin: boolean; companyCodes: string[] }) {
  const scopeSvc = {
    getScopeCompanyCodes: jest.fn().mockResolvedValue(scope),
  } as unknown as ScopeService;
  const client = {
    getCenters: jest.fn().mockResolvedValue({ data: [], pagination: {} }),
    getWarehouses: jest.fn().mockResolvedValue({ data: [], pagination: {} }),
    getReservedCustomers: jest.fn().mockResolvedValue([]),
    searchCustomers: jest.fn().mockResolvedValue([]),
    addCustomer: jest.fn().mockResolvedValue(undefined),
    removeCustomer: jest.fn().mockResolvedValue(undefined),
    setAvailability: jest.fn().mockResolvedValue(undefined),
    setCenterRestricted: jest.fn().mockResolvedValue(undefined),
    getReservedGroups: jest.fn().mockResolvedValue([]),
    searchCustomerGroups: jest.fn().mockResolvedValue([]),
    getGroupCustomers: jest.fn().mockResolvedValue({ data: [], pagination: {} }),
    addCustomerGroup: jest.fn().mockResolvedValue({
      warehouse: {
        guid: 'W',
        companyCode: '2100',
        centerCode: '2104',
        warehouseCode: '0001',
      },
      customerGroupCode: 'T3',
      customerGroupName: 'Ingenio El Angel',
      customerCount: 715,
      reactivated: false,
      alreadyExisted: false,
    }),
    removeCustomerGroup: jest.fn().mockResolvedValue({ removed: true, stillRestricted: false }),
  };
  const audit = { safeRecord: jest.fn().mockResolvedValue(undefined) };
  const service = new WarehousesService(
    scopeSvc,
    client as unknown as WarehousesClient,
    audit as unknown as AuditService,
  );
  return { service, client, audit };
}

const MGR = 'USUARIO-GUID';
const KEY = { companyCode: '2100', centerCode: '2104', warehouseCode: '0001' };
const ACTOR: Actor = {
  email: 'usuario@x.com',
  guid: MGR,
  guidApiLoginClients: 'CLIENT-GUID',
};

describe('WarehousesService — alcance en las lecturas', () => {
  it('admin: llama al client con companyCodes vacío (ve todo)', async () => {
    const { service, client } = make({ isAdmin: true, companyCodes: [] });
    await service.getCenters(MGR, {});
    expect(client.getCenters).toHaveBeenCalledWith([], expect.any(Object));
  });

  it('no-admin con sociedades: pasa sus companyCodes', async () => {
    const { service, client } = make({ isAdmin: false, companyCodes: ['2100', '2000'] });
    await service.getCenters(MGR, {});
    expect(client.getCenters).toHaveBeenCalledWith(['2100', '2000'], expect.any(Object));
  });

  it('no-admin sin sociedades: devuelve vacío sin llamar al middleware', async () => {
    const { service, client } = make({ isAdmin: false, companyCodes: [] });
    const res = await service.getCenters(MGR, {});
    expect(res.data).toEqual([]);
    expect(client.getCenters).not.toHaveBeenCalled();
  });

  it('almacenes de un centro fuera del alcance → vacío, NO 403', async () => {
    // Leer fuera del alcance no es una acción prohibida: simplemente no hay nada suyo ahí.
    // El 403 se reserva para las escrituras.
    const { service, client } = make({ isAdmin: false, companyCodes: ['2100'] });
    const res = await service.getWarehousesOfCenter(MGR, {
      companyCode: '9999',
      centerCode: '1',
    });
    expect(res.data).toEqual([]);
    expect(client.getWarehouses).not.toHaveBeenCalled();
  });

  it('clientes reservados de un almacén fuera del alcance → vacío', async () => {
    const { service, client } = make({ isAdmin: false, companyCodes: ['2000'] });
    expect(await service.getReservedCustomers(MGR, KEY)).toEqual([]);
    expect(client.getReservedCustomers).not.toHaveBeenCalled();
  });

  it('almacenes sin companyCode/centerCode → 400', async () => {
    const { service } = make({ isAdmin: true, companyCodes: [] });
    await expect(service.getWarehousesOfCenter(MGR, { centerCode: '1' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('el buscador de clientes no se recorta por sociedad, pero exige término', async () => {
    // El maestro de clientes es global; el alcance corta al reservar, no al buscar.
    const { service, client } = make({ isAdmin: false, companyCodes: ['2000'] });
    expect(await service.searchCustomers('   ')).toEqual([]);
    expect(client.searchCustomers).not.toHaveBeenCalled();
    await service.searchCustomers(' acme ');
    expect(client.searchCustomers).toHaveBeenCalledWith('acme');
  });
});

describe('WarehousesService — escrituras validadas por alcance', () => {
  it('addCustomer dentro del alcance: delega al middleware con el actor', async () => {
    const { service, client } = make({ isAdmin: false, companyCodes: ['2100'] });
    await service.addCustomer(MGR, { ...KEY, customerCode: '10000099' }, ACTOR);
    expect(client.addCustomer).toHaveBeenCalledWith(KEY, '10000099', {
      userEmail: 'usuario@x.com',
    });
  });

  it('addCustomer fuera del alcance → 403 (no llama al middleware ni audita)', async () => {
    const { service, client, audit } = make({ isAdmin: false, companyCodes: ['2000'] });
    await expect(
      service.addCustomer(MGR, { ...KEY, customerCode: '10000099' }, ACTOR),
    ).rejects.toThrow(ForbiddenException);
    expect(client.addCustomer).not.toHaveBeenCalled();
    expect(audit.safeRecord).not.toHaveBeenCalled();
  });

  it('removeCustomer fuera del alcance → 403', async () => {
    const { service, client } = make({ isAdmin: false, companyCodes: ['2000'] });
    await expect(
      service.removeCustomer(MGR, { ...KEY, customerCode: '10000099' }, ACTOR),
    ).rejects.toThrow(ForbiddenException);
    expect(client.removeCustomer).not.toHaveBeenCalled();
  });

  it('restringir un CENTRO fuera del alcance → 403', async () => {
    const { service, client } = make({ isAdmin: false, companyCodes: ['2000'] });
    await expect(
      service.setCenterRestricted(
        MGR,
        { companyCode: '2100', centerCode: '2104', restricted: true },
        ACTOR,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(client.setCenterRestricted).not.toHaveBeenCalled();
  });

  it('un admin puede escribir en cualquier sociedad', async () => {
    const { service, client } = make({ isAdmin: true, companyCodes: [] });
    await service.setAvailability(MGR, { ...KEY, restricted: true }, ACTOR);
    expect(client.setAvailability).toHaveBeenCalledWith(KEY, true);
  });

  it('setAvailability sin restricted booleano → 400', async () => {
    const { service } = make({ isAdmin: true, companyCodes: [] });
    await expect(service.setAvailability(MGR, KEY, ACTOR)).rejects.toThrow(BadRequestException);
  });

  it('addCustomer sin customerCode → 400', async () => {
    const { service } = make({ isAdmin: true, companyCodes: [] });
    await expect(service.addCustomer(MGR, KEY, ACTOR)).rejects.toThrow(BadRequestException);
  });

  it('el motivo de restricción del centro se recorta antes de salir', async () => {
    // Más largo que la columna muere en el INSERT con un error de SQL que el usuario no puede
    // interpretar.
    const { service, client } = make({ isAdmin: true, companyCodes: [] });
    await service.setCenterRestricted(
      MGR,
      { companyCode: '2100', centerCode: '2104', restricted: true, reason: 'x'.repeat(900) },
      ACTOR,
    );
    const enviado = client.setCenterRestricted.mock.calls[0][0] as { reason: string };
    expect(enviado.reason).toHaveLength(512);
  });
});

describe('WarehousesService — auditoría en AuditLogs', () => {
  it('addCustomer: audita WAREHOUSE_CUSTOMER_ADD con almacén, cliente y dueño de la fila', async () => {
    const { service, audit } = make({ isAdmin: true, companyCodes: [] });
    await service.addCustomer(MGR, { ...KEY, customerCode: '10000099' }, ACTOR);
    expect(audit.safeRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WAREHOUSE_CUSTOMER_ADD',
        entity: 'Warehouse',
        entityId: '0001',
        category: AuditCategory.Warehouses,
        guidUsers: MGR,
        // Sin `guidApiLoginClients` la fila se guarda pero ITManager no la muestra.
        guidApiLoginClients: 'CLIENT-GUID',
        actorEmail: 'usuario@x.com',
        detail: expect.stringContaining('cliente=10000099'),
      }),
    );
    const detail = audit.safeRecord.mock.calls[0][0].detail as string;
    expect(detail).toContain('usuario@x.com');
    expect(detail).toContain('almacen=0001');
  });

  it('removeCustomer: audita WAREHOUSE_CUSTOMER_REMOVE', async () => {
    const { service, audit } = make({ isAdmin: true, companyCodes: [] });
    await service.removeCustomer(MGR, { ...KEY, customerCode: '10000099' }, ACTOR);
    expect(audit.safeRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WAREHOUSE_CUSTOMER_REMOVE',
        entityId: '0001',
        detail: expect.stringContaining('cliente=10000099'),
      }),
    );
  });

  it('setAvailability(true) audita WAREHOUSE_RESTRICT y (false) WAREHOUSE_ENABLE', async () => {
    const restringir = make({ isAdmin: true, companyCodes: [] });
    await restringir.service.setAvailability(MGR, { ...KEY, restricted: true }, ACTOR);
    expect(restringir.audit.safeRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WAREHOUSE_RESTRICT',
        detail: expect.stringContaining('estado=restringido'),
      }),
    );

    const liberar = make({ isAdmin: true, companyCodes: [] });
    await liberar.service.setAvailability(MGR, { ...KEY, restricted: false }, ACTOR);
    expect(liberar.audit.safeRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WAREHOUSE_ENABLE',
        detail: expect.stringContaining('estado=habilitado'),
      }),
    );
  });

  it('restringir un centro: audita CENTER_RESTRICT sobre DistributionCenter con el motivo', async () => {
    const { service, audit } = make({ isAdmin: true, companyCodes: [] });
    await service.setCenterRestricted(
      MGR,
      { companyCode: '2100', centerCode: '2104', restricted: true, reason: 'en obra' },
      ACTOR,
    );
    expect(audit.safeRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CENTER_RESTRICT',
        entity: 'DistributionCenter',
        entityId: '2100/2104',
        category: AuditCategory.Warehouses,
        detail: expect.stringContaining('motivo=en obra'),
      }),
    );
  });
});

describe('WarehousesService — reservas por grupo de clientes', () => {
  describe('alcance', () => {
    it('GET grupos dentro del alcance: pasa los companyCodes al middleware', async () => {
      const { service, client } = make({ isAdmin: false, companyCodes: ['2100', '2000'] });
      await service.getReservedGroups(MGR, KEY);
      expect(client.getReservedGroups).toHaveBeenCalledWith(['2100', '2000'], KEY);
    });

    it('GET grupos fuera del alcance → vacío sin llamar al middleware', async () => {
      const { service, client } = make({ isAdmin: false, companyCodes: ['2000'] });
      expect(await service.getReservedGroups(MGR, KEY)).toEqual([]);
      expect(client.getReservedGroups).not.toHaveBeenCalled();
    });

    it('buscador y clientes del grupo fuera del alcance → vacío sin llamar al middleware', async () => {
      const { service, client } = make({ isAdmin: false, companyCodes: ['2000'] });
      expect(
        await service.searchCustomerGroups(MGR, { companyCode: '2100', q: 'T' }),
      ).toEqual([]);
      const page = await service.getGroupCustomers(MGR, {
        companyCode: '2100',
        customerGroupCode: 'T3',
      });
      expect(page.data).toEqual([]);
      expect(client.searchCustomerGroups).not.toHaveBeenCalled();
      expect(client.getGroupCustomers).not.toHaveBeenCalled();
    });

    it('reservar fuera del alcance → 403 (no llama al middleware ni audita)', async () => {
      const { service, client, audit } = make({ isAdmin: false, companyCodes: ['2000'] });
      await expect(
        service.addCustomerGroup(MGR, { ...KEY, customerGroupCode: 'T3' }, ACTOR),
      ).rejects.toThrow(ForbiddenException);
      expect(client.addCustomerGroup).not.toHaveBeenCalled();
      expect(audit.safeRecord).not.toHaveBeenCalled();
    });

    it('quitar fuera del alcance → 403 (no llama al middleware ni audita)', async () => {
      const { service, client, audit } = make({ isAdmin: false, companyCodes: ['2000'] });
      await expect(
        service.removeCustomerGroup(MGR, { ...KEY, customerGroupCode: 'T3' }, ACTOR),
      ).rejects.toThrow(ForbiddenException);
      expect(client.removeCustomerGroup).not.toHaveBeenCalled();
      expect(audit.safeRecord).not.toHaveBeenCalled();
    });
  });

  describe('validación', () => {
    it('el 37 se rechaza con 400 antes del alcance y del middleware', async () => {
      const { service, client, audit } = make({ isAdmin: true, companyCodes: [] });
      await expect(
        service.addCustomerGroup(MGR, { ...KEY, customerGroupCode: '37' }, ACTOR),
      ).rejects.toThrow(BadRequestException);
      expect(client.addCustomerGroup).not.toHaveBeenCalled();
      expect(audit.safeRecord).not.toHaveBeenCalled();
    });

    it('quitar el 37 SÍ se permite: si quedó reservado por fuera, hay que poder sacarlo', async () => {
      const { service, client } = make({ isAdmin: true, companyCodes: [] });
      await service.removeCustomerGroup(MGR, { ...KEY, customerGroupCode: '37' }, ACTOR);
      expect(client.removeCustomerGroup).toHaveBeenCalledWith(KEY, '37');
    });

    it('código de más de 2 caracteres o vacío → 400', async () => {
      const { service } = make({ isAdmin: true, companyCodes: [] });
      await expect(
        service.addCustomerGroup(MGR, { ...KEY, customerGroupCode: 'ABC' }, ACTOR),
      ).rejects.toThrow(BadRequestException);
      await expect(service.removeCustomerGroup(MGR, KEY, ACTOR)).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.getGroupCustomers(MGR, { companyCode: '2100', customerGroupCode: 'ABC' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('el buscador de grupos sin sociedad → 400', async () => {
      const { service } = make({ isAdmin: true, companyCodes: [] });
      await expect(service.searchCustomerGroups(MGR, { q: 'T' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('los límites espejan al middleware (buscador 20/50, lista 50/200)', async () => {
      const { service, client } = make({ isAdmin: true, companyCodes: [] });
      await service.searchCustomerGroups(MGR, { companyCode: '2100' });
      await service.searchCustomerGroups(MGR, { companyCode: '2100', limit: '500' });
      expect(client.searchCustomerGroups).toHaveBeenNthCalledWith(1, '2100', '', 20);
      expect(client.searchCustomerGroups).toHaveBeenNthCalledWith(2, '2100', '', 50);
      await service.getGroupCustomers(MGR, {
        companyCode: '2100',
        customerGroupCode: 'T3',
        limit: '9999',
      });
      expect(client.getGroupCustomers).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 200, page: 1 }),
      );
    });
  });

  describe('auditoría', () => {
    it('reservar: audita WAREHOUSE_CUSTOMER_GROUP_ADD con almacén y grupo', async () => {
      const { service, client, audit } = make({ isAdmin: false, companyCodes: ['2100'] });
      await service.addCustomerGroup(MGR, { ...KEY, customerGroupCode: ' T3 ' }, ACTOR);
      expect(client.addCustomerGroup).toHaveBeenCalledWith(KEY, 'T3', {
        userEmail: 'usuario@x.com',
      });
      expect(audit.safeRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WAREHOUSE_CUSTOMER_GROUP_ADD',
          entity: 'Warehouse',
          entityId: '0001',
          category: AuditCategory.Warehouses,
          guidUsers: MGR,
          guidApiLoginClients: 'CLIENT-GUID',
          detail: expect.stringContaining('grupo=T3'),
        }),
      );
    });

    it('quitar la última reserva: audita el grupo y el estado disponible', async () => {
      const { service, audit } = make({ isAdmin: true, companyCodes: [] });
      const res = await service.removeCustomerGroup(
        MGR,
        { ...KEY, customerGroupCode: 'T3' },
        ACTOR,
      );
      expect(res).toEqual({ removed: true, stillRestricted: false });
      expect(audit.safeRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WAREHOUSE_CUSTOMER_GROUP_REMOVE',
          detail: expect.stringMatching(/grupo=T3.*estado=disponible/),
        }),
      );
    });

    it('si el middleware falla no se audita y el error sube tal cual (503 sin tabla)', async () => {
      const { service, client, audit } = make({ isAdmin: true, companyCodes: [] });
      client.addCustomerGroup.mockRejectedValueOnce(
        new ServiceUnavailableException(
          'La reserva por grupo todavía no está disponible en este entorno',
        ),
      );
      await expect(
        service.addCustomerGroup(MGR, { ...KEY, customerGroupCode: 'T3' }, ACTOR),
      ).rejects.toThrow(/no está disponible en este entorno/);
      expect(audit.safeRecord).not.toHaveBeenCalled();
    });
  });
});

/**
 * El orden de la lista de centros se resuelve server-side, así que el nombre de la columna
 * viaja como texto entre capas que viven separadas: la pantalla, esta whitelist, y
 * `CENTER_SORTS` del middleware, que es lo único que ordena de verdad.
 *
 * Si una capa suma una columna y otra no, **no hay error**: el valor cae al default y la tabla
 * se ordena por sociedad como si el click no hubiera existido. Es la peor forma de fallar:
 * silenciosa, y sólo se nota mirando los datos con atención.
 *
 * La costura contra la pantalla la agrega el paso 3 del traspaso, cuando exista el tipo del
 * front; acá se fija el número y el comportamiento de la whitelist.
 */
describe('columnas ordenables de centros', () => {
  it('son las 6 columnas de la tabla', () => {
    // El número es a propósito: si aparece una séptima, este test obliga a decidir a
    // conciencia si el middleware también la conoce.
    expect(CENTER_SORT_FIELDS).toHaveLength(6);
  });

  it('un sortBy inventado cae al default en vez de viajar al middleware', () => {
    expect(WarehousesService.toSortField('DROP TABLE Warehouses')).toBe('companyCode');
    expect(WarehousesService.toSortField(undefined)).toBe('companyCode');
    expect(WarehousesService.toSortField('centerName')).toBe('centerName');
  });
});
