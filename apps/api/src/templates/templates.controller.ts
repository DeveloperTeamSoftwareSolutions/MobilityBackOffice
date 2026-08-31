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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

/**
 * Tipos de archivo que META acepta como ejemplo de cada encabezado multimedia.
 *
 * Se corta aca ademas de en WABA para no subir 50 MB que van a rebotar del otro lado.
 */
const SAMPLE_MIME_TYPES: Record<string, string[]> = {
  IMAGE: ['image/jpeg', 'image/png'],
  VIDEO: ['video/mp4', 'video/3gpp'],
  DOCUMENT: ['application/pdf'],
};

/** Tope del archivo de ejemplo. WABA acepta hasta 100 MB; aca se corta antes. */
const MAX_SAMPLE_BYTES = 25 * 1024 * 1024;
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

  // POST /api/templates/validate — el JSON que se le mandaria a META
  //
  // No escribe nada. Lo arma WABA con el mismo codigo del envio real, asi lo que se
  // muestra en la revision es exactamente lo que se manda.
  @Post('validate')
  @HttpCode(200)
  async validate(@Body() body: CreateTemplateInput) {
    return { success: true, ...(await this.templates.validate(body ?? ({} as CreateTemplateInput))) };
  }

  // POST /api/templates/upload-sample — ejemplo del encabezado multimedia
  //
  // META exige un ejemplo del medio para revisar una plantilla con encabezado de imagen,
  // video o documento. El archivo se reenvia a WABA, que tiene la credencial de META.
  @Post('upload-sample')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SAMPLE_BYTES } }))
  async uploadSample(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('headerType') headerType?: string,
  ) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');

    const tipo = (headerType ?? '').trim().toUpperCase();
    const permitidos = SAMPLE_MIME_TYPES[tipo];
    if (!permitidos) {
      throw new BadRequestException('El encabezado elegido no admite archivos');
    }
    if (!permitidos.includes(file.mimetype)) {
      throw new BadRequestException(
        `Ese tipo de archivo no sirve para este encabezado. Permitidos: ${permitidos.join(', ')}`,
      );
    }

    return { success: true, data: await this.templates.uploadSample(file, tipo) };
  }

  // POST /api/templates/drafts — guarda el avance SIN mandar nada a META
  //
  // Con `draftId` actualiza ese borrador; sin el, crea uno. Es lo que permite cerrar y
  // seguir despues, y alternar de modo sin perder lo cargado.
  @Post('drafts')
  @HttpCode(200)
  async saveDraft(@Body() body: CreateTemplateInput & { draftId?: number | null }) {
    const draftId = await this.templates.saveDraft(body ?? ({} as CreateTemplateInput));
    return { success: true, draftId };
  }

  // GET /api/templates/drafts/:id — recupera un borrador
  @Get('drafts/:id')
  async getDraft(@Param('id') id: string) {
    const draft = await this.templates.getDraft(parseId(id));
    if (!draft) throw new NotFoundException('Borrador no encontrado');
    return { success: true, data: draft };
  }

  // POST /api/templates/drafts/:id/submit — recien aca se manda a META
  @Post('drafts/:id/submit')
  @HttpCode(200)
  async submitDraft(@Param('id') id: string, @Body() body: CreateTemplateInput) {
    const template = await this.templates.submitDraft(parseId(id), body);
    if (!template) throw new NotFoundException('Borrador no encontrado');
    return { success: true, data: template };
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
