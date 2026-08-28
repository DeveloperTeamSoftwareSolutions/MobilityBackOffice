import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BackOfficeRole } from '../auth/backoffice-role.enum';
import { RegionsService } from './regions.service';
import { CebeInput } from './regions.types';

interface AuthedRequest {
  user?: { email?: string; guid?: string; sub?: string };
}

/** Actor (identidad del logueado) para la traza de auditoría: guid + email. */
function actor(req: AuthedRequest): { email?: string; guid?: string } {
  return { email: req.user?.email, guid: req.user?.guid ?? req.user?.sub };
}

/**
 * API de Regiones comerciales por CEBE.
 *
 * Las regiones (CA/CB/AN/NA) son el catálogo `Continents` en solo lectura y las
 * agrupaciones (CAYCAR) son virtuales: **no hay CRUD de regiones**. Lo único que se
 * gestiona son los vínculos CEBE ↔ región ↔ sociedad.
 *
 * El módulo entero exige rol `Administrador` (SuperAdmin pasa siempre por el
 * `RolesGuard`). A diferencia de MobilityManager —donde las lecturas quedaban
 * abiertas a cualquier autenticado porque las consumían reportes— acá no hay más
 * consumidores que esta UI, y dejar el mapa región↔CEBE legible para Marketing
 * contradiría que la sección no se le muestre.
 *
 * El sync máquina-a-máquina vive en `RegionsSyncController` y se autentica por API key.
 */
@Controller('api/regions')
// `Usuario` entra tambien: es el rol que abarca todo el back-office menos la
// consola de soporte. Ver docs/ROLES_Y_PERMISOS.md.
@Roles(BackOfficeRole.Administrador, BackOfficeRole.Usuario)
@UseGuards(JwtGuard, RolesGuard)
export class RegionsController {
  constructor(private readonly regions: RegionsService) {}

  // GET /api/regions — listar regiones atómicas (catálogo Continents)
  @Get()
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ) {
    const result = await this.regions.getAll({
      page: Math.max(1, parseInt(page ?? '', 10) || 1),
      limit: Math.min(200, Math.max(1, parseInt(limit ?? '', 10) || 50)),
      search: search ?? '',
      sortBy: sortBy ?? 'sortOrder',
      sortDir: sortDir === 'DESC' ? 'DESC' : 'ASC',
    });
    return { success: true, ...result };
  }

  // GET /api/regions/groups — agrupaciones virtuales (CAYCAR = CA + CB)
  @Get('groups')
  async groups() {
    return { success: true, data: await this.regions.getGroups() };
  }

  // GET /api/regions/cebes/available?q=&limit= — typeahead de CEBEs (maestro)
  @Get('cebes/available')
  async availableCebes(@Query('q') q?: string, @Query('limit') limit?: string) {
    const data = await this.regions.availableCebes(
      (q ?? '').trim(),
      Math.min(50, Math.max(1, parseInt(limit ?? '', 10) || 20)),
    );
    return { success: true, data };
  }

  // GET /api/regions/companies?q=&limit= — typeahead de sociedades (maestro Companies)
  @Get('companies')
  async companies(@Query('q') q?: string, @Query('limit') limit?: string) {
    const data = await this.regions.companies(
      (q ?? '').trim(),
      Math.min(50, Math.max(1, parseInt(limit ?? '', 10) || 20)),
    );
    return { success: true, data };
  }

  // GET /api/regions/diagnostics/unmapped — CEBEs sin región
  @Get('diagnostics/unmapped')
  async unmapped() {
    return { success: true, data: await this.regions.unmappedCebes() };
  }

  // GET /api/regions/diagnostics/multi — CEBEs en varias regiones
  @Get('diagnostics/multi')
  async multi() {
    return { success: true, data: await this.regions.multiRegionCebes() };
  }

  // GET /api/regions/:code/resolve — CEBEs efectivos (CAYCAR → unión CA+CB)
  //
  // ORDEN LOAD-BEARING: esta ruta y todas las literales de arriba deben declararse
  // ANTES de `:guid`, o `/groups` y compañía se interpretan como un guid.
  @Get(':code/resolve')
  async resolve(@Param('code') code: string) {
    return { success: true, data: await this.regions.resolve(code) };
  }

  // GET /api/regions/:guid — región + sus CEBEs
  @Get(':guid')
  async byGuid(@Param('guid') guid: string) {
    const data = await this.regions.getByGuid(guid);
    if (!data) throw new NotFoundException('Región no encontrada');
    return { success: true, data };
  }

  // POST /api/regions/:guid/cebes — vincular CEBE(s) a una región atómica
  @Post(':guid/cebes')
  async linkCebes(
    @Param('guid') guid: string,
    @Body() body: { cebes?: CebeInput[] },
    @Req() req: AuthedRequest,
  ) {
    const data = await this.regions.linkCebes(guid, body?.cebes ?? [], actor(req));
    return { success: true, ...data };
  }

  // DELETE /api/regions/:guid/cebes/:code/:companyCode — desvincular un CEBE de una
  // sociedad en una región. La sociedad es parte de la clave.
  @Delete(':guid/cebes/:code/:companyCode')
  async unlinkCebe(
    @Param('guid') guid: string,
    @Param('code') code: string,
    @Param('companyCode') companyCode: string,
    @Req() req: AuthedRequest,
  ) {
    const ok = await this.regions.unlinkCebe(guid, code, companyCode, actor(req));
    if (!ok) {
      throw new NotFoundException(
        'El CEBE no está vinculado a la región para esa sociedad',
      );
    }
    return { success: true };
  }
}
