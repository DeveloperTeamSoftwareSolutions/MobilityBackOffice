import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { middlewareBase, middlewareHeaders } from '../common/middleware-request';
import { httpStatus, middlewareErrorCode } from '../common/middleware-error';
import {
  AssignOwnerInput,
  ChangeSapUserIdInput,
  ConsistencySummary,
  CreateMemberInput,
  CustomerGapsPage,
  CustomerGapsQuery,
  FindingsPage,
  FindingsQuery,
  NodesResult,
  WriteContext,
  WriteResult,
} from './consistency.types';

/**
 * Router del middleware para esta seccion. Relativo a `MIDDLEWARE_URL`, que ya incluye
 * `/api`. Lee y escribe SIN scope de vendedor, por eso va con `requireApiKey`.
 */
const BASE_PATH = '/mobility/backoffice-consistency';

/**
 * Brechas cartera vs SAP (clientes que SAP asigna y la cartera no tiene, clientes que no
 * estan en el maestro, etc.). Lo calcula el middleware para la app de Mobility; se
 * consume el mismo endpoint para que las dos pantallas digan lo mismo.
 */
const GAPS_PATH = '/v2/mobility/portfolio-gaps';

const READ_TIMEOUT = 60000;
const WRITE_TIMEOUT = 20000;

/**
 * Codigos de negocio del middleware -> mensaje para quien corrige. Se traduce por
 * `code`, que es el contrato estable; el `error` viaja en ingles y puede cambiar.
 */
const CONFLICT_MESSAGES: Record<string, string> = {
  MEMBER_ALREADY_IN_NODE: 'Esa persona ya está en ese nodo de la jerarquía.',
  STALE_MEMBER: 'El miembro cambió desde que se listó. Actualizá la lista y volvé a intentar.',
  NO_CHANGE: 'El miembro ya tiene ese usuario SAP.',
  PORTFOLIO_HAS_OWNER: 'La cartera ya tiene un dueño comercial vigente.',
};

const NOT_FOUND_MESSAGES: Record<string, string> = {
  NODE_NOT_FOUND: 'El nodo de la jerarquía ya no existe.',
  MEMBER_NOT_FOUND: 'El miembro ya no está en la jerarquía: puede que otra persona lo haya dado de baja.',
  PORTFOLIO_NOT_FOUND: 'La cartera ya no existe.',
};

/**
 * Cliente HTTP de "Consistencia de datos" hacia MobilityMiddleWare.
 *
 * Las lecturas que fallan son 503: no se expone el detalle del middleware. En las
 * escrituras importa decir si el cambio quedo o no, porque de eso depende que la
 * persona reintente: el middleware aplica cada correccion en una transaccion, asi que
 * una respuesta de error (4xx/5xx) significa que NO se aplico. Solo cuando no hubo
 * respuesta (red, tiempo) no se sabe, y hay que decirlo asi.
 */
@Injectable()
export class ConsistencyClient {
  private readonly logger = new Logger(ConsistencyClient.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private base(): string {
    return middlewareBase(this.config);
  }

  private headers(): Record<string, string> {
    return middlewareHeaders(this.config);
  }

  async getSummary(refresh: boolean): Promise<ConsistencySummary> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: ConsistencySummary }>(`${this.base()}${BASE_PATH}/summary`, {
          params: refresh ? { refresh: '1' } : {},
          headers: this.headers(),
          timeout: READ_TIMEOUT,
        }),
      );
      return res.data.data;
    } catch (err) {
      this.readError(err, 'el resumen de consistencia');
    }
  }

  async listFindings(query: FindingsQuery): Promise<FindingsPage> {
    const params: Record<string, string> = {
      page: String(query.page),
      limit: String(query.limit),
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    };
    if (query.group) params.group = query.group;
    if (query.category) params.category = query.category;
    if (query.resolution) params.resolution = query.resolution;
    if (query.companyCode) params.companyCode = query.companyCode;
    if (query.search) params.search = query.search;
    if (query.exportAll) params.export = '1';
    if (query.refresh) params.refresh = '1';
    try {
      const res = await firstValueFrom(
        this.http.get<FindingsPage & { success: boolean }>(
          `${this.base()}${BASE_PATH}/findings`,
          { params, headers: this.headers(), timeout: READ_TIMEOUT },
        ),
      );
      const { data, companies, generatedAt, pagination } = res.data;
      return { data, companies, generatedAt, pagination };
    } catch (err) {
      this.readError(err, 'los hallazgos');
    }
  }

  async listNodes(): Promise<NodesResult> {
    try {
      const res = await firstValueFrom(
        this.http.get<NodesResult & { success: boolean }>(`${this.base()}${BASE_PATH}/nodes`, {
          headers: this.headers(),
          timeout: READ_TIMEOUT,
        }),
      );
      return { data: res.data.data, roles: res.data.roles };
    } catch (err) {
      this.readError(err, 'los nodos de la jerarquía');
    }
  }

  /** 404 del middleware = todavia no tiene el endpoint en este ambiente. */
  async listCustomerGaps(query: CustomerGapsQuery): Promise<CustomerGapsPage> {
    const params: Record<string, string> = {
      page: String(query.page),
      limit: String(query.limit),
      sortDir: query.sortDir,
    };
    if (query.gapType) params.gapType = query.gapType;
    if (query.companyCode) params.companyCode = query.companyCode;
    if (query.search) params.search = query.search;
    if (query.sortBy) params.sortBy = query.sortBy;
    if (query.exportAll) params.export = '1';
    try {
      const res = await firstValueFrom(
        this.http.get<Omit<CustomerGapsPage, 'available'> & { success: boolean }>(
          `${this.base()}${GAPS_PATH}`,
          { params, headers: this.headers(), timeout: READ_TIMEOUT },
        ),
      );
      return {
        available: true,
        data: res.data.data ?? [],
        summary: res.data.summary ?? {},
        pagination: res.data.pagination,
      };
    } catch (err) {
      if (httpStatus(err) === 404) {
        return {
          available: false,
          data: [],
          summary: {},
          pagination: { total: 0, page: query.page, limit: query.limit, totalPages: 1 },
        };
      }
      throw new ServiceUnavailableException('No se pudieron obtener las brechas de clientes');
    }
  }

  async createMember(input: CreateMemberInput, ctx: WriteContext): Promise<WriteResult> {
    return this.write('post', `${BASE_PATH}/members`, { ...input, ...this.ctxBody(ctx) });
  }

  async changeMemberSapUserId(
    input: ChangeSapUserIdInput,
    ctx: WriteContext,
  ): Promise<WriteResult> {
    return this.write(
      'put',
      `${BASE_PATH}/members/${encodeURIComponent(input.guid)}/sap-user-id`,
      {
        memberSapUserId: input.memberSapUserId,
        expectedSapUserId: input.expectedSapUserId,
        ...this.ctxBody(ctx),
      },
    );
  }

  async removeMember(guid: string, ctx: WriteContext): Promise<WriteResult> {
    return this.write(
      'post',
      `${BASE_PATH}/members/${encodeURIComponent(guid)}/remove`,
      this.ctxBody(ctx),
    );
  }

  async assignPortfolioOwner(input: AssignOwnerInput, ctx: WriteContext): Promise<WriteResult> {
    return this.write(
      'post',
      `${BASE_PATH}/portfolios/${encodeURIComponent(input.guidPortfolio)}/owner`,
      {
        ownerSapUserId: input.ownerSapUserId,
        ownerName: input.ownerName,
        ownerGuidUsers: input.ownerGuidUsers,
        ownerEmail: input.ownerEmail,
        ...this.ctxBody(ctx),
      },
    );
  }

  /**
   * Fallo de una lectura. Se dice la causa cuando es de configuración (credencial o
   * versión del middleware) porque son las dos que quien despliega puede arreglar, y se
   * registra el status y el code para no depender de adivinar desde el navegador.
   */
  private readError(err: unknown, what: string): never {
    const status = httpStatus(err);
    const code = middlewareErrorCode(err);
    const resultado = status !== undefined ? `HTTP ${status}` : 'sin respuesta';
    // El texto del error del middleware va SOLO al log (nunca al navegador): es lo que
    // dice por que fallo un 500 en su base, y sin el hay que ir a buscarlo del otro lado.
    // Un 500 del middleware trae el motivo real en `detail` (su manejador central lo manda
    // ahi), y `error` solo dice "Internal server error".
    const cuerpo = (err as { response?: { data?: { error?: string; detail?: unknown } } })
      ?.response?.data;
    const detalle = [cuerpo?.error, typeof cuerpo?.detail === 'string' ? cuerpo.detail : null]
      .filter(Boolean)
      .join(' | ');
    this.logger.warn(
      `No se pudo obtener ${what}: ${resultado}${code ? ` (${code})` : ''}${detalle ? ` — ${detalle}` : ''}`,
    );
    if (status === 401 || status === 403) {
      throw new ServiceUnavailableException(
        'El middleware rechazó la credencial de BackOffice: revisá que MIDDLEWARE_API_KEY coincida con la del middleware.',
      );
    }
    if (status === 404) {
      throw new ServiceUnavailableException(
        'El middleware de este ambiente no tiene la sección de consistencia (requiere MobilityMiddleWare 1.378.0 o superior).',
      );
    }
    throw new ServiceUnavailableException(`No se pudo obtener ${what}.`);
  }

  private ctxBody(ctx: WriteContext): Record<string, string> {
    const body: Record<string, string> = { actorEmail: ctx.actorEmail, reason: ctx.reason };
    if (ctx.findingGroup) body.findingGroup = ctx.findingGroup;
    return body;
  }

  private async write(
    method: 'post' | 'put',
    path: string,
    body: Record<string, unknown>,
  ): Promise<WriteResult> {
    try {
      const res = await firstValueFrom(
        this.http[method]<{ data: WriteResult }>(`${this.base()}${path}`, body, {
          headers: this.headers(),
          timeout: WRITE_TIMEOUT,
        }),
      );
      return res.data.data;
    } catch (err) {
      this.writeError(err);
    }
  }

  private writeError(err: unknown): never {
    const status = httpStatus(err);
    const code = middlewareErrorCode(err) ?? '';
    if (status === 409) {
      throw new ConflictException(CONFLICT_MESSAGES[code] ?? 'Otra persona modificó el dato. Actualizá la lista y volvé a intentar.');
    }
    if (status === 404) {
      throw new NotFoundException(NOT_FOUND_MESSAGES[code] ?? 'El registro ya no existe.');
    }
    if (status === 400) {
      throw new BadRequestException('Los datos de la corrección no son válidos. No se aplicó ningún cambio.');
    }
    if (status === 401 || status === 403) {
      throw new ServiceUnavailableException(
        'El middleware rechazó la credencial de BackOffice. No se aplicó ningún cambio.',
      );
    }
    if (status !== undefined) {
      throw new ServiceUnavailableException('No se pudo aplicar la corrección. No se aplicó ningún cambio.');
    }
    throw new ServiceUnavailableException(
      'No hubo respuesta del middleware: no se sabe si la corrección se aplicó. Actualizá la lista antes de reintentar.',
    );
  }
}
