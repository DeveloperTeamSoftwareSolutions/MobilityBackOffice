import { describe, it, expect, vi, afterEach } from 'vitest';
import { AxiosError, AxiosResponse } from 'axios';
import { httpClient } from '../../api/httpClient';
import {
  apiErrorMessage,
  createMember,
  customerGapsParams,
  findingsParams,
  fixMemberSapUserId,
  isConflict,
  listCustomerGaps,
  listFindings,
  listNodes,
} from './consistencia.api';

afterEach(() => {
  vi.restoreAllMocks();
});

function axiosError(status: number, data: unknown): AxiosError {
  return new AxiosError('fallo', String(status), undefined, undefined, {
    status,
    data,
  } as AxiosResponse);
}

describe('findingsParams', () => {
  it('manda sólo los filtros con valor', () => {
    expect(
      findingsParams({
        category: 'CARTERA',
        group: null,
        resolution: null,
        companyCode: '',
        search: '   ',
        page: 3,
        limit: 25,
        sortBy: 'severity',
        sortDir: 'ASC',
      }),
    ).toEqual({ category: 'CARTERA', page: 3, limit: 25, sortBy: 'severity', sortDir: 'ASC' });
  });

  it('incluye grupo, resolución, sociedad, búsqueda y refresh', () => {
    expect(
      findingsParams({
        category: 'JERARQUIA',
        group: 'CARTERA_SIN_JERARQUIA',
        resolution: 'BACKOFFICE',
        companyCode: '2800',
        search: ' perez ',
        page: 1,
        limit: 20,
        sortBy: 'personName',
        sortDir: 'DESC',
        refresh: true,
      }),
    ).toEqual({
      category: 'JERARQUIA',
      group: 'CARTERA_SIN_JERARQUIA',
      resolution: 'BACKOFFICE',
      companyCode: '2800',
      search: 'perez',
      page: 1,
      limit: 20,
      sortBy: 'personName',
      sortDir: 'DESC',
      refresh: 1,
    });
  });

  it('la exportación pide todo desde la página 1 con el tope de 50000', () => {
    const p = findingsParams({
      category: 'USUARIOS_SAP',
      page: 4,
      limit: 20,
      sortBy: 'group',
      sortDir: 'ASC',
      exportAll: true,
    });
    expect(p).toMatchObject({ export: 1, page: 1, limit: 50000 });
  });
});

describe('customerGapsParams', () => {
  it('arma filtros y exportación', () => {
    expect(
      customerGapsParams({ gapType: 'VE_SIN_CARTERA', companyCode: '2800', search: 'x', page: 2, limit: 10 }),
    ).toEqual({ gapType: 'VE_SIN_CARTERA', companyCode: '2800', search: 'x', page: 2, limit: 10, sortDir: 'ASC' });
    expect(customerGapsParams({ page: 5, limit: 10, exportAll: true })).toEqual({
      page: 1,
      limit: 50000,
      sortDir: 'ASC',
      export: 1,
    });
  });
});

describe('lecturas', () => {
  it('listFindings desenvuelve datos, sociedades y paginación', async () => {
    const get = vi.spyOn(httpClient, 'get').mockResolvedValue({
      data: {
        success: true,
        data: [{ key: 'k1' }],
        companies: ['2800'],
        generatedAt: 123,
        pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
      },
    });
    const r = await listFindings({
      category: 'CARTERA',
      page: 1,
      limit: 20,
      sortBy: 'severity',
      sortDir: 'ASC',
    });
    expect(get).toHaveBeenCalledWith('/api/consistency/findings', {
      params: { category: 'CARTERA', page: 1, limit: 20, sortBy: 'severity', sortDir: 'ASC' },
    });
    expect(r.data).toEqual([{ key: 'k1' }]);
    expect(r.companies).toEqual(['2800']);
    expect(r.generatedAt).toBe(123);
    expect(r.pagination.total).toBe(1);
  });

  it('listNodes devuelve nodos y roles', async () => {
    vi.spyOn(httpClient, 'get').mockResolvedValue({
      data: { success: true, data: [{ guid: 'n1' }], roles: ['Vendedor'] },
    });
    expect(await listNodes()).toEqual({ nodes: [{ guid: 'n1' }], roles: ['Vendedor'] });
  });

  it('listCustomerGaps con available:false no es un error', async () => {
    vi.spyOn(httpClient, 'get').mockResolvedValue({ data: { success: true, available: false } });
    const r = await listCustomerGaps({ page: 1, limit: 10 });
    expect(r.available).toBe(false);
    expect(r.data).toEqual([]);
    expect(r.summary).toEqual({});
  });

  it('listCustomerGaps disponible trae filas y resumen', async () => {
    vi.spyOn(httpClient, 'get').mockResolvedValue({
      data: {
        success: true,
        available: true,
        data: [{ gapType: 'VE_SIN_CARTERA' }],
        summary: { VE_SIN_CARTERA: { rows: 1, customers: 1, sellers: 1 } },
        pagination: { total: 1, page: 1, limit: 10, totalPages: 1 },
      },
    });
    const r = await listCustomerGaps({ page: 1, limit: 10 });
    expect(r.available).toBe(true);
    expect(r.summary.VE_SIN_CARTERA?.rows).toBe(1);
  });
});

describe('escrituras', () => {
  it('createMember postea el cuerpo tal cual y desenvuelve data', async () => {
    const post = vi.spyOn(httpClient, 'post').mockResolvedValue({ data: { success: true, data: { guid: 'm1' } } });
    const body = {
      guidCommercialTeamHierarchies: 'n1',
      memberSapUserId: 'U1',
      memberName: 'Ana',
      role: 'Vendedor',
      reason: 'Motivo válido',
      findingGroup: 'CARTERA_SIN_JERARQUIA' as const,
    };
    expect(await createMember(body)).toEqual({ guid: 'm1' });
    expect(post).toHaveBeenCalledWith('/api/consistency/members', body);
  });

  it('fixMemberSapUserId codifica el guid en la ruta', async () => {
    const put = vi.spyOn(httpClient, 'put').mockResolvedValue({ data: { success: true, data: null } });
    await fixMemberSapUserId('a/b', { memberSapUserId: 'U2', expectedSapUserId: null, reason: 'Motivo' });
    expect(put).toHaveBeenCalledWith('/api/consistency/members/a%2Fb/sap-user-id', {
      memberSapUserId: 'U2',
      expectedSapUserId: null,
      reason: 'Motivo',
    });
  });
});

describe('apiErrorMessage', () => {
  it('usa message del servidor, sea texto o lista', () => {
    expect(apiErrorMessage(axiosError(400, { message: 'El motivo es obligatorio.' }), 'x')).toBe(
      'El motivo es obligatorio.',
    );
    expect(apiErrorMessage(axiosError(400, { message: ['Uno.', 'Dos.'] }), 'x')).toBe('Uno. · Dos.');
  });

  it('usa error si no hay message', () => {
    expect(apiErrorMessage(axiosError(404, { success: false, error: 'No existe el miembro.' }), 'x')).toBe(
      'No existe el miembro.',
    );
  });

  it('409 sin cuerpo explica el conflicto y se detecta como tal', () => {
    const err = axiosError(409, {});
    expect(apiErrorMessage(err, 'x')).toMatch(/modificó este dato/);
    expect(isConflict(err)).toBe(true);
    expect(isConflict(axiosError(400, {}))).toBe(false);
  });

  it('un error que no es HTTP usa el genérico', () => {
    expect(apiErrorMessage(new Error('boom'), 'Genérico.')).toBe('Genérico.');
  });
});
