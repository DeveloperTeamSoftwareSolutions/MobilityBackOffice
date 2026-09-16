import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
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
import { RevisionSapService } from './revision-sap.service';
import { isReviewSortField } from './revision-sap.types';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 20;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DESTINATION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CENTER_RE = /^[A-Za-z0-9]{1,8}$/;
const PRODUCT_RE = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_REASON = 500;

/**
 * Órdenes rechazadas por SAP.
 *
 * Exige rol `RevisionSap` (SuperAdmin pasa siempre por el `RolesGuard`). `Usuario` no
 * entra: reasignar y reenviar órdenes se le da a quien hace esa tarea.
 * Ver docs/SPEC_REVISION_ORDENES_SAP.md.
 */
@Controller('api/revision-sap')
@Roles(BackOfficeRole.RevisionSap)
@UseGuards(JwtGuard, RolesGuard)
export class RevisionSapController {
  constructor(private readonly service: RevisionSapService) {}

  // GET /api/revision-sap/orders — bandeja
  @Get('orders')
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ) {
    const result = await this.service.listQueue({
      page: Math.max(1, parseInt(page ?? '', 10) || 1),
      limit: Math.min(MAX_LIMIT, Math.max(1, parseInt(limit ?? '', 10) || DEFAULT_LIMIT)),
      search: (search ?? '').trim().slice(0, 100),
      sortBy: isReviewSortField(sortBy ?? '') ? (sortBy as never) : 'sapLastAttemptAt',
      sortDir: sortDir === 'ASC' ? 'ASC' : 'DESC',
    });
    return { success: true, ...result };
  }

  // GET /api/revision-sap/orders/:guid — detalle sin precios
  @Get('orders/:guid')
  async getOrder(@Param('guid') guid: string) {
    const data = await this.service.getOrder(this.parseGuid(guid, 'guid'));
    return { success: true, data };
  }

  // GET /api/revision-sap/orders/:guid/options — centros, destinos y stock
  @Get('orders/:guid/options')
  async options(
    @Param('guid') guid: string,
    @Query('includeStock') includeStock?: string,
  ) {
    const withStock = includeStock === '1' || includeStock === 'true';
    const data = await this.service.getOptions(this.parseGuid(guid, 'guid'), withStock);
    return { success: true, data };
  }

  // GET /api/revision-sap/orders/:guid/sap-orders — órdenes SAP de la orden
  @Get('orders/:guid/sap-orders')
  async sapOrders(@Param('guid') guid: string) {
    const data = await this.service.listSapOrders(this.parseGuid(guid, 'guid'));
    return { success: true, data };
  }

  // GET /api/revision-sap/orders/:guid/stock/:productCode — stock por centro y almacén
  @Get('orders/:guid/stock/:productCode')
  async productStock(
    @Param('guid') guid: string,
    @Param('productCode') productCode: string,
  ) {
    const data = await this.service.getProductStock(
      this.parseGuid(guid, 'guid'),
      this.parseCode(productCode, PRODUCT_RE, 'productCode inválido'),
    );
    return { success: true, data };
  }

  // PUT /api/revision-sap/orders/:guid/items/:itemGuid/destination
  //
  // Quién hace el cambio sale del token, nunca del body.
  @Put('orders/:guid/items/:itemGuid/destination')
  async changeDestination(
    @Param('guid') guid: string,
    @Param('itemGuid') itemGuid: string,
    @Body() body: { destinationCode?: unknown; reasonNotes?: unknown } | undefined,
    @Req() req: AuthedRequest,
  ) {
    const orderGuid = this.parseGuid(guid, 'guid');
    const lineGuid = this.parseGuid(itemGuid, 'itemGuid');
    const destinationCode = this.parseCode(
      body?.destinationCode,
      DESTINATION_RE,
      'destinationCode es obligatorio (alfanumérico, hasta 64)',
    );
    const data = await this.service.changeItemDestination(
      orderGuid,
      lineGuid,
      destinationCode,
      this.parseReason(body?.reasonNotes),
      actorFrom(req),
    );
    return { success: true, data };
  }

  // PUT /api/revision-sap/orders/:guid/items/:itemGuid/center
  @Put('orders/:guid/items/:itemGuid/center')
  async changeCenter(
    @Param('guid') guid: string,
    @Param('itemGuid') itemGuid: string,
    @Body() body: { centerCode?: unknown; reasonNotes?: unknown } | undefined,
    @Req() req: AuthedRequest,
  ) {
    const orderGuid = this.parseGuid(guid, 'guid');
    const lineGuid = this.parseGuid(itemGuid, 'itemGuid');
    const centerCode = this.parseCode(
      body?.centerCode,
      CENTER_RE,
      'centerCode es obligatorio (alfanumérico, hasta 8)',
    );
    const data = await this.service.changeItemCenter(
      orderGuid,
      lineGuid,
      centerCode,
      this.parseReason(body?.reasonNotes),
      actorFrom(req),
    );
    return { success: true, data };
  }

  private parseCode(value: unknown, pattern: RegExp, message: string): string {
    const code = typeof value === 'string' ? value.trim() : '';
    if (!pattern.test(code)) throw new BadRequestException(message);
    return code;
  }

  private parseReason(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value !== 'string') throw new BadRequestException('reasonNotes debe ser texto');
    return value.trim().slice(0, MAX_REASON) || null;
  }

  private parseGuid(value: string, name: string): string {
    const guid = (value ?? '').trim();
    if (!GUID_RE.test(guid)) throw new BadRequestException(`${name} debe ser un GUID`);
    return guid;
  }
}
