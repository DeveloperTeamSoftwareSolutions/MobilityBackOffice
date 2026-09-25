import { BadRequestException } from '@nestjs/common';
import { ConsistencyService } from './consistency.service';
import { ConsistencyClient } from './consistency.client';
import { AuditService } from '../audit/audit.service';
import { AuditCategory } from '../audit/audit.categories';

const MEMBER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ACTOR = { email: 'admin@duwest.com', guid: 'u-1', guidApiLoginClients: 'c-1' };
const DECISION = { reason: 'Estaba con el id de otra sociedad', findingGroup: 'IDENTIDAD_MAL_APAREADA' as const };

function make() {
  const client = {
    createMember: jest.fn().mockResolvedValue({ guid: 'new-guid' }),
    changeMemberSapUserId: jest.fn().mockResolvedValue({ sapUserId: '2100185' }),
    removeMember: jest.fn().mockResolvedValue({ guid: MEMBER }),
    assignPortfolioOwner: jest.fn().mockResolvedValue({}),
  };
  const audit = { safeRecord: jest.fn().mockResolvedValue(undefined) };
  const service = new ConsistencyService(
    client as unknown as ConsistencyClient,
    audit as unknown as AuditService,
  );
  return { service, client, audit };
}

describe('ConsistencyService', () => {
  it('pasa al middleware el email del token y el motivo', async () => {
    const { service, client } = make();
    await service.changeMemberSapUserId(
      { guid: MEMBER, memberSapUserId: '2100185', expectedSapUserId: '2000033' },
      DECISION,
      ACTOR,
    );
    expect(client.changeMemberSapUserId).toHaveBeenCalledWith(
      { guid: MEMBER, memberSapUserId: '2100185', expectedSapUserId: '2000033' },
      { actorEmail: 'admin@duwest.com', reason: DECISION.reason, findingGroup: 'IDENTIDAD_MAL_APAREADA' },
    );
  });

  it('audita en AuditLogs con categoría Consistency, antes y después, hallazgo y motivo', async () => {
    const { service, audit } = make();
    await service.changeMemberSapUserId(
      { guid: MEMBER, memberSapUserId: '2100185', expectedSapUserId: '2000033' },
      DECISION,
      ACTOR,
    );
    expect(audit.safeRecord).toHaveBeenCalledWith({
      action: 'CONSISTENCY_MEMBER_SAPUSERID_CHANGED',
      entity: 'CommercialTeamMembers',
      entityId: MEMBER,
      category: AuditCategory.Consistency,
      guidUsers: 'u-1',
      guidApiLoginClients: 'c-1',
      actorEmail: 'admin@duwest.com',
      detail: 'antes=2000033 | despues=2100185 | hallazgo=IDENTIDAD_MAL_APAREADA | motivo=Estaba con el id de otra sociedad',
    });
  });

  it('el alta audita con el guid que devolvió el middleware', async () => {
    const { service, audit } = make();
    await service.createMember(
      { guidCommercialTeamHierarchies: 'n', memberSapUserId: '2100218', memberName: 'ANA', role: 'Vendedor', memberGuidUsers: null },
      { reason: 'Alta pendiente', findingGroup: null },
      ACTOR,
    );
    expect(audit.safeRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CONSISTENCY_MEMBER_CREATED', entityId: 'new-guid' }),
    );
  });

  it('sin email en la sesión no se corrige nada: no hay a quién atribuirlo', async () => {
    const { service, client, audit } = make();
    await expect(
      service.removeMember(MEMBER, DECISION, { guid: 'u-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(client.removeMember).not.toHaveBeenCalled();
    expect(audit.safeRecord).not.toHaveBeenCalled();
  });

  it('si el middleware rechaza la corrección, no se audita como hecha', async () => {
    const { service, client, audit } = make();
    client.removeMember.mockRejectedValue(new Error('409'));
    await expect(service.removeMember(MEMBER, DECISION, ACTOR)).rejects.toThrow('409');
    expect(audit.safeRecord).not.toHaveBeenCalled();
  });
});
