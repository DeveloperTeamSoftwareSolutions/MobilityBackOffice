import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BackOfficeRole } from '../auth/backoffice-role.enum';
import { actorFrom, AuthedRequest } from '../common/actor';
import { ConsistencyService, Decision } from './consistency.service';
import {
  CATEGORIES,
  Category,
  FINDING_SORTS,
  FindingSort,
  GAP_TYPES,
  GapType,
  GROUP_KEYS,
  GroupKey,
  RESOLUTIONS,
  Resolution,
} from './consistency.types';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAP_USER_RE = /^[A-Za-z0-9]{1,20}$/;
const COMPANY_RE = /^[A-Za-z0-9]{1,10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GAP_SORTS = ['userName', 'customerCode', 'customerName', 'companyCode', 'gapType'];

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const EXPORT_LIMIT = 50000;
const MIN_REASON = 5;
const MAX_REASON = 500;
const MAX_SEARCH = 100;

function flag(value?: string): boolean {
  return value === '1' || value === 'true';
}

function toInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = parseInt(value ?? '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], name: string): T | undefined {
  const v = (value ?? '').trim();
  if (!v) return undefined;
  if (!(allowed as readonly string[]).includes(v)) throw new BadRequestException(`${name} no es válido`);
  return v as T;
}

/**
 * Consistencia de datos — jerarquía comercial, carteras y usuarios que no cierran entre
 * sí, y su corrección.
 *
 * Exclusivo de SuperAdmin: corrige datos compartidos con MobilityManager y la app de
 * Mobility, sin el recorte por sociedad del resto de las secciones.
 *
 * Quien actúa sale del token; el cliente nunca manda un email de actor. Toda corrección
 * exige motivo. Roles de Mobility y datos de usuarios NO se corrigen acá: los administra
 * ITManager, y el middleware los devuelve marcados con `resolution = 'ITMANAGER'`.
 * Ver docs/SPEC_CONSISTENCIA_DE_DATOS.md.
 */
@Controller('api/consistency')
@Roles(BackOfficeRole.SuperAdmin)
@UseGuards(JwtGuard, RolesGuard)
export class ConsistencyController {
  constructor(private readonly service: ConsistencyService) {}

  // GET /api/consistency/summary — conteo por grupo y categoría
  @Get('summary')
  async summary(@Query('refresh') refresh?: string) {
    const data = await this.service.getSummary(flag(refresh));
    return { success: true, data };
  }

  // GET /api/consistency/findings — hallazgos paginados y filtrables
  @Get('findings')
  async findings(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('group') group?: string,
    @Query('category') category?: string,
    @Query('resolution') resolution?: string,
    @Query('companyCode') companyCode?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('export') exportAll?: string,
    @Query('refresh') refresh?: string,
  ) {
    const isExport = flag(exportAll);
    const result = await this.service.listFindings({
      page: toInt(page, 1, 1, Number.MAX_SAFE_INTEGER),
      limit: toInt(limit, DEFAULT_LIMIT, 1, isExport ? EXPORT_LIMIT : MAX_LIMIT),
      group: oneOf<GroupKey>(group, GROUP_KEYS, 'group'),
      category: oneOf<Category>(category, CATEGORIES, 'category'),
      resolution: oneOf<Resolution>(resolution, RESOLUTIONS, 'resolution'),
      companyCode: this.parseCompany(companyCode),
      search: text(search, MAX_SEARCH) || undefined,
      sortBy: (FINDING_SORTS as readonly string[]).includes(sortBy ?? '')
        ? (sortBy as FindingSort)
        : 'severity',
      sortDir: (sortDir ?? '').toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
      exportAll: isExport,
      refresh: flag(refresh),
    });
    return { success: true, ...result };
  }

  // GET /api/consistency/nodes — nodos de la jerarquía y roles válidos de miembro
  @Get('nodes')
  async nodes() {
    const result = await this.service.listNodes();
    return { success: true, ...result };
  }

  // GET /api/consistency/customer-gaps — clientes de cartera vs SAP (solo lectura)
  @Get('customer-gaps')
  async customerGaps(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('gapType') gapType?: string,
    @Query('companyCode') companyCode?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('export') exportAll?: string,
  ) {
    const isExport = flag(exportAll);
    const result = await this.service.listCustomerGaps({
      page: toInt(page, 1, 1, Number.MAX_SAFE_INTEGER),
      limit: toInt(limit, DEFAULT_LIMIT, 1, isExport ? EXPORT_LIMIT : MAX_LIMIT),
      gapType: oneOf<GapType>(gapType, GAP_TYPES, 'gapType'),
      companyCode: this.parseCompany(companyCode),
      search: text(search, MAX_SEARCH) || undefined,
      sortBy: GAP_SORTS.includes(sortBy ?? '') ? sortBy : undefined,
      sortDir: (sortDir ?? '').toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
      exportAll: isExport,
    });
    return { success: true, ...result };
  }

  // POST /api/consistency/members — alta de un miembro en un nodo de la jerarquía
  @Post('members')
  @HttpCode(201)
  async createMember(@Body() body: Record<string, unknown> | undefined, @Req() req: AuthedRequest) {
    const b = body ?? {};
    const memberName = text(b.memberName, 256);
    if (!memberName) throw new BadRequestException('El nombre del miembro es obligatorio');
    const role = text(b.role, 50);
    if (!role) throw new BadRequestException('El rol del miembro es obligatorio');
    const data = await this.service.createMember(
      {
        guidCommercialTeamHierarchies: this.parseGuid(b.guidCommercialTeamHierarchies, 'El nodo'),
        memberSapUserId: this.parseSapUser(b.memberSapUserId),
        memberName,
        role,
        memberGuidUsers: this.parseOptionalGuid(b.memberGuidUsers, 'El usuario'),
      },
      this.parseDecision(b),
      actorFrom(req),
    );
    return { success: true, data };
  }

  // PUT /api/consistency/members/:guid/sap-user-id — corrige el usuario SAP de un miembro
  @Put('members/:guid/sap-user-id')
  async changeSapUserId(
    @Param('guid') guid: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() req: AuthedRequest,
  ) {
    const b = body ?? {};
    if (!Object.prototype.hasOwnProperty.call(b, 'expectedSapUserId')) {
      throw new BadRequestException('Falta el usuario SAP actual del miembro (expectedSapUserId)');
    }
    const expected = b.expectedSapUserId === null ? null : text(b.expectedSapUserId, 100) || null;
    const data = await this.service.changeMemberSapUserId(
      {
        guid: this.parseGuid(guid, 'El miembro'),
        memberSapUserId: this.parseSapUser(b.memberSapUserId),
        expectedSapUserId: expected,
      },
      this.parseDecision(b),
      actorFrom(req),
    );
    return { success: true, data };
  }

  // POST /api/consistency/members/:guid/remove — baja de un miembro (soft delete)
  @Post('members/:guid/remove')
  @HttpCode(200)
  async removeMember(
    @Param('guid') guid: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() req: AuthedRequest,
  ) {
    const data = await this.service.removeMember(
      this.parseGuid(guid, 'El miembro'),
      this.parseDecision(body ?? {}),
      actorFrom(req),
    );
    return { success: true, data };
  }

  // POST /api/consistency/portfolios/:guid/owner — dueño comercial de una cartera sin dueño
  @Post('portfolios/:guid/owner')
  @HttpCode(201)
  async assignOwner(
    @Param('guid') guid: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() req: AuthedRequest,
  ) {
    const b = body ?? {};
    const ownerName = text(b.ownerName, 256);
    if (!ownerName) throw new BadRequestException('El nombre del dueño es obligatorio');
    const ownerEmail = text(b.ownerEmail, 320) || null;
    if (ownerEmail && !EMAIL_RE.test(ownerEmail)) {
      throw new BadRequestException('El email del dueño no es válido');
    }
    const data = await this.service.assignPortfolioOwner(
      {
        guidPortfolio: this.parseGuid(guid, 'La cartera'),
        ownerSapUserId: this.parseSapUser(b.ownerSapUserId),
        ownerName,
        ownerGuidUsers: this.parseOptionalGuid(b.ownerGuidUsers, 'El usuario'),
        ownerEmail,
      },
      this.parseDecision(b),
      actorFrom(req),
    );
    return { success: true, data };
  }

  private parseDecision(b: Record<string, unknown>): Decision {
    const reason = text(b.reason, MAX_REASON);
    if (reason.length < MIN_REASON) {
      throw new BadRequestException(
        `El motivo es obligatorio (entre ${MIN_REASON} y ${MAX_REASON} caracteres): queda en la auditoría`,
      );
    }
    const group = text(b.findingGroup, 64);
    if (group && !(GROUP_KEYS as readonly string[]).includes(group)) {
      throw new BadRequestException('findingGroup no es válido');
    }
    return { reason, findingGroup: (group || null) as GroupKey | null };
  }

  private parseGuid(value: unknown, name: string): string {
    const guid = text(value, 36);
    if (!GUID_RE.test(guid)) throw new BadRequestException(`${name} debe ser un GUID`);
    return guid;
  }

  private parseOptionalGuid(value: unknown, name: string): string | null {
    if (value === null || value === undefined || value === '') return null;
    return this.parseGuid(value, name);
  }

  private parseSapUser(value: unknown): string {
    const v = text(value, 20);
    if (!SAP_USER_RE.test(v)) {
      throw new BadRequestException('El usuario SAP es obligatorio (letras y números, hasta 20)');
    }
    return v;
  }

  private parseCompany(value?: string): string | undefined {
    const v = (value ?? '').trim();
    if (!v) return undefined;
    if (!COMPANY_RE.test(v)) throw new BadRequestException('companyCode no es válido');
    return v;
  }
}
