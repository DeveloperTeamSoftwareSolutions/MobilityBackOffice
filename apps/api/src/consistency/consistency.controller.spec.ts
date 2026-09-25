import { BadRequestException } from '@nestjs/common';
import { ConsistencyController } from './consistency.controller';
import { ConsistencyService } from './consistency.service';
import { BackOfficeRole } from '../auth/backoffice-role.enum';
import { ROLES_KEY } from '../auth/roles.decorator';

const NODE = '11111111-2222-3333-4444-555555555555';
const MEMBER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const REQ = { user: { email: 'admin@duwest.com', guid: 'u-1', guidApiLoginClients: 'c-1' } };
const REASON = 'Alta pendiente segun reporte';

describe('ConsistencyController', () => {
  let service: jest.Mocked<
    Pick<
      ConsistencyService,
      | 'getSummary'
      | 'listFindings'
      | 'listNodes'
      | 'listCustomerGaps'
      | 'createMember'
      | 'changeMemberSapUserId'
      | 'removeMember'
      | 'assignPortfolioOwner'
    >
  >;
  let controller: ConsistencyController;

  beforeEach(() => {
    service = {
      getSummary: jest.fn().mockResolvedValue({ total: 0 }),
      listFindings: jest.fn().mockResolvedValue({ data: [], companies: [], generatedAt: 1, pagination: { total: 0, page: 1, limit: 50, totalPages: 1 } }),
      listNodes: jest.fn().mockResolvedValue({ data: [], roles: ['Vendedor'] }),
      listCustomerGaps: jest.fn().mockResolvedValue({ available: false, data: [], summary: {}, pagination: { total: 0, page: 1, limit: 50, totalPages: 1 } }),
      createMember: jest.fn().mockResolvedValue({ guid: 'new' }),
      changeMemberSapUserId: jest.fn().mockResolvedValue({}),
      removeMember: jest.fn().mockResolvedValue({}),
      assignPortfolioOwner: jest.fn().mockResolvedValue({}),
    };
    controller = new ConsistencyController(service as unknown as ConsistencyService);
  });

  it('es exclusivo de SuperAdmin', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ConsistencyController)).toEqual([BackOfficeRole.SuperAdmin]);
  });

  it('el listado acota el límite, descarta un orden fuera de la lista y pasa los filtros', async () => {
    await controller.findings('0', '9999', 'CARTERA_SIN_JERARQUIA', 'JERARQUIA', 'BACKOFFICE', '2100', '  ana  ', 'Id;DROP', 'sideways');
    expect(service.listFindings).toHaveBeenCalledWith({
      page: 1, limit: 200, group: 'CARTERA_SIN_JERARQUIA', category: 'JERARQUIA',
      resolution: 'BACKOFFICE', companyCode: '2100', search: 'ana',
      sortBy: 'severity', sortDir: 'ASC', exportAll: false, refresh: false,
    });
  });

  it('con export=1 el límite sube a 50.000', async () => {
    await controller.findings(undefined, '50000', undefined, undefined, undefined, undefined, undefined, 'personName', 'desc', '1');
    expect(service.listFindings).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50000, exportAll: true, sortBy: 'personName', sortDir: 'DESC' }),
    );
  });

  it.each([
    ['group', () => controller.findings(undefined, undefined, 'NADA')],
    ['category', () => controller.findings(undefined, undefined, undefined, 'NADA')],
    ['companyCode', () => controller.findings(undefined, undefined, undefined, undefined, undefined, "21'00")],
    ['gapType', () => controller.customerGaps(undefined, undefined, 'NADA')],
  ])('un %s inválido es 400', async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el actor sale del token, no del body', async () => {
    await controller.createMember(
      {
        guidCommercialTeamHierarchies: NODE, memberSapUserId: '2100218', memberName: ' ANA ',
        role: 'Vendedor', reason: REASON, findingGroup: 'CARTERA_SIN_JERARQUIA',
        actorEmail: 'otro@duwest.com',
      },
      REQ,
    );
    expect(service.createMember).toHaveBeenCalledWith(
      {
        guidCommercialTeamHierarchies: NODE, memberSapUserId: '2100218', memberName: 'ANA',
        role: 'Vendedor', memberGuidUsers: null,
      },
      { reason: REASON, findingGroup: 'CARTERA_SIN_JERARQUIA' },
      { email: 'admin@duwest.com', guid: 'u-1', guidApiLoginClients: 'c-1' },
    );
  });

  it('toda corrección exige motivo', async () => {
    await expect(controller.removeMember(MEMBER, { reason: 'x' }, REQ)).rejects.toThrow('motivo');
    await expect(controller.removeMember(MEMBER, undefined, REQ)).rejects.toBeInstanceOf(BadRequestException);
    expect(service.removeMember).not.toHaveBeenCalled();
  });

  it('valida GUIDs, usuario SAP y el hallazgo de origen', async () => {
    await expect(controller.removeMember('abc', { reason: REASON }, REQ)).rejects.toThrow('GUID');
    await expect(
      controller.createMember({ guidCommercialTeamHierarchies: NODE, memberSapUserId: '21 00', memberName: 'A', role: 'Vendedor', reason: REASON }, REQ),
    ).rejects.toThrow('usuario SAP');
    await expect(
      controller.removeMember(MEMBER, { reason: REASON, findingGroup: 'INVENTADO' }, REQ),
    ).rejects.toThrow('findingGroup');
  });

  it('corregir el usuario SAP exige el valor actual, y acepta null', async () => {
    await expect(
      controller.changeSapUserId(MEMBER, { memberSapUserId: '5200077', reason: REASON }, REQ),
    ).rejects.toThrow('expectedSapUserId');
    await controller.changeSapUserId(MEMBER, { memberSapUserId: '5200077', expectedSapUserId: null, reason: REASON }, REQ);
    expect(service.changeMemberSapUserId).toHaveBeenCalledWith(
      { guid: MEMBER, memberSapUserId: '5200077', expectedSapUserId: null },
      { reason: REASON, findingGroup: null },
      expect.objectContaining({ email: 'admin@duwest.com' }),
    );
  });

  it('asignar dueño valida el email opcional', async () => {
    await expect(
      controller.assignOwner(NODE, { ownerSapUserId: '3600777', ownerName: 'P', ownerEmail: 'no-es-mail', reason: REASON }, REQ),
    ).rejects.toThrow('email');
    await controller.assignOwner(NODE, { ownerSapUserId: '3600777', ownerName: 'P', reason: REASON }, REQ);
    expect(service.assignPortfolioOwner).toHaveBeenCalledWith(
      { guidPortfolio: NODE, ownerSapUserId: '3600777', ownerName: 'P', ownerGuidUsers: null, ownerEmail: null },
      { reason: REASON, findingGroup: null },
      expect.anything(),
    );
  });

  it('las brechas de clientes pasan tal cual, con available', async () => {
    const res = await controller.customerGaps(undefined, undefined, 'VE_SIN_CARTERA', '2900');
    expect(service.listCustomerGaps).toHaveBeenCalledWith(
      expect.objectContaining({ gapType: 'VE_SIN_CARTERA', companyCode: '2900', page: 1, limit: 50 }),
    );
    expect(res).toMatchObject({ success: true, available: false });
  });
});
