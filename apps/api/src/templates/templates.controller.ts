import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BackOfficeRole } from '../auth/backoffice-role.enum';
import { TemplatesService } from './templates.service';
import {
  isSortableField,
  isTemplateStatus,
  SortableField,
  TemplateStatus,
} from './templates.types';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 25;

function intInRange(value: string | undefined, fallback: number, max: number): number {
  const parsed = parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, parsed));
}

/**
 * Plantillas de WhatsApp — **solo lectura por ahora**.
 *
 * Las plantillas viven en el panel WABA y se consumen por su API REST. Es el criterio de
 * MobilityManager: se traen los DATOS y BackOffice arma su propia pantalla, en vez de
 * embeber la ajena.
 *
 * **Crear y editar todavia no se puede.** La API de WABA solo publica el `GET`; el alta,
 * la edicion y el sync viven en sus rutas HTML con `requireRole`, que la API key no
 * satisface. Se pidio exponerlas como REST — ver `docs/SPEC_PLANTILLAS_WHATSAPP.md` §6.
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

  // GET /api/templates/:name — una plantilla por nombre (unico por cuenta en META)
  @Get(':name')
  async byName(@Param('name') name: string) {
    const template = await this.templates.getByName(name ?? '');
    if (!template) {
      throw new NotFoundException('Plantilla no encontrada');
    }
    return { success: true, data: template };
  }
}
