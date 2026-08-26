import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BackOfficeRole } from '../auth/backoffice-role.enum';
import { SupportService, Actor } from './support.service';
import {
  DocumentType,
  isDocumentType,
  SORTABLE_FIELDS,
} from './support.types';

/** Tope de filas por pagina. El cliente puede pedir menos, nunca mas. */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 20;

interface AuthedRequest {
  user?: { email?: string; guid?: string; sub?: string };
}

/** Actor (identidad del logueado) para la traza de auditoria. */
function actor(req: AuthedRequest): Actor {
  return { email: req.user?.email, guid: req.user?.guid ?? req.user?.sub };
}

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

  // GET /api/support/vocabulary — estados VALIDOS del tipo, para el override
  @Get('vocabulary')
  async vocabulary(@Query('type') type?: string) {
    const data = await this.support.getVocabulary(this.parseType(type ?? 'order'));
    return { success: true, data };
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

  // PATCH /api/support/documents/:type/:guid/status — OVERRIDE de estado
  //
  // Única escritura del módulo. Fuerza el estado saltando la máquina de estados y
  // el scope de vendedor. El motivo es obligatorio y queda tanto en la línea de
  // tiempo del documento como en `AuditLogs`.
  @Patch('documents/:type/:guid/status')
  async overrideStatus(
    @Param('type') type: string,
    @Param('guid') guid: string,
    @Body()
    body: { toCode?: string; reasonCode?: string; reasonNotes?: string },
    @Req() req: AuthedRequest,
  ) {
    const toCode = (body?.toCode ?? '').trim();
    const reasonNotes = (body?.reasonNotes ?? '').trim();

    if (!toCode) {
      throw new BadRequestException('toCode es obligatorio');
    }
    // El motivo se exige acá además del middleware: es la regla de negocio de esta
    // consola (nada se fuerza sin justificación) y así el error llega sin viajar.
    if (!reasonNotes) {
      throw new BadRequestException('El motivo es obligatorio');
    }

    const who = actor(req);
    const data = await this.support.overrideStatus(
      {
        type: this.parseType(type),
        guid: this.parseGuid(guid),
        toCode,
        reasonCode: (body?.reasonCode ?? '').trim() || null,
        reasonNotes,
        actorEmail: who.email ?? null,
      },
      who,
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
