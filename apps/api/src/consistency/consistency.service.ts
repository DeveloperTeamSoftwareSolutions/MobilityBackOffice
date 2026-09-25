import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuditCategory } from '../audit/audit.categories';
import { Actor } from '../common/actor';
import { ConsistencyClient } from './consistency.client';
import {
  AssignOwnerInput,
  ChangeSapUserIdInput,
  ConsistencySummary,
  CreateMemberInput,
  CustomerGapsPage,
  CustomerGapsQuery,
  FindingsPage,
  FindingsQuery,
  GroupKey,
  NodesResult,
  WriteContext,
  WriteResult,
} from './consistency.types';

/** Lo que el controlador ya valido: motivo y hallazgo de origen. */
export interface Decision {
  reason: string;
  findingGroup: GroupKey | null;
}

/**
 * Consistencia de datos comerciales.
 *
 * Las reglas y las escrituras viven en el middleware (una sola fuente para BackOffice y
 * para cualquier otra app). Aca se agrega lo que es de BackOffice: quien actua sale del
 * token y NUNCA del cliente, y cada correccion queda tambien en `AuditLogs`, la
 * auditoria central que se consulta desde ITManager.
 *
 * El middleware ya audita cada correccion en `Auditories` dentro de su transaccion; la
 * fila de `AuditLogs` es best-effort (`safeRecord`): el cambio ya ocurrio y un fallo de
 * la auditoria central no debe informarlo como fallido.
 */
@Injectable()
export class ConsistencyService {
  constructor(
    private readonly client: ConsistencyClient,
    private readonly audit: AuditService,
  ) {}

  getSummary(refresh: boolean): Promise<ConsistencySummary> {
    return this.client.getSummary(refresh);
  }

  listFindings(query: FindingsQuery): Promise<FindingsPage> {
    return this.client.listFindings(query);
  }

  listNodes(): Promise<NodesResult> {
    return this.client.listNodes();
  }

  listCustomerGaps(query: CustomerGapsQuery): Promise<CustomerGapsPage> {
    return this.client.listCustomerGaps(query);
  }

  async createMember(
    input: CreateMemberInput,
    decision: Decision,
    actor: Actor,
  ): Promise<WriteResult> {
    const ctx = this.context(decision, actor);
    const result = await this.client.createMember(input, ctx);
    await this.record(actor, ctx, {
      action: 'CONSISTENCY_MEMBER_CREATED',
      entity: 'CommercialTeamMembers',
      entityId: stringOf(result.guid),
      detail: [
        `sapUserId=${input.memberSapUserId}`,
        `nombre=${input.memberName}`,
        `rol=${input.role}`,
        `nodo=${input.guidCommercialTeamHierarchies}`,
      ],
    });
    return result;
  }

  async changeMemberSapUserId(
    input: ChangeSapUserIdInput,
    decision: Decision,
    actor: Actor,
  ): Promise<WriteResult> {
    const ctx = this.context(decision, actor);
    const result = await this.client.changeMemberSapUserId(input, ctx);
    await this.record(actor, ctx, {
      action: 'CONSISTENCY_MEMBER_SAPUSERID_CHANGED',
      entity: 'CommercialTeamMembers',
      entityId: input.guid,
      detail: [`antes=${input.expectedSapUserId ?? '(sin id)'}`, `despues=${input.memberSapUserId}`],
    });
    return result;
  }

  async removeMember(guid: string, decision: Decision, actor: Actor): Promise<WriteResult> {
    const ctx = this.context(decision, actor);
    const result = await this.client.removeMember(guid, ctx);
    await this.record(actor, ctx, {
      action: 'CONSISTENCY_MEMBER_REMOVED',
      entity: 'CommercialTeamMembers',
      entityId: guid,
      detail: [],
    });
    return result;
  }

  async assignPortfolioOwner(
    input: AssignOwnerInput,
    decision: Decision,
    actor: Actor,
  ): Promise<WriteResult> {
    const ctx = this.context(decision, actor);
    const result = await this.client.assignPortfolioOwner(input, ctx);
    await this.record(actor, ctx, {
      action: 'CONSISTENCY_PORTFOLIO_OWNER_ASSIGNED',
      entity: 'Portfolios',
      entityId: input.guidPortfolio,
      detail: [`sapUserId=${input.ownerSapUserId}`, `dueno=${input.ownerName}`],
    });
    return result;
  }

  private context(decision: Decision, actor: Actor): WriteContext {
    if (!actor.email) {
      throw new BadRequestException('La sesión no tiene email: no se puede atribuir el cambio');
    }
    return { actorEmail: actor.email, reason: decision.reason, findingGroup: decision.findingGroup };
  }

  private async record(
    actor: Actor,
    ctx: WriteContext,
    entry: { action: string; entity: string; entityId: string | null; detail: string[] },
  ): Promise<void> {
    await this.audit.safeRecord({
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      category: AuditCategory.Consistency,
      guidUsers: actor.guid ?? null,
      guidApiLoginClients: actor.guidApiLoginClients ?? null,
      actorEmail: ctx.actorEmail,
      detail: [
        ...entry.detail,
        ...(ctx.findingGroup ? [`hallazgo=${ctx.findingGroup}`] : []),
        `motivo=${ctx.reason}`,
      ].join(' | '),
    });
  }
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}
