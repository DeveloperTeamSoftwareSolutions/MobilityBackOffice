import { of, throwError } from 'rxjs';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ConsistencyClient } from './consistency.client';
import { WriteContext } from './consistency.types';

/**
 * Lo que fija este archivo es la promesa de las correcciones: **decir si el cambio quedó
 * o no**. El middleware aplica cada corrección en una transacción, así que una respuesta
 * de error significa que no se aplicó. Solo sin respuesta (red, tiempo) no se sabe, y
 * decir "no se aplicó" ahí invitaría a repetir un alta que quizás ya existe.
 */

const MEMBER = '11111111-2222-3333-4444-555555555555';
const CTX: WriteContext = {
  actorEmail: 'admin@duwest.com',
  reason: 'Alta pendiente del reporte',
  findingGroup: 'CARTERA_SIN_JERARQUIA',
};

function make() {
  const http = { get: jest.fn(), post: jest.fn(), put: jest.fn() } as unknown as HttpService;
  const config = {
    get: (k: string) =>
      ({ 'middleware.url': 'http://mw:6002/api/', 'middleware.apiKey': 'k' })[k],
  } as unknown as ConfigService;
  return { client: new ConsistencyClient(http, config), http };
}

const httpError = (status: number, code?: string) => ({
  response: { status, data: code ? { success: false, error: 'x', code } : undefined },
});

describe('ConsistencyClient — lecturas', () => {
  it('pasa solo los filtros presentes y el export al middleware, con la api key', async () => {
    const { client, http } = make();
    (http.get as jest.Mock).mockReturnValue(
      of({ data: { success: true, data: [], companies: ['2100'], generatedAt: 1, pagination: { total: 0, page: 2, limit: 10, totalPages: 1 } } }),
    );
    const res = await client.listFindings({
      page: 2, limit: 10, group: 'CARTERA_SIN_JERARQUIA', companyCode: '2100',
      sortBy: 'severity', sortDir: 'ASC', exportAll: true, refresh: false,
    });
    const [url, opts] = (http.get as jest.Mock).mock.calls[0];
    expect(url).toBe('http://mw:6002/api/mobility/backoffice-consistency/findings');
    expect(opts.params).toEqual({
      page: '2', limit: '10', sortBy: 'severity', sortDir: 'ASC',
      group: 'CARTERA_SIN_JERARQUIA', companyCode: '2100', export: '1',
    });
    expect(opts.headers).toMatchObject({ 'x-api-key': 'k', 'x-source-app': 'MobilityBackOffice' });
    expect(res.companies).toEqual(['2100']);
  });

  it('brechas de clientes: un 404 del middleware es "no disponible", no un error', async () => {
    const { client, http } = make();
    (http.get as jest.Mock).mockReturnValue(throwError(() => httpError(404)));
    const res = await client.listCustomerGaps({ page: 1, limit: 20, sortDir: 'ASC', exportAll: false });
    expect(res).toEqual({
      available: false, data: [], summary: {},
      pagination: { total: 0, page: 1, limit: 20, totalPages: 1 },
    });
  });

  it('brechas de clientes: cualquier otro fallo es 503', async () => {
    const { client, http } = make();
    (http.get as jest.Mock).mockReturnValue(throwError(() => httpError(500)));
    await expect(
      client.listCustomerGaps({ page: 1, limit: 20, sortDir: 'ASC', exportAll: false }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('un fallo de lectura no expone el detalle del middleware', async () => {
    const { client, http } = make();
    (http.get as jest.Mock).mockReturnValue(throwError(() => httpError(500)));
    await expect(client.getSummary(false)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('ConsistencyClient — correcciones', () => {
  it('el alta manda el actor y el motivo en el body, y el afectado con sus nombres propios', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(of({ data: { success: true, data: { guid: 'g' } } }));
    await client.createMember(
      {
        guidCommercialTeamHierarchies: MEMBER, memberSapUserId: '2100218', memberName: 'ANA',
        role: 'Vendedor', memberGuidUsers: null,
      },
      CTX,
    );
    const [url, body] = (http.post as jest.Mock).mock.calls[0];
    expect(url).toBe('http://mw:6002/api/mobility/backoffice-consistency/members');
    expect(body).toEqual({
      guidCommercialTeamHierarchies: MEMBER, memberSapUserId: '2100218', memberName: 'ANA',
      role: 'Vendedor', memberGuidUsers: null,
      actorEmail: 'admin@duwest.com', reason: 'Alta pendiente del reporte',
      findingGroup: 'CARTERA_SIN_JERARQUIA',
    });
    // Nunca `sapUserId`/`guidUsers`/`email`: el middleware los tomaría como el actor.
    expect(Object.keys(body)).not.toEqual(expect.arrayContaining(['sapUserId']));
    expect(body).not.toHaveProperty('guidUsers');
    expect(body).not.toHaveProperty('email');
  });

  it('corregir el usuario SAP viaja por PUT con el valor esperado, aunque sea null', async () => {
    const { client, http } = make();
    (http.put as jest.Mock).mockReturnValue(of({ data: { success: true, data: {} } }));
    await client.changeMemberSapUserId(
      { guid: MEMBER, memberSapUserId: '5200077', expectedSapUserId: null },
      { ...CTX, findingGroup: null },
    );
    const [url, body] = (http.put as jest.Mock).mock.calls[0];
    expect(url).toBe(`http://mw:6002/api/mobility/backoffice-consistency/members/${MEMBER}/sap-user-id`);
    expect(body).toEqual({
      memberSapUserId: '5200077', expectedSapUserId: null,
      actorEmail: 'admin@duwest.com', reason: 'Alta pendiente del reporte',
    });
  });

  it.each([
    ['MEMBER_ALREADY_IN_NODE', 'ya está en ese nodo'],
    ['STALE_MEMBER', 'cambió desde que se listó'],
    ['PORTFOLIO_HAS_OWNER', 'ya tiene un dueño comercial'],
  ])('409 %s se traduce por code a un mensaje en castellano', async (code, texto) => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(throwError(() => httpError(409, code)));
    const err = await client.removeMember(MEMBER, CTX).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toContain(texto);
  });

  it('404 dice qué ya no existe', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(throwError(() => httpError(404, 'MEMBER_NOT_FOUND')));
    const err = await client.removeMember(MEMBER, CTX).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.message).toContain('ya no está en la jerarquía');
  });

  it('400 del middleware: no se aplicó', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(throwError(() => httpError(400, 'INVALID_ROLE')));
    const err = await client.removeMember(MEMBER, CTX).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('No se aplicó ningún cambio');
  });

  it('401: es la credencial y no se aplicó nada', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(throwError(() => httpError(401)));
    const err = await client.removeMember(MEMBER, CTX).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.message).toContain('credencial');
    expect(err.message).toContain('No se aplicó ningún cambio');
  });

  it('500 con respuesta: la transacción se deshizo, no se aplicó', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(throwError(() => httpError(500)));
    const err = await client.removeMember(MEMBER, CTX).catch((e) => e);
    expect(err.message).toContain('No se aplicó ningún cambio');
  });

  it('sin respuesta (tiempo, red): NO dice que no se aplicó, pide revisar antes de reintentar', async () => {
    const { client, http } = make();
    (http.post as jest.Mock).mockReturnValue(throwError(() => ({ code: 'ECONNABORTED' })));
    const err = await client.removeMember(MEMBER, CTX).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.message).toContain('no se sabe si la corrección se aplicó');
    expect(err.message).not.toContain('No se aplicó ningún cambio');
  });
});
