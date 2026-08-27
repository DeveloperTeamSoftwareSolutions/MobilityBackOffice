import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BackOfficeRole } from '../auth/backoffice-role.enum';
import { AuthorizersService } from './authorizers.service';
import { isMatrixFilter, isSortableField, MatrixFilter, SortableField } from './authorizers.types';

/** Tope de filas por pagina. El cliente puede pedir menos, nunca mas. */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 25;

/** Largo maximo de `companyCode` en SAP (`NVARCHAR(8)`). */
const COMPANY_CODE_MAX = 8;

/** `'1'` y `'true'` cuentan como verdadero; cualquier otra cosa es falso. */
function flag(value?: string): boolean {
  return value === '1' || value === 'true';
}

/** Sociedad obligatoria y acotada: el endpoint del middleware la exige. */
function requireCompanyCode(companyCode?: string): string {
  const code = (companyCode ?? '').trim();
  if (!code) {
    throw new BadRequestException('companyCode es obligatorio');
  }
  if (code.length > COMPANY_CODE_MAX) {
    throw new BadRequestException(
      `companyCode no puede superar los ${COMPANY_CODE_MAX} caracteres`,
    );
  }
  return code;
}

function intInRange(value: string | undefined, fallback: number, max: number): number {
  const parsed = parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, parsed));
}

/**
 * Matriz de autorizadores — quien puede firmar que, y con que limites.
 *
 * SOLO LECTURA. La matriz vive en `[SAPServices].[dbo].[AuthorizerLimits]` +
 * `[AuthorizerProfitCenters]`, replicadas de SAP: BackOffice la consulta y no la
 * escribe. Existe porque hoy la unica forma de saber quien esta en la matriz es
 * consultar la base a mano.
 *
 * EXCLUSIVA DE SUPERADMIN. Expone los emails de todos los gerentes con su poder de
 * firma; es informacion de control interno y no hace falta para ninguna otra tarea del
 * back-office. `Usuario` NO entra: ver la nota de `roleAccess.ts` en el front y
 * `docs/ROLES_Y_PERMISOS.md`.
 */
@Controller('api/authorizers')
@Roles(BackOfficeRole.SuperAdmin)
@UseGuards(JwtGuard, RolesGuard)
export class AuthorizersController {
  constructor(private readonly authorizers: AuthorizersService) {}

  // GET /api/authorizers/companies?q=&limit= — typeahead de sociedades
  //
  // Va primero: el listado exige `companyCode` porque el endpoint del middleware lo
  // exige, asi que sin elegir una sociedad no hay nada que mostrar.
  @Get('companies')
  async companies(@Query('q') q?: string, @Query('limit') limit?: string) {
    const data = await this.authorizers.companies(
      (q ?? '').trim(),
      intInRange(limit, 20, 50),
    );
    return { success: true, data };
  }

  // GET /api/authorizers/country-managers?companyCode= — el OTRO permiso
  //
  // Va en su propio endpoint y no dentro del listado porque es otra cosa: no tiene
  // banda, no tiene CEBEs y no pagina (son pocos). Mezclarlo en la grilla haria pasar
  // por matriz algo que no lo es.
  @Get('country-managers')
  async countryManagers(@Query('companyCode') companyCode?: string) {
    const code = requireCompanyCode(companyCode);
    const { available, diagnosis, nodes } = await this.authorizers.countryManagers(code);
    const total = nodes.reduce((n, node) => n + node.members.length, 0);
    return { success: true, companyCode: code, available, diagnosis, nodes, total };
  }

  // GET /api/authorizers?companyCode=&page=&limit=&search=&sortBy=&sortDir=&filter=&activeOnly=
  @Get()
  async list(
    @Query('companyCode') companyCode?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('filter') filter?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    const code = requireCompanyCode(companyCode);

    const requestedSort = (sortBy ?? '').trim();
    const requestedFilter = (filter ?? '').trim();

    const result = await this.authorizers.getMatrix({
      companyCode: code,
      page: Math.max(1, parseInt(page ?? '', 10) || 1),
      limit: intInRange(limit, DEFAULT_LIMIT, MAX_LIMIT),
      search: (search ?? '').trim(),
      // Whitelist: lo que no este declarado cae al default en vez de viajar al sort.
      sortBy: isSortableField(requestedSort) ? (requestedSort as SortableField) : 'userEmail',
      sortDir: sortDir === 'DESC' ? 'DESC' : 'ASC',
      filter: isMatrixFilter(requestedFilter) ? (requestedFilter as MatrixFilter) : 'all',
      activeOnly: flag(activeOnly),
    });

    return { success: true, ...result };
  }
}
