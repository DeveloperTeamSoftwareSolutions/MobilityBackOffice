import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BadRequestException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CUSTOMER_GROUP_MESSAGES,
  MIN_MW_VERSION_CUSTOMER_GROUPS,
  NON_ASSIGNABLE_CUSTOMER_GROUP_CODES,
  mapAddGroupResult,
  mapGroupCustomer,
  mapGroupOption,
  mapRemoveGroupResult,
  mapReservedGroup,
  normalizeCustomerGroupCode,
  throwCustomerGroupError,
} from './customer-groups';

/** Error de axios con status y cuerpo, como lo recibe el client. */
const mwError = (status: number, data?: Record<string, unknown>) => ({
  response: { status, data },
});

function caught(err: unknown): HttpException {
  try {
    throwCustomerGroupError(err);
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('throwCustomerGroupError no lanzó');
}

describe('grupo de clientes — la regla del 37', () => {
  it('sólo el 37 es no asignable (decisión del negocio 2026-09-17)', () => {
    // Si aparece otro código, este test obliga a decidirlo a conciencia y a sumarlo también
    // al CHECK de la tabla y a la constante del middleware.
    expect(NON_ASSIGNABLE_CUSTOMER_GROUP_CODES).toEqual(['37']);
  });

  it('rechaza el 37 ANTES de llamar al middleware', () => {
    expect(() => normalizeCustomerGroupCode('37')).toThrow(BadRequestException);
    expect(() => normalizeCustomerGroupCode(' 37 ')).toThrow(/37/);
  });

  it('valida 1 o 2 caracteres y exige el código', () => {
    expect(() => normalizeCustomerGroupCode('')).toThrow(BadRequestException);
    expect(() => normalizeCustomerGroupCode(undefined)).toThrow(BadRequestException);
    expect(() => normalizeCustomerGroupCode('ABC')).toThrow(BadRequestException);
  });

  it('recorta espacios pero NO cambia mayúsculas ni la Ñ (el código se compara exacto)', () => {
    expect(normalizeCustomerGroupCode(' T3 ')).toBe('T3');
    expect(normalizeCustomerGroupCode('ÑE')).toBe('ÑE');
    expect(normalizeCustomerGroupCode('ne')).toBe('ne');
  });

  it('el buscador nunca marca el 37 como asignable, aunque el middleware lo dijera', () => {
    const opt = mapGroupOption({
      customerGroupCode: '37',
      customerGroupName: 'Clientes Terceros',
      customerCount: 17260,
      assignable: true,
    });
    expect(opt.assignable).toBe(false);
  });
});

describe('grupo de clientes — traducción de errores del middleware', () => {
  it('503 customer_groups_not_deployed → 503 que dice que no está disponible en el entorno', () => {
    const e = caught(mwError(503, { code: 'customer_groups_not_deployed', error: 'x' }));
    expect(e).toBeInstanceOf(ServiceUnavailableException);
    expect(e.message).toMatch(/no está disponible en este entorno/);
    expect(e.message).toMatch(/WarehouseCustomerGroups/);
  });

  it('404 sin code (middleware anterior) → 503 con el piso de versión', () => {
    const e = caught(mwError(404, undefined));
    expect(e).toBeInstanceOf(ServiceUnavailableException);
    expect(e.message).toMatch(/no está disponible en este entorno/);
    expect(e.message).toContain(`MW ≥ ${MIN_MW_VERSION_CUSTOMER_GROUPS}`);
  });

  it('404 warehouse_not_found → 404 real', () => {
    const e = caught(mwError(404, { code: 'warehouse_not_found', error: 'Warehouse not found' }));
    expect(e).toBeInstanceOf(NotFoundException);
  });

  it.each([
    ['customer_group_not_assignable', /37/],
    ['customer_group_without_customers', /no tiene clientes/],
    ['customer_group_code_invalid', /1 o 2 caracteres/],
    ['user_email_too_long', /demasiado largo/],
    ['user_id_too_long', /demasiado largo/],
    ['required_fields_missing', /inválidos/],
  ])('400 %s → 400 con mensaje en castellano', (code, message) => {
    // Se traduce por `code`, nunca por el texto: el `error` del middleware viene en inglés y
    // cambia con cualquier reescritura del otro lado.
    const e = caught(mwError(400, { code, error: 'english text' }));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.message).toMatch(message);
    expect(e.message).not.toMatch(/english/);
  });

  it('caída de red o 500 → 503 genérico', () => {
    expect(caught(new Error('ECONNREFUSED'))).toBeInstanceOf(ServiceUnavailableException);
    const e = caught(mwError(500, { error: 'boom' }));
    expect(e.message).toBe(CUSTOMER_GROUP_MESSAGES.unavailable);
  });
});

/**
 * Costura BackOffice ↔ middleware. Los fixtures copian la forma EXACTA que arman los mappers
 * del MW 1.357.0 (`warehouseCustomers.repository.js`). El mapper de acá tiene que devolver lo
 * mismo: si un campo se renombra de un lado, sale con su valor por defecto y `toEqual` lo
 * muestra en vez de dejarlo pasar en silencio.
 */
describe('costura: tipos de BackOffice ↔ contrato del middleware 1.357.0', () => {
  it('GET /groups', () => {
    const mw = {
      guid: '8C1F0E0A-2D8C-4E1B-9C1B-4B7F0F6A1E11',
      customerGroupCode: 'T3',
      customerGroupName: 'Ingenio El Angel',
      customerCount: 715,
      userId: null,
      userEmail: 'usuario@x.com',
      timeStamp: 1789660800000,
      serverTimestamp: 1789660800000,
    };
    expect(mapReservedGroup(mw)).toEqual(mw);
  });

  it('GET /group-search', () => {
    const mw = {
      customerGroupCode: 'A3',
      customerGroupName: 'Gpo Cia Azucarera',
      customerCount: 82,
      assignable: true,
    };
    expect(mapGroupOption(mw)).toEqual(mw);
  });

  it('GET /groups/customers', () => {
    const mw = { customerCode: '200029', customerName: 'Cliente SA' };
    expect(mapGroupCustomer(mw)).toEqual(mw);
  });

  it('POST /groups', () => {
    const mw = {
      warehouse: {
        guid: 'W-GUID',
        companyCode: '2100',
        centerCode: '2104',
        warehouseCode: '0001',
      },
      customerGroupCode: 'T3',
      customerGroupName: 'Ingenio El Angel',
      customerCount: 715,
      reactivated: false,
      alreadyExisted: false,
    };
    expect(mapAddGroupResult(mw)).toEqual(mw);
  });

  it('DELETE /groups', () => {
    const mw = { removed: true, stillRestricted: false };
    expect(mapRemoveGroupResult(mw)).toEqual(mw);
  });
});

describe('piso de versión del middleware para la reserva por grupo', () => {
  /**
   * Un piso mal puesto da por bueno un middleware que responde 404, y el usuario ve un error
   * crudo en lugar de "falta desplegar el MW". Tiene que coincidir con lo que promete el SPEC
   * de la sección, que es lo que lee quien planifica el deploy.
   */
  it('es una versión semántica completa y coincide con el SPEC de la sección', () => {
    expect(MIN_MW_VERSION_CUSTOMER_GROUPS).toMatch(/^\d+\.\d+\.\d+$/);

    const spec = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'docs', 'SPEC_BACKOFFICE_ALMACENES.md'),
      'utf8',
    );
    // Toda versión nombrada en una línea que habla del middleware tiene que ser ESTA.
    const pisos = spec
      .split(/\r?\n/)
      .filter((line) => /Middleware|MW/.test(line))
      .flatMap((line) => [...line.matchAll(/(\d+\.\d+\.\d+)/g)].map((m) => m[1]));

    expect(pisos.length).toBeGreaterThan(0);
    expect(new Set(pisos)).toEqual(new Set([MIN_MW_VERSION_CUSTOMER_GROUPS]));
  });
});
