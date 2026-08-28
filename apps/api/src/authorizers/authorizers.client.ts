import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { middlewareBase, middlewareHeaders } from '../common/middleware-request';
import { AuthorizerRow } from './authorizers.types';

/**
 * Matriz de autorizadores del middleware.
 *
 * DE LOS TRES ENDPOINTS `authorizer-*` ESTE ES EL QUE SIRVE. Los otros dos
 * (`/authorizer-limits`, `/authorizer-profit-centers`) son las mitades sueltas: bandas
 * sin CEBEs y CEBEs sin bandas. Este es el join, y es el que consume la logica real de
 * aprobacion del middleware (`approverLimits.js`, `approvalNotifierService.js`).
 *
 * Se apunta a **v2**: la vista v1 (`VIEW_AuthorizerLimitsProfitCentersMobility`) esta
 * marcada PARA DEPRECAR en el relevamiento de Mobility-PROD, junto con las otras dos
 * `authorizer-*`. `VIEW_V2_AuthorizerLimitsProfitCentersMobility` queda como vigente y
 * expone las mismas columnas.
 */
const MATRIX_PATH = '/v2/mobility/authorizer-limits-profit-centers';

/**
 * Tope de filas que se le piden al middleware de una vez.
 *
 * El grano de la fuente es (autorizador x CEBE), y la UI agrupa por autorizador, asi que
 * hay que traer la sociedad ENTERA antes de poder paginar: paginar la fuente partiria a
 * un gerente entre dos paginas. El endpoint clampea a 200 en modo normal y a 50.000 con
 * `export=1`, que es el modo que se usa aca.
 */
const FETCH_LIMIT = 50000;

/**
 * Maestro de CEBEs. La matriz devuelve codigos y no nombres, asi que sin esto la
 * pantalla es un tablero de numeros. Son ~66 filas: entran en una sola llamada.
 *
 * v2: `VIEW_ProfitCentersMobility` (v1) esta marcada para deprecar.
 */
const PROFIT_CENTERS_PATH = '/v2/mobility/profit-centers';

/**
 * Integrantes de los nodos `COUNTRY MANAGER%` que pertenecen a una sociedad.
 *
 * OJO: devuelve los INTEGRANTES del nodo, no "los country managers". El nodo es un
 * puesto del organigrama y su equipo cuelga de ahi. Ver `CountryManagerNodeMember`.
 * Es el unico de los dos endpoints que joinea a `Users`, asi que es el unico que trae
 * correo y sociedad.
 */
const COUNTRY_MANAGERS_PATH = '/mobility/commercial-team-hierarchy/country-manager';

/**
 * Arbol de la jerarquia comercial. Se consulta SOLO cuando la lista de Country Managers
 * vino vacia, para poder distinguir "no hay nodo COUNTRY MANAGER" de "hay nodo pero
 * ninguno de esta sociedad". En el caso normal no se pide.
 */
const HIERARCHY_TREE_PATH = '/mobility/commercial-team-hierarchy/tree';

/**
 * Como identifica el middleware a los Country Managers: `cth.Name LIKE 'COUNTRY MANAGER%'`.
 * Es una convencion de NOMBRE, no un flag ni un tipo de rol, asi que se replica igual
 * para el diagnostico. Si el middleware cambia el criterio, esto queda viejo — pero el
 * unico efecto es un mensaje de vacio menos preciso, nunca un dato incorrecto.
 */
const COUNTRY_MANAGER_NODE_PREFIX = 'COUNTRY MANAGER';

/** Detalle de un nodo con sus integrantes directos. */
const HIERARCHY_NODE_PATH = (guid: string) =>
  `/mobility/commercial-team-hierarchy/${encodeURIComponent(guid)}`;

/** Fila tal como la publica el middleware (camelCase). */
interface MwAuthorizerRow {
  companyCode?: string | null;
  authorizerLimitGuid?: string | null;
  userEmail?: string | null;
  userId?: string | null;
  minimumPercentage?: number | null;
  maximumPercentage?: number | null;
  approvalLevel?: string | null;
  profitCenter?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
}

/** Fila del maestro de CEBEs. */
interface MwProfitCenter {
  profitCenterCode?: string | null;
  profitCenterName?: string | null;
}

/** Integrante de un nodo COUNTRY MANAGER, filtrado por sociedad (con join a Users). */
interface MwCountryManager {
  nodeGuid?: string | null;
  nodeName?: string | null;
  memberGuid?: string | null;
  guidUsers?: string | null;
  companyCode?: string | null;
  email?: string | null;
  memberName?: string | null;
  role?: string | null;
  sapUserId?: string | null;
  country?: string | null;
  businessUnit?: string | null;
}

/** Integrante tal como lo publica el detalle del nodo (SIN join a Users). */
interface MwNodeMember {
  guid?: string | null;
  guidUsers?: string | null;
  memberName?: string | null;
  role?: string | null;
  sapUserId?: string | null;
}

/** Fila del endpoint filtrado por sociedad: trae correo y sociedad. */
export interface CompanyNodeMemberRow {
  nodeGuid: string | null;
  nodeName: string | null;
  country: string | null;
  memberGuid: string | null;
  guidUsers: string | null;
  name: string | null;
  role: string | null;
  sapUserId: string | null;
  email: string | null;
  companyCode: string | null;
}

/** Fila del detalle del nodo: sin correo ni sociedad. */
export interface NodeMemberRow {
  memberGuid: string | null;
  guidUsers: string | null;
  name: string | null;
  role: string | null;
  sapUserId: string | null;
}

interface MwResponse {
  success?: boolean;
  data?: MwAuthorizerRow[];
  pagination?: { total?: number };
}

/** Normaliza a `null` lo que viene vacio, y recorta lo que viene con espacios. */
function text(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

function mapRow(row: MwAuthorizerRow): AuthorizerRow | null {
  const userEmail = text(row.userEmail);
  // Sin email la fila no identifica a nadie: no hay forma de agruparla ni de mostrarla.
  if (!userEmail) return null;

  return {
    companyCode: text(row.companyCode) ?? '',
    authorizerLimitGuid: text(row.authorizerLimitGuid),
    userEmail,
    userId: text(row.userId),
    minimumPercentage: row.minimumPercentage != null ? Number(row.minimumPercentage) : null,
    maximumPercentage: row.maximumPercentage != null ? Number(row.maximumPercentage) : null,
    approvalLevel: text(row.approvalLevel),
    profitCenter: text(row.profitCenter),
    validFrom: text(row.validFrom),
    validUntil: text(row.validUntil),
  };
}

@Injectable()
export class AuthorizersClient {
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

  /**
   * Todas las filas de la matriz de una sociedad, sin agrupar.
   *
   * @param companyCode Sociedad SAP. El endpoint lo exige: no hay "toda la matriz".
   * @param activeOnly  Solo asignaciones de CEBE vigentes hoy. OJO: el middleware
   *                    aplica el filtro sobre `ValidFrom`/`ValidUntil`, que vienen NULL
   *                    para un autorizador sin ningun CEBE (LEFT JOIN), asi que esos
   *                    pasan igual. No es un bug del filtro, es el grano de la vista.
   */
  async getMatrix(companyCode: string, activeOnly: boolean): Promise<AuthorizerRow[]> {
    if (!this.base()) {
      throw new ServiceUnavailableException('El middleware no está configurado');
    }

    try {
      const res = await firstValueFrom(
        this.http.get<MwResponse>(`${this.base()}${MATRIX_PATH}`, {
          params: {
            companyCode,
            page: 1,
            limit: FETCH_LIMIT,
            export: '1',
            activeOnly: activeOnly ? '1' : undefined,
            sortBy: 'UserEmail',
            sortDir: 'ASC',
          },
          headers: this.headers(),
          timeout: 30000,
        }),
      );

      return (res.data?.data ?? []).map(mapRow).filter((r): r is AuthorizerRow => r !== null);
    } catch {
      throw new ServiceUnavailableException('La matriz de autorizadores no está disponible');
    }
  }

  /**
   * Nombres del maestro de CEBEs, indexados por codigo.
   *
   * Es un CATALOGO DE APOYO: si falla, la pantalla sigue sirviendo con los codigos
   * pelados. Por eso devuelve un mapa vacio en vez de propagar el error — quedarse sin
   * los nombres es cosmetico, quedarse sin la matriz no.
   */
  async getProfitCenterNames(): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (!this.base()) return names;

    try {
      const res = await firstValueFrom(
        this.http.get<{ data?: MwProfitCenter[] }>(`${this.base()}${PROFIT_CENTERS_PATH}`, {
          params: { page: 1, limit: FETCH_LIMIT, export: '1' },
          headers: this.headers(),
          timeout: 20000,
        }),
      );

      for (const item of res.data?.data ?? []) {
        const code = text(item.profitCenterCode);
        const name = text(item.profitCenterName);
        if (code && name) names.set(code, name);
      }
    } catch {
      // Catalogo de apoyo: sin nombres la pantalla sigue siendo util.
    }
    return names;
  }

  /**
   * Country Managers de la sociedad.
   *
   * Igual que los nombres: si falla NO tumba la matriz, pero a diferencia de aquellos
   * su ausencia SI cambia lo que la pantalla afirma, asi que el service lo marca para
   * que la UI avise en vez de mostrar una lista vacia como si no hubiera ninguno.
   */
  async getCountryManagers(companyCode: string): Promise<CompanyNodeMemberRow[] | null> {
    if (!this.base()) return null;

    try {
      const res = await firstValueFrom(
        this.http.get<{ data?: MwCountryManager[] }>(`${this.base()}${COUNTRY_MANAGERS_PATH}`, {
          params: { companyCode },
          headers: this.headers(),
          timeout: 20000,
        }),
      );

      return (res.data?.data ?? []).map((item) => ({
        nodeGuid: text(item.nodeGuid),
        nodeName: text(item.nodeName),
        country: text(item.country),
        memberGuid: text(item.memberGuid),
        guidUsers: text(item.guidUsers),
        name: text(item.memberName),
        role: text(item.role),
        sapUserId: text(item.sapUserId),
        email: text(item.email),
        companyCode: text(item.companyCode),
      }));
    } catch {
      return null;
    }
  }

  /**
   * TODOS los integrantes de un nodo, sin filtrar por sociedad.
   *
   * Hace falta porque el endpoint filtrado puede dejar afuera justo a quien ocupa el
   * puesto: en QATEST el gerente de "COUNTRY MANAGER BAN" figura bajo la sociedad 2200
   * mientras sus vendedores estan en la 2100, asi que consultando solo la 2100 se ve al
   * equipo y no al jefe.
   *
   * Este endpoint NO joinea a `Users`: no trae correo ni sociedad. Por eso se usa para
   * COMPLETAR la lista, nunca para reemplazarla.
   */
  async getNodeMembers(nodeGuid: string): Promise<NodeMemberRow[] | null> {
    if (!this.base()) return null;

    try {
      const res = await firstValueFrom(
        this.http.get<{ data?: { members?: MwNodeMember[] } }>(
          `${this.base()}${HIERARCHY_NODE_PATH(nodeGuid)}`,
          { headers: this.headers(), timeout: 20000 },
        ),
      );

      return (res.data?.data?.members ?? []).map((m) => ({
        memberGuid: text(m.guid),
        guidUsers: text(m.guidUsers),
        name: text(m.memberName),
        role: text(m.role),
        sapUserId: text(m.sapUserId),
      }));
    } catch {
      return null;
    }
  }

  /**
   * ¿Existe algun nodo `COUNTRY MANAGER%` en la jerarquia?
   *
   * Solo se llama cuando la lista vino vacia. `null` = no se pudo averiguar, y entonces
   * la UI no afirma ninguna de las dos causas.
   */
  async hasCountryManagerNode(): Promise<boolean | null> {
    if (!this.base()) return null;

    try {
      const res = await firstValueFrom(
        this.http.get<{ data?: { name?: string | null }[] }>(
          `${this.base()}${HIERARCHY_TREE_PATH}`,
          { headers: this.headers(), timeout: 20000 },
        ),
      );

      return (res.data?.data ?? []).some((node) =>
        (node.name ?? '')
          .trim()
          .toUpperCase()
          .startsWith(COUNTRY_MANAGER_NODE_PREFIX),
      );
    } catch {
      return null;
    }
  }
}
