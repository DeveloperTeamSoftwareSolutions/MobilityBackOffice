import { describe, it, expect } from 'vitest';
import {
  bandHint,
  bandLabel,
  formatValidFrom,
  formatValidUntil,
  profitCenterLabel,
  scopeLabel,
} from './autorizadores.format';
import { AuthorizerProfitCenter, EffectiveBand } from './autorizadores.types';

function band(over: Partial<EffectiveBand> = {}): EffectiveBand {
  return { min: 10, max: 30, blocked: false, reason: null, ...over };
}

function pc(over: Partial<AuthorizerProfitCenter> = {}): AuthorizerProfitCenter {
  return { code: '1002', name: null, validFrom: null, validUntil: null, active: true, ...over };
}

/**
 * Estos tests fijan la traduccion de la matriz a castellano. Importan porque el dato
 * crudo miente: los valores que aca se traducen son los que, mostrados literal,
 * generarian el ticket que la seccion intenta evitar.
 */
describe('bandLabel', () => {
  it('la banda cerrada se lee como rango', () => {
    expect(bandLabel(band())).toBe('10% a 30%');
  });

  it('sin techo se lee "Desde"', () => {
    expect(bandLabel(band({ max: null }))).toBe('Desde 10%');
  });

  it('sin piso se lee "Hasta"', () => {
    expect(bandLabel(band({ min: null }))).toBe('Hasta 30%');
  });

  it('el 200/200 NUNCA se muestra como un porcentaje', () => {
    const label = bandLabel(band({ min: null, max: null, reason: 'sin_limite' }));
    expect(label).toBe('Sin límite');
    expect(label).not.toMatch(/200/);
  });

  it('el 0/0 se muestra como sin configurar, no como un rango de cero', () => {
    const label = bandLabel(band({ min: null, max: null, blocked: true, reason: 'sin_configurar' }));
    expect(label).toBe('Sin configurar');
    expect(label).not.toMatch(/0%/);
  });

  it('cada motivo de bloqueo tiene su texto', () => {
    expect(bandLabel(band({ blocked: true, reason: 'sin_fila' }))).toBe('Sin fila en la matriz');
    expect(bandLabel(band({ blocked: true, reason: 'sin_datos' }))).toBe('Límites incompletos');
    expect(bandLabel(band({ blocked: true, reason: 'rango_invertido' }))).toBe('Rango inválido');
  });
});

describe('bandHint', () => {
  it('un bloqueado aclara que igual puede rechazar', () => {
    expect(bandHint(band({ blocked: true, reason: 'sin_configurar' }))).toMatch(/solo rechazar/);
  });

  it('el sin-limite aclara su alcance', () => {
    expect(bandHint(band({ reason: 'sin_limite' }))).toMatch(/cualquier descuento/);
  });

  it('una banda normal no necesita aclaracion', () => {
    expect(bandHint(band())).toBeNull();
  });
});

describe('formatValidUntil', () => {
  it('el 9999-12-31 de SAP se lee "Sin vencimiento", no la fecha literal', () => {
    expect(formatValidUntil('9999-12-31T00:00:00.000Z')).toBe('Sin vencimiento');
    expect(formatValidUntil('9999-12-31')).toBe('Sin vencimiento');
  });

  it('el null tambien es sin vencimiento', () => {
    expect(formatValidUntil(null)).toBe('Sin vencimiento');
  });

  it('una fecha real se muestra en formato local', () => {
    expect(formatValidUntil('2026-08-27T00:00:00.000Z')).toBe('27/08/2026');
  });
});

describe('formatValidFrom', () => {
  it('sin fecha lo dice', () => {
    expect(formatValidFrom(null)).toBe('Sin fecha de inicio');
  });

  it('una fecha real se muestra en formato local', () => {
    expect(formatValidFrom('2023-08-09T00:00:00.000Z')).toBe('09/08/2023');
  });
});

describe('scopeLabel', () => {
  it('el comodin se lee "Toda la sociedad" y NO como vacio', () => {
    // Es el error mas facil de cometer con esta vista: la fila sin CEBE es la de MAYOR
    // alcance, no la de menor.
    expect(scopeLabel(true, [], 0)).toBe('Toda la sociedad');
  });

  it('sin CEBEs y sin comodin si es una ausencia', () => {
    expect(scopeLabel(false, [], 0)).toBe('Sin CEBEs asignados');
  });

  it('avisa cuando ninguno esta vigente', () => {
    expect(scopeLabel(false, [pc({ active: false })], 0)).toMatch(/ninguno vigente/);
  });

  it('distingue vigentes de totales cuando no coinciden', () => {
    const list = [pc({ code: 'A' }), pc({ code: 'B', active: false })];
    expect(scopeLabel(false, list, 1)).toBe('1 de 2 CEBE(s) vigentes');
  });

  it('si todos estan vigentes no repite el numero', () => {
    expect(scopeLabel(false, [pc({ code: 'A' }), pc({ code: 'B' })], 2)).toBe('2 CEBE(s)');
  });
});

describe('profitCenterLabel', () => {
  it('muestra codigo y nombre cuando el maestro lo tiene', () => {
    expect(profitCenterLabel(pc({ code: '1002', name: 'CEBE Central' }))).toBe('1002 · CEBE Central');
  });

  it('sin nombre queda el codigo solo', () => {
    expect(profitCenterLabel(pc({ code: '1002', name: null }))).toBe('1002');
  });
});
