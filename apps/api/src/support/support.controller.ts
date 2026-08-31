import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BackOfficeRole } from '../auth/backoffice-role.enum';
import { SupportService } from './support.service';
import { actorFrom, AuthedRequest } from '../common/actor';
import {
  DocumentType,
  isDocumentType,
  ITEM_DECISIONS,
  ITEM_RESPONSES,
  ItemDecision,
  ItemResponse,
  PAYMENT_DECISIONS,
  PAYMENT_RESPONSES,
  PaymentDecision,
  PaymentResponse,
  SORTABLE_FIELDS,
} from './support.types';

/** Tope de filas por pagina. El cliente puede pedir menos, nunca mas. */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 20;


/** `'1'` y `'true'` cuentan como verdadero; cualquier otra cosa es falso. */
function flag(value?: string): boolean {
  return value === '1' || value === 'true';
}

/**
 * Consola de soporte — auditoria de ordenes y cotizaciones del flujo Mobility.
 *
 * El modulo entero exige rol `Soporte` (SuperAdmin pasa siempre por el `RolesGuard`).
 * Es el rol exclusivo del DevelopersTeam: da acceso a la trazabilidad completa de
 * cualquier documento, sin el scope de vendedor que limita al resto del ecosistema.
 *
 * Lecturas: listado paginado, cabecera y linea de tiempo de cualquier documento.
 * Escritura: UNA sola, el override de estado, que salta la maquina de estados y exige
 * motivo. Las banderas de control (items, pago, credito) llegan en la fase 3.
 *
 * El listado sale de un router propio del middleware (`/mobility/support`): todos sus
 * listados existentes estan scopeados por vendedor o cliente y a soporte le devuelven
 * vacio. Ver docs/SPEC_CONSOLA_SOPORTE.md.
 */
@Controller('api/support')
@Roles(BackOfficeRole.Soporte)
@UseGuards(JwtGuard, RolesGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  // GET /api/support/documents — listado paginado
  //
  // Va declarada ANTES que `documents/:type/:number`: son distinta cantidad de
  // segmentos, asi que hoy no compiten, pero mantener las literales arriba es la
  // convencion del repo y evita sorpresas si se agrega una ruta con comodin.
  @Get('documents')
  async list(
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ) {
    const result = await this.support.listDocuments({
      type: this.parseType(type ?? 'order'),
      page: Math.max(1, parseInt(page ?? '', 10) || 1),
      limit: Math.min(
        MAX_LIMIT,
        Math.max(1, parseInt(limit ?? '', 10) || DEFAULT_LIMIT),
      ),
      search: (search ?? '').trim(),
      status: (status ?? '').trim(),
      sortBy: SORTABLE_FIELDS.includes(sortBy ?? '')
        ? (sortBy as string)
        : 'documentDate',
      sortDir: sortDir === 'ASC' ? 'ASC' : 'DESC',
    });
    return { success: true, ...result };
  }

  // GET /api/support/statuses — estados existentes, para el filtro
  @Get('statuses')
  async statuses(@Query('type') type?: string) {
    const data = await this.support.listStatuses(this.parseType(type ?? 'order'));
    return { success: true, data };
  }

  // GET /api/support/diagnostics/inconsistent — documentos con el estado desfasado
  //
  // Ruta literal: va antes que las de `documents/:type/...` por convencion del repo.
  @Get('diagnostics/inconsistent')
  async inconsistent(
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.support.listInconsistent(
      this.parseType(type ?? 'order'),
      Math.min(2000, Math.max(1, parseInt(limit ?? '', 10) || 500)),
    );
    return { success: true, ...result };
  }

  // GET /api/support/documents/:type/:number — cabecera del documento
  @Get('documents/:type/:number')
  async getDocument(
    @Param('type') type: string,
    @Param('number') documentNumber: string,
  ) {
    const data = await this.support.getDocument({
      type: this.parseType(type),
      number: this.parseNumber(documentNumber),
    });
    return { success: true, data };
  }

  // GET /api/support/documents/:type/:number/timeline — bitacora completa
  @Get('documents/:type/:number/timeline')
  async getTimeline(
    @Param('type') type: string,
    @Param('number') documentNumber: string,
    @Query('includeViews') includeViews?: string,
    @Query('includeMessages') includeMessages?: string,
  ) {
    const data = await this.support.getTimeline({
      type: this.parseType(type),
      number: this.parseNumber(documentNumber),
      includeViews: flag(includeViews),
      includeMessages: flag(includeMessages),
    });
    return { success: true, data };
  }

  // GET /api/support/documents/:type/:guid/projected-status
  //
  // Que estado daria el recalculo hoy. Solo lectura: el modal de forzar estado lo usa
  // para avisar si el estado elegido se va a sostener o lo van a revertir.
  @Get('documents/:type/:guid/projected-status')
  async projectedStatus(
    @Param('type') type: string,
    @Param('guid') guid: string,
  ) {
    const data = await this.support.getProjectedStatus(
      this.parseType(type),
      this.parseGuid(guid),
    );
    return { success: true, data };
  }

  // GET /api/support/documents/:type/:guid/actions — acciones con intencion
  @Get('documents/:type/:guid/actions')
  async actions(@Param('type') type: string, @Param('guid') guid: string) {
    const data = await this.support.listActions(
      this.parseType(type),
      this.parseGuid(guid),
    );
    return { success: true, data };
  }

  // POST /api/support/documents/:type/:guid/actions/:action
  //
  // Escribe HECHOS y recalcula. Nunca escribe el estado a mano, asi que no puede
  // producir un estado inalcanzable — a diferencia del override de cabecera.
  @Post('documents/:type/:guid/actions/:action')
  async runAction(
    @Param('type') type: string,
    @Param('guid') guid: string,
    @Param('action') action: string,
    @Body() body: { reasonNotes?: string; target?: string },
    @Req() req: AuthedRequest,
  ) {
    const reasonNotes = (body?.reasonNotes ?? '').trim();
    if (!reasonNotes) {
      throw new BadRequestException('El motivo es obligatorio');
    }
    // El destino de una vuelta atrás viaja en el body: no todas las acciones lo
    // llevan. Si no se reenvía, el middleware busca `revert_to` con destino nulo,
    // no encuentra ninguna y rechaza con "No se puede volver a 'null'".
    const target = (body?.target ?? '').trim();
    const data = await this.support.runAction(
      this.parseType(type),
      this.parseGuid(guid),
      (action ?? '').trim(),
      reasonNotes,
      actorFrom(req),
      target || null,
    );
    return { success: true, data };
  }

  // GET /api/support/documents/:type/:guid/items — lineas + turno del gerente
  @Get('documents/:type/:guid/items')
  async items(@Param('type') type: string, @Param('guid') guid: string) {
    const data = await this.support.listItems(
      this.parseType(type),
      this.parseGuid(guid),
    );
    return { success: true, data };
  }

  /**
   * Motivo obligatorio en las cuatro decisiones.
   *
   * El flujo solo lo exige al rechazar. Acá se pide siempre porque soporte actúa a
   * pedido de un tercero: sin el motivo, la decisión queda registrada a nombre de
   * soporte y sin rastro de quién la pidió ni por qué, que es justo lo que hace
   * falta cuando alguien pregunta seis meses después.
   */
  private parseMotivo(body?: { reasonNotes?: string }): string {
    const reasonNotes = (body?.reasonNotes ?? '').trim();
    if (!reasonNotes) {
      throw new BadRequestException(
        'El motivo es obligatorio: indicá quién pidió el cambio y por qué',
      );
    }
    return reasonNotes;
  }

  /** El código de producto identifica la línea. Vacío no identifica nada. */
  private parseProducto(productCode: string): string {
    const code = (productCode ?? '').trim();
    if (!code) throw new BadRequestException('Falta el código de producto');
    return code;
  }

  // POST /api/support/documents/:type/:guid/items/:productCode/decide
  //
  // Decisión del gerente sobre una línea, ejecutada por soporte a su pedido. Precio,
  // cantidad y producto no se leen del body: `proposedPrice` es el precio UNITARIO
  // que se contraoferta, no una edición de la línea.
  @Post('documents/:type/:guid/items/:productCode/decide')
  async decideItem(
    @Param('type') type: string,
    @Param('guid') guid: string,
    @Param('productCode') productCode: string,
    @Body() body: { status?: string; proposedPrice?: number | string; reasonNotes?: string },
    @Req() req: AuthedRequest,
  ) {
    const reasonNotes = this.parseMotivo(body);
    const status = (body?.status ?? '').trim() as ItemDecision;
    if (!ITEM_DECISIONS.includes(status)) {
      throw new BadRequestException(
        `Decisión inválida. Permitidas: ${ITEM_DECISIONS.join(', ')}`,
      );
    }

    // La contraoferta sin precio dejaría al vendedor viendo una propuesta vacía. Se
    // valida acá además del middleware para que el rechazo no viaje.
    let proposedPrice: number | null = null;
    if (status === 'countered') {
      proposedPrice = Number(body?.proposedPrice);
      if (!Number.isFinite(proposedPrice) || proposedPrice <= 0) {
        throw new BadRequestException(
          'Para contraofertar hay que indicar un precio propuesto mayor a cero',
        );
      }
    }

    const who = actorFrom(req);
    const data = await this.support.decideItem(
      {
        type: this.parseType(type),
        guid: this.parseGuid(guid),
        productCode: this.parseProducto(productCode),
        status,
        proposedPrice,
        reasonNotes,
        actorEmail: who.email ?? null,
      },
      who,
    );
    return { success: true, data };
  }

  // POST /api/support/documents/:type/:guid/items/:productCode/respond
  //
  // Respuesta del vendedor a una contraoferta de línea. La ronda es UNA: si el
  // vendedor ya respondió, el middleware rechaza y no se reabre.
  @Post('documents/:type/:guid/items/:productCode/respond')
  async respondItem(
    @Param('type') type: string,
    @Param('guid') guid: string,
    @Param('productCode') productCode: string,
    @Body() body: { action?: string; reasonNotes?: string },
    @Req() req: AuthedRequest,
  ) {
    const reasonNotes = this.parseMotivo(body);
    const action = (body?.action ?? '').trim() as ItemResponse;
    if (!ITEM_RESPONSES.includes(action)) {
      throw new BadRequestException(
        `Respuesta inválida. Permitidas: ${ITEM_RESPONSES.join(', ')}`,
      );
    }

    const who = actorFrom(req);
    const data = await this.support.respondItem(
      {
        type: this.parseType(type),
        guid: this.parseGuid(guid),
        productCode: this.parseProducto(productCode),
        action,
        reasonNotes,
        actorEmail: who.email ?? null,
      },
      who,
    );
    return { success: true, data };
  }

  // POST /api/support/documents/:type/:guid/payment-terms/decide
  //
  // Decisión del gerente sobre el plazo de pago pedido en la cabecera. `observed` ES
  // la contraoferta y viaja con el plazo propuesto en `value`.
  @Post('documents/:type/:guid/payment-terms/decide')
  async decidePaymentTerms(
    @Param('type') type: string,
    @Param('guid') guid: string,
    @Body() body: { status?: string; value?: string; reasonNotes?: string },
    @Req() req: AuthedRequest,
  ) {
    const reasonNotes = this.parseMotivo(body);
    const status = (body?.status ?? '').trim() as PaymentDecision;
    if (!PAYMENT_DECISIONS.includes(status)) {
      throw new BadRequestException(
        `Decisión inválida. Permitidas: ${PAYMENT_DECISIONS.join(', ')}`,
      );
    }

    const value = (body?.value ?? '').trim();
    if (status === 'observed' && !value) {
      throw new BadRequestException(
        'Para contraofertar el plazo de pago hay que indicar el plazo propuesto',
      );
    }

    const who = actorFrom(req);
    const data = await this.support.decidePaymentTerms(
      {
        type: this.parseType(type),
        guid: this.parseGuid(guid),
        status,
        value: value || null,
        reasonNotes,
        actorEmail: who.email ?? null,
      },
      who,
    );
    return { success: true, data };
  }

  // POST /api/support/documents/:type/:guid/payment-terms/respond
  //
  // Respuesta del vendedor a la contraoferta de plazo de pago. El middleware exige
  // que el gerente haya cerrado su turno antes.
  @Post('documents/:type/:guid/payment-terms/respond')
  async respondPaymentTerms(
    @Param('type') type: string,
    @Param('guid') guid: string,
    @Body() body: { action?: string; reasonNotes?: string },
    @Req() req: AuthedRequest,
  ) {
    const reasonNotes = this.parseMotivo(body);
    const action = (body?.action ?? '').trim() as PaymentResponse;
    if (!PAYMENT_RESPONSES.includes(action)) {
      throw new BadRequestException(
        `Respuesta inválida. Permitidas: ${PAYMENT_RESPONSES.join(', ')}`,
      );
    }

    const who = actorFrom(req);
    const data = await this.support.respondPaymentTerms(
      {
        type: this.parseType(type),
        guid: this.parseGuid(guid),
        action,
        reasonNotes,
        actorEmail: who.email ?? null,
      },
      who,
    );
    return { success: true, data };
  }

  // POST /api/support/documents/:type/:guid/recompute — recalcula desde los hechos
  @Post('documents/:type/:guid/recompute')
  async recompute(
    @Param('type') type: string,
    @Param('guid') guid: string,
    @Req() req: AuthedRequest,
  ) {
    const data = await this.support.recompute(
      this.parseType(type),
      this.parseGuid(guid),
      actorFrom(req),
    );
    return { success: true, data };
  }

  /** Valida el tipo antes de llegar al middleware, para devolver un 400 claro. */
  private parseType(value: string): DocumentType {
    const type = (value ?? '').trim().toLowerCase();
    if (!isDocumentType(type)) {
      throw new BadRequestException("type debe ser 'order' o 'quote'");
    }
    return type;
  }

  private parseNumber(value: string): string {
    const documentNumber = (value ?? '').trim();
    if (!documentNumber) {
      throw new BadRequestException('El número de documento es obligatorio');
    }
    return documentNumber;
  }

  private parseGuid(value: string): string {
    const guid = (value ?? '').trim();
    if (!guid) {
      throw new BadRequestException('El guid del documento es obligatorio');
    }
    return guid;
  }
}
