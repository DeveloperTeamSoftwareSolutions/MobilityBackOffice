import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
import { RevisionSapService } from './revision-sap.service';
import { isReviewSortField, isReviewView, ReviewView } from './revision-sap.types';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 20;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DESTINATION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CENTER_RE = /^[A-Za-z0-9]{1,8}$/;
const PRODUCT_RE = /^[A-Za-z0-9._-]{1,64}$/;
/** Mismo largo que `NoSaleReasons.Code` en el middleware. */
const REASON_CODE_RE = /^[A-Za-z0-9._-]{1,32}$/;
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
    @Query('view') view?: string,
  ) {
    const result = await this.service.listQueue({
      page: Math.max(1, parseInt(page ?? '', 10) || 1),
      limit: Math.min(MAX_LIMIT, Math.max(1, parseInt(limit ?? '', 10) || DEFAULT_LIMIT)),
      search: (search ?? '').trim().slice(0, 100),
      sortBy: isReviewSortField(sortBy ?? '') ? (sortBy as never) : 'sapLastAttemptAt',
      sortDir: sortDir === 'ASC' ? 'ASC' : 'DESC',
      // Una vista desconocida cae en pendientes, que es con lo que se entra.
      view: this.parseView(view),
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

  // PUT /api/revision-sap/orders/:guid/group-invoice
  //
  // Agrupa factura es de cabecera: cambia si la orden entera puede salir parcial, no
  // cómo sale una línea.
  @Put('orders/:guid/group-invoice')
  async changeGroupInvoice(
    @Param('guid') guid: string,
    @Body() body: { groupInvoice?: unknown; reasonNotes?: unknown } | undefined,
    @Req() req: AuthedRequest,
  ) {
    const orderGuid = this.parseGuid(guid, 'guid');
    if (typeof body?.groupInvoice !== 'boolean') {
      throw new BadRequestException('groupInvoice debe ser true o false');
    }
    const data = await this.service.changeGroupInvoice(
      orderGuid,
      body.groupInvoice,
      this.parseReason(body?.reasonNotes),
      actorFrom(req),
    );
    return { success: true, data };
  }

  // POST /api/revision-sap/orders/:guid/reject
  //
  // Rechaza la orden. Es TERMINAL: vuelve al vendedor como "Rechazada", sale de la
  // bandeja y no se deshace.
  //
  // El motivo es OBLIGATORIO y se valida acá además del middleware: el estado sólo
  // dice "Rechazada", así que el comentario del hilo es lo único que el vendedor va a
  // poder leer. Sin motivo, la orden se cerraría en silencio.
  @Post('orders/:guid/reject')
  async reject(
    @Param('guid') guid: string,
    @Body() body: { reasonNotes?: unknown } | undefined,
    @Req() req: AuthedRequest,
  ) {
    const orderGuid = this.parseGuid(guid, 'guid');
    const reasonNotes = this.parseReason(body?.reasonNotes);
    if (!reasonNotes) {
      throw new BadRequestException(
        'El motivo es obligatorio: es lo único que el vendedor va a leer sobre el rechazo',
      );
    }
    const data = await this.service.rejectOrder(orderGuid, reasonNotes, actorFrom(req));
    return { success: true, data };
  }

  // POST /api/revision-sap/orders/:guid/items/:itemGuid/cancel
  //
  // Cancela una línea con motivo de no venta: deja de viajar a SAP, pero sigue viéndose
  // con su motivo.
  //
  // Es POST y no PUT porque no edita un campo de la línea: estampa un hecho. El motivo
  // es OBLIGATORIO y del catálogo —acá sólo se valida la FORMA del código; que exista y
  // esté activo lo decide el middleware, que es dueño del catálogo.
  @Post('orders/:guid/items/:itemGuid/cancel')
  async cancelItem(
    @Param('guid') guid: string,
    @Param('itemGuid') itemGuid: string,
    @Body() body: { reasonCode?: unknown; reasonNotes?: unknown } | undefined,
    @Req() req: AuthedRequest,
  ) {
    const orderGuid = this.parseGuid(guid, 'guid');
    const lineGuid = this.parseGuid(itemGuid, 'itemGuid');
    const reasonCode = this.parseCode(
      body?.reasonCode,
      REASON_CODE_RE,
      'reasonCode es obligatorio: el motivo de no venta sale del catálogo',
    );
    const data = await this.service.cancelItem(
      orderGuid,
      lineGuid,
      reasonCode,
      this.parseReason(body?.reasonNotes),
      actorFrom(req),
    );
    return { success: true, data };
  }

  // POST /api/revision-sap/orders/:guid/items/:itemGuid/reactivate
  //
  // Deshace la cancelación. Sin body: no hay nada que elegir, y quién lo hace sale del
  // token. El middleware lo frena si hubo un envío posterior a la cancelación.
  @Post('orders/:guid/items/:itemGuid/reactivate')
  async reactivateItem(
    @Param('guid') guid: string,
    @Param('itemGuid') itemGuid: string,
    @Req() req: AuthedRequest,
  ) {
    const data = await this.service.reactivateItem(
      this.parseGuid(guid, 'guid'),
      this.parseGuid(itemGuid, 'itemGuid'),
      actorFrom(req),
    );
    return { success: true, data };
  }

  // GET /api/revision-sap/no-sale-reasons
  //
  // Catálogo de motivos de no venta, sólo los activos. Es el MISMO que usa MobilityIA:
  // el código es lo que hace comparables los motivos entre órdenes.
  @Get('no-sale-reasons')
  async noSaleReasons() {
    const data = await this.service.listNoSaleReasons();
    return { success: true, data };
  }

  // POST /api/revision-sap/orders/:guid/resend
  //
  // Reenvía la orden COMPLETA a SAP. Sin body: qué se manda lo decide el servidor con
  // lo que está guardado, y quién lo manda sale del token. Las líneas canceladas no
  // viajan: las excluye el middleware al armar el envío.
  @Post('orders/:guid/resend')
  async resend(@Param('guid') guid: string, @Req() req: AuthedRequest) {
    const data = await this.service.resendToSap(this.parseGuid(guid, 'guid'), actorFrom(req));
    return { success: true, data };
  }

  /**
   * Qué bandeja se pide. Una vista desconocida cae en `pending` en vez de fallar: es la
   * que se abre por defecto. El narrowing va sobre la variable ya normalizada — sobre
   * `view ?? ''` no alcanza, porque `view` sigue siendo `string | undefined`.
   */
  private parseView(value: string | undefined): ReviewView {
    const view = (value ?? '').trim();
    return isReviewView(view) ? view : 'pending';
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
