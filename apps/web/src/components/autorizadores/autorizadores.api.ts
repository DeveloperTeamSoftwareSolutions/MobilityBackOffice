import { httpClient } from '../../api/httpClient';
import {
  AuthorizersPage,
  AvailableCompany,
  CountryManagersResult,
  MatrixQuery,
} from './autorizadores.types';

interface ApiData<T> {
  success: boolean;
  data: T;
}

/** Typeahead de sociedades. Sin sociedad elegida no hay matriz que pedir. */
export async function searchCompanies(q: string): Promise<AvailableCompany[]> {
  const res = await httpClient.get<ApiData<AvailableCompany[]>>('/api/authorizers/companies', {
    params: { q, limit: 20 },
  });
  return res.data.data;
}

/** La matriz de una sociedad, agrupada por autorizador. */
export async function getMatrix(query: MatrixQuery): Promise<AuthorizersPage> {
  const res = await httpClient.get<{ success: boolean } & AuthorizersPage>('/api/authorizers', {
    params: {
      companyCode: query.companyCode,
      page: query.page,
      limit: query.limit,
      search: query.search || undefined,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      filter: query.filter === 'all' ? undefined : query.filter,
      activeOnly: query.activeOnly ? '1' : undefined,
    },
  });
  return {
    data: res.data.data,
    pagination: res.data.pagination,
    summary: res.data.summary,
  };
}

/**
 * Country Managers de la sociedad.
 *
 * Van aparte de la matriz a propósito: es otro permiso, con otra fuente y sin banda.
 */
export async function getCountryManagers(companyCode: string): Promise<CountryManagersResult> {
  const res = await httpClient.get<{ success: boolean } & CountryManagersResult>(
    '/api/authorizers/country-managers',
    { params: { companyCode } },
  );
  return { available: res.data.available, data: res.data.data };
}
