import { Injectable } from '@nestjs/common';
import { RegionsClient } from '../regions/regions.client';
import { AvailableCompany } from '../regions/regions.types';
import { AuthorizersClient } from './authorizers.client';
import { effectiveBand, isAssignmentActive } from './authorizers.band';
import {
  Authorizer,
  AuthorizerProfitCenter,
  AuthorizerRow,
  AuthorizersPage,
  CountryManager,
  CountryManagersDiagnosis,
  MatrixFilter,
  MatrixQuery,
  MatrixSummary,
  SortableField,
} from './authorizers.types';

/**
 * Matriz de autorizadores — lectura y agrupacion.
 *
 * El middleware devuelve una fila por (autorizador x CEBE). Este servicio la convierte
 * al grano de la pregunta que hace la tarea —"quien esta en la matriz"— agrupando por
 * email, e interpreta la banda de firma para que la pantalla no vuelque numeros crudos
 * que mienten. Ver `authorizers.band.ts`.
 *
 * Todo el trabajo (agrupar, filtrar, ordenar, paginar) se hace sobre la sociedad
 * completa porque el grano de la fuente no coincide con el de la UI: paginar en el
 * middleware partiria a un gerente entre dos paginas. Es el mismo motivo por el que el
 * estandar del equipo manda aplanar y ensamblar en el consumidor.
 */
@Injectable()
export class AuthorizersService {
  constructor(
    private readonly client: AuthorizersClient,
    /**
     * El maestro de sociedades ya lo resuelve Regiones contra
     * `/v2/mobility/companies`. Se reusa en vez de duplicar la llamada; es el mismo
     * catalogo y el mismo typeahead.
     */
    private readonly regions: RegionsClient,
  ) {}

  /** Sociedades para el selector. Sin una sociedad elegida no hay matriz que mostrar. */
  companies(search: string, limit: number): Promise<AvailableCompany[]> {
    return this.regions.searchCompanies(search, limit);
  }

  /**
   * Country Managers de la sociedad — el otro permiso.
   *
   * El endpoint devuelve 200 con lista vacia por TRES causas distintas, y solo una es
   * un hecho del negocio ("esta sociedad no tiene a nadie"). Las otras dos son
   * problemas de carga: que no exista el nodo `COUNTRY MANAGER%` (la consulta los
   * identifica por el NOMBRE del nodo, asi que un renombre los esconde a todos) o que
   * al integrante le falte la fila en `Users` con su `SapCompanyCode`.
   *
   * Presentar cualquiera de esas dos como "nadie autoriza otra forma de pago" seria
   * justo el ticket que la pantalla quiere evitar, asi que cuando la lista viene vacia
   * se consulta el arbol para separarlas. En el caso normal esa llamada NO se hace.
   */
  async countryManagers(companyCode: string): Promise<{
    available: boolean;
    diagnosis: CountryManagersDiagnosis;
    data: CountryManager[];
  }> {
    const data = await this.client.getCountryManagers(companyCode);

    if (data === null) return { available: false, diagnosis: 'unavailable', data: [] };
    if (data.length > 0) return { available: true, diagnosis: 'ok', data };

    const hasNode = await this.client.hasCountryManagerNode();
    // `null` = no se pudo averiguar: se deja en `unavailable` para no afirmar una causa
    // que no se comprobo.
    const diagnosis: CountryManagersDiagnosis =
      hasNode === null ? 'unavailable' : hasNode ? 'sin_miembros' : 'sin_nodo';

    return { available: true, diagnosis, data: [] };
  }

  async getMatrix(query: MatrixQuery): Promise<AuthorizersPage> {
    // El maestro de CEBEs es independiente de la matriz: van juntos, no en fila.
    const [rows, names] = await Promise.all([
      this.client.getMatrix(query.companyCode, query.activeOnly),
      this.client.getProfitCenterNames(),
    ]);
    const all = groupByAuthorizer(rows, names);

    // El resumen se calcula sobre TODA la sociedad, no sobre la pagina ni sobre el
    // filtro: es el semaforo de "que tan sana esta la matriz" y tiene que ser estable
    // mientras el usuario navega.
    const summary = summarize(all);

    const filtered = applyFilter(all, query.filter).filter(matches(query.search));
    sortAuthorizers(filtered, query.sortBy, query.sortDir);

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    const page = Math.min(query.page, totalPages);
    const offset = (page - 1) * query.limit;

    return {
      data: filtered.slice(offset, offset + query.limit),
      pagination: { total, page, limit: query.limit, totalPages },
      summary,
    };
  }
}

/** Agrupa las filas por email y arma el CEBE de cada una, con su nombre del maestro. */
function groupByAuthorizer(rows: AuthorizerRow[], names: Map<string, string>): Authorizer[] {
  const byEmail = new Map<string, Authorizer>();

  for (const row of rows) {
    // El email es la clave de la matriz en SAP (`AuthorizerProfitCenters` joinea por
    // UserEmail, no por Guid), asi que agrupar por otra cosa partiria al mismo gerente.
    const key = row.userEmail.toLowerCase();
    let authorizer = byEmail.get(key);

    if (!authorizer) {
      authorizer = {
        companyCode: row.companyCode,
        userEmail: row.userEmail,
        userId: row.userId,
        approvalLevel: row.approvalLevel,
        minimumPercentage: row.minimumPercentage,
        maximumPercentage: row.maximumPercentage,
        band: effectiveBand(row),
        profitCenters: [],
        activeProfitCenterCount: 0,
        coversWholeCompany: false,
      };
      byEmail.set(key, authorizer);
    }

    // `profitCenter` NULL = firma en TODA la sociedad. Es un COMODIN, no una ausencia:
    // el middleware lo resuelve como `ProfitCenter = @Pc OR ProfitCenter IS NULL`, asi
    // que esa fila es la de mayor alcance. Mostrarla como "sin CEBE" invierte el
    // significado — es el error que mas facil se comete con esta vista.
    if (!row.profitCenter) {
      authorizer.coversWholeCompany = true;
      continue;
    }

    const active = isAssignmentActive(row.validFrom, row.validUntil);
    authorizer.profitCenters.push({
      code: row.profitCenter,
      name: names.get(row.profitCenter) ?? null,
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      active,
    });
    if (active) authorizer.activeProfitCenterCount += 1;
  }

  for (const authorizer of byEmail.values()) {
    authorizer.profitCenters.sort((a, b) => a.code.localeCompare(b.code));
  }

  return [...byEmail.values()];
}

/**
 * Lo que hay que mirar antes de leer la tabla.
 *
 * `blocked` y `withoutActiveProfitCenters` son las dos formas de estar en la matriz y
 * aun asi no servir: la banda no lo habilita a firmar, o no alcanza ningun CEBE
 * vigente. Hoy nada de eso se ve hasta que un gerente no puede aprobar y llama a
 * soporte.
 *
 * `wholeCompany` no es un problema: es el alcance MAXIMO, y se cuenta porque es lo
 * que conviene revisar primero al auditar quien puede firmar de mas.
 */
function summarize(all: Authorizer[]): MatrixSummary {
  return {
    total: all.length,
    blocked: all.filter((a) => a.band.blocked).length,
    wholeCompany: all.filter((a) => a.coversWholeCompany).length,
    // Quien cubre toda la sociedad no depende de una asignacion, asi que no entra
    // aca aunque no tenga ningun CEBE vigente.
    withoutActiveProfitCenters: all.filter(
      (a) => !a.coversWholeCompany && a.activeProfitCenterCount === 0,
    ).length,
  };
}

function applyFilter(all: Authorizer[], filter: MatrixFilter): Authorizer[] {
  switch (filter) {
    case 'blocked':
      return all.filter((a) => a.band.blocked);
    case 'whole-company':
      return all.filter((a) => a.coversWholeCompany);
    case 'inactive-cebes':
      return all.filter((a) => !a.coversWholeCompany && a.activeProfitCenterCount === 0);
    default:
      return all;
  }
}

/** Busca por email, UserId, nivel de aprobacion o codigo de CEBE. */
function matches(search: string): (a: Authorizer) => boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return () => true;

  return (a) =>
    a.userEmail.toLowerCase().includes(needle) ||
    (a.userId ?? '').toLowerCase().includes(needle) ||
    (a.approvalLevel ?? '').toLowerCase().includes(needle) ||
    a.profitCenters.some(
      (pc) =>
        pc.code.toLowerCase().includes(needle) ||
        (pc.name ?? '').toLowerCase().includes(needle),
    );
}

/** Ordena in-place. Los nulos van al final en ASC, para que no tapen los datos reales. */
function sortAuthorizers(list: Authorizer[], sortBy: SortableField, sortDir: 'ASC' | 'DESC'): void {
  const dir = sortDir === 'DESC' ? -1 : 1;

  list.sort((a, b) => {
    const cmp = compare(a, b, sortBy);
    // Desempate estable por email: dos gerentes del mismo nivel no deben bailar entre
    // recargas de la misma pagina.
    return cmp !== 0 ? cmp * dir : a.userEmail.localeCompare(b.userEmail);
  });
}

function compare(a: Authorizer, b: Authorizer, sortBy: SortableField): number {
  switch (sortBy) {
    case 'minimumPercentage':
      return nullsLast(a.minimumPercentage, b.minimumPercentage);
    case 'maximumPercentage':
      return nullsLast(a.maximumPercentage, b.maximumPercentage);
    case 'profitCenterCount':
      return a.profitCenters.length - b.profitCenters.length;
    case 'userId':
      return (a.userId ?? '').localeCompare(b.userId ?? '');
    default:
      return a.userEmail.localeCompare(b.userEmail);
  }
}

function nullsLast(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

export type { AuthorizerProfitCenter };
