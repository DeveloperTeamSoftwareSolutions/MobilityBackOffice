import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BackOfficeRole } from '../auth/backoffice-role.enum';
import { TemplatesService } from './templates.service';
import {
  CreateTemplateInput,
  isSortableField,
  isTemplateStatus,
  NAME_PATTERN,
  OTP_EXPIRATION_MAX,
  OTP_EXPIRATION_MIN,
  SortableField,
  TemplateStatus,
  UpdateTemplateInput,
} from './templates.types';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 25;

function intInRange(value: string | undefined, fallback: number, max: number): number {
  const parsed = parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, parsed));
}

/**
 * Plantillas de WhatsApp.
 *
 * Las plantillas viven en el panel WABA y se consumen por su API REST. Es el criterio de
 * MobilityManager: se traen los DATOS y BackOffice arma su propia pantalla, en vez de
 * embeber la ajena.
 *
 * **Crear no es guardar.** Una plantilla se manda a META para aprobacion, y META decide.
 * Por eso `status` nunca se acepta como entrada, y editar una que esta en revision falla
 * con 409 — no es un error del servidor, es que ahora no se puede.
 *
 * La validacion de fondo (limites de META, variables secuenciales, tope de botones) la
 * hace WABA con el **mismo** validador que usa su asistente. Aca solo se corta lo que ni
 * siquiera vale la pena mandar.
 *
 * Rol `Marketing` (SuperAdmin pasa siempre; `Usuario` entra por su regla de exclusion).
 */
@Controller('api/templates')
@Roles(BackOfficeRole.Marketing)
@UseGuards(JwtGuard, RolesGuard)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  // GET /api/templates/status — si la seccion puede funcionar
  //
  // Va primero (ruta literal antes de `:name`) y existe para que el front distinga
  // "no hay plantillas" de "esto no esta configurado", que se ven igual en la pantalla.
  @Get('status')
  status(): { success: true; configured: boolean } {
    return { success: true, configured: this.templates.isConfigured() };
  }

  // GET /api/templates?page=&limit=&search=&sortBy=&sortDir=&status=
  @Get()
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('status') status?: string,
  ) {
    const requestedSort = (sortBy ?? '').trim();
    const requestedStatus = (status ?? '').trim().toUpperCase();

    const result = await this.templates.getAll({
      page: Math.max(1, parseInt(page ?? '', 10) || 1),
      limit: intInRange(limit, DEFAULT_LIMIT, MAX_LIMIT),
      search: (search ?? '').trim(),
      // Whitelist: lo que no este declarado cae al default en vez de viajar al sort.
      sortBy: isSortableField(requestedSort) ? (requestedSort as SortableField) : 'name',
      sortDir: sortDir === 'DESC' ? 'DESC' : 'ASC',
      status: isTemplateStatus(requestedStatus)
        ? (requestedStatus as TemplateStatus)
        : null,
    });

    return { success: true, ...result };
  }

  // POST /api/templates/sync — trae de META lo que cambio alla
  //
  // Va antes de las rutas con `:id`, si no `sync` entraria como identificador.
  @Post('sync')
  @HttpCode(200)
  async sync() {
    return { success: true, data: await this.templates.sync() };
  }

  // GET /api/templates/:id — detalle + si META permite editarla ahora
  @Get(':id')
  async byId(@Param('id') id: string) {
    const detail = await this.templates.getById(parseId(id));
    if (!detail) {
      throw new NotFoundException('Plantilla no encontrada');
    }
    return { success: true, ...detail };
  }

  // POST /api/templates — crear y enviar a META para aprobacion
  //
  // La validacion de fondo la hace WABA con el mismo validador que usa su asistente:
  // no hay dos criterios que puedan divergir. Aca solo se corta lo que ni siquiera
  // vale la pena mandar.
  @Post()
  async create(@Body() body: CreateTemplateInput) {
    requireText(body?.name, 'name');
    requireText(body?.language, 'language');
    requireText(body?.category, 'category');

    if (!NAME_PATTERN.test(body.name.trim())) {
      throw new BadRequestException(
        'El nombre solo admite minúsculas, números y guión bajo (sin espacios ni tildes)',
      );
    }

    const category = body.category.trim().toUpperCase();
    if (category === 'AUTHENTICATION') {
      // META escribe el texto de estas plantillas; lo que se configura es la validez
      // del código.
      const mins = body.codeExpirationMinutes;
      if (
        mins !== undefined &&
        mins !== null &&
        (!Number.isInteger(mins) || mins < OTP_EXPIRATION_MIN || mins > OTP_EXPIRATION_MAX)
      ) {
        throw new BadRequestException(
          `La validez del código debe estar entre ${OTP_EXPIRATION_MIN} y ${OTP_EXPIRATION_MAX} minutos`,
        );
      }
    } else {
      requireText(body?.bodyText, 'bodyText');
    }

    const template = await this.templates.create(body);
    return { success: true, data: template };
  }

  // PUT /api/templates/:id — editar y reenviar a META
  //
  // `name` e `language` NO se aceptan: META los toma como identidad de la plantilla.
  // Si llegan en el body, se ignoran en el service.
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: UpdateTemplateInput) {
    const template = await this.templates.update(parseId(id), body ?? {});
    if (!template) {
      throw new NotFoundException('Plantilla no encontrada');
    }
    return { success: true, data: template };
  }

  // DELETE /api/templates/:id — borra en META y local
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.templates.remove(parseId(id));
    return { success: true };
  }
}

/** Id numerico. Un id invalido es 400, no un 500 al llegar a WABA. */
function parseId(raw: string): number {
  const id = parseInt(raw ?? '', 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new BadRequestException('Identificador de plantilla inválido');
  }
  return id;
}

function requireText(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException(`${field} es obligatorio`);
  }
}
