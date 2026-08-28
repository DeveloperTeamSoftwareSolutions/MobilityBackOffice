import { describeBand, effectiveBand, isAssignmentActive } from './authorizers.band';

/**
 * Los casos limite estan tomados del middleware (`src/utils/approverLimits.js`), que es
 * el dueno de la regla. Esta suite es el contrato: si el middleware cambia la semantica
 * y esto no, la pantalla empieza a mentir y estos tests no lo detectan solos — pero al
 * menos dejan escrito contra que version se replico.
 */
describe('effectiveBand', () => {
  it('una banda normal se conserva tal cual', () => {
    expect(effectiveBand({ minimumPercentage: 10, maximumPercentage: 30 })).toEqual({
      min: 10,
      max: 30,
      blocked: false,
      reason: null,
    });
  });

  it('sin fila en la matriz bloquea', () => {
    expect(effectiveBand(null)).toEqual({
      min: null,
      max: null,
      blocked: true,
      reason: 'sin_fila',
    });
  });

  it('un extremo nulo bloquea: no se asume 0', () => {
    expect(effectiveBand({ minimumPercentage: null, maximumPercentage: 30 }).reason).toBe(
      'sin_datos',
    );
    expect(effectiveBand({ minimumPercentage: 10, maximumPercentage: null }).reason).toBe(
      'sin_datos',
    );
  });

  it('0/0 es "sin configurar" y bloquea', () => {
    const band = effectiveBand({ minimumPercentage: 0, maximumPercentage: 0 });
    expect(band.blocked).toBe(true);
    expect(band.reason).toBe('sin_configurar');
  });

  it('el rango invertido con extremos reales bloquea', () => {
    expect(effectiveBand({ minimumPercentage: 40, maximumPercentage: 20 }).reason).toBe(
      'rango_invertido',
    );
  });

  describe('centinela >= 100 = sin limite en ese extremo', () => {
    it('ambos extremos: firma todo', () => {
      const band = effectiveBand({ minimumPercentage: 200, maximumPercentage: 200 });
      expect(band).toEqual({ min: null, max: null, blocked: false, reason: 'sin_limite' });
    });

    it('999.99 tambien es centinela', () => {
      expect(effectiveBand({ minimumPercentage: 999.99, maximumPercentage: 999.99 }).reason).toBe(
        'sin_limite',
      );
    });

    it('100 exacto ya es centinela', () => {
      expect(effectiveBand({ minimumPercentage: 100, maximumPercentage: 100 }).reason).toBe(
        'sin_limite',
      );
    });

    it('solo el minimo: queda sin piso, con techo real', () => {
      expect(effectiveBand({ minimumPercentage: 200, maximumPercentage: 50 })).toEqual({
        min: null,
        max: 50,
        blocked: false,
        reason: null,
      });
    });

    it('200/50 NO es rango invertido: el centinela se resuelve primero', () => {
      expect(effectiveBand({ minimumPercentage: 200, maximumPercentage: 50 }).blocked).toBe(false);
    });

    it('solo el maximo: queda con piso, sin techo', () => {
      expect(effectiveBand({ minimumPercentage: 15, maximumPercentage: 100 })).toEqual({
        min: 15,
        max: null,
        blocked: false,
        reason: null,
      });
    });
  });
});

describe('describeBand', () => {
  it('explica cada motivo de bloqueo en castellano', () => {
    expect(describeBand(effectiveBand(null))).toMatch(/no puede firmar/);
    expect(describeBand(effectiveBand({ minimumPercentage: 0, maximumPercentage: 0 }))).toMatch(
      /Sin configurar/,
    );
    expect(describeBand(effectiveBand({ minimumPercentage: 40, maximumPercentage: 20 }))).toMatch(
      /Rango inválido/,
    );
  });

  it('el sin-limite no se muestra como un porcentaje', () => {
    expect(describeBand(effectiveBand({ minimumPercentage: 200, maximumPercentage: 200 }))).toBe(
      'Sin límite: firma cualquier descuento',
    );
  });

  it('las bandas abiertas de un lado se leen como tales', () => {
    expect(describeBand(effectiveBand({ minimumPercentage: 200, maximumPercentage: 50 }))).toBe(
      'Hasta 50%',
    );
    expect(describeBand(effectiveBand({ minimumPercentage: 15, maximumPercentage: 100 }))).toBe(
      'Desde 15%',
    );
  });

  it('la banda cerrada se lee como rango', () => {
    expect(describeBand(effectiveBand({ minimumPercentage: 10, maximumPercentage: 30 }))).toBe(
      '10% a 30%',
    );
  });
});

describe('isAssignmentActive', () => {
  const hoy = new Date('2026-08-27T12:00:00Z');

  it('sin fechas esta vigente', () => {
    expect(isAssignmentActive(null, null, hoy)).toBe(true);
  });

  it('los bordes son inclusivos', () => {
    expect(isAssignmentActive('2026-08-27', '2026-08-27', hoy)).toBe(true);
  });

  it('todavia no empezo', () => {
    expect(isAssignmentActive('2026-08-28', null, hoy)).toBe(false);
  });

  it('ya vencio', () => {
    expect(isAssignmentActive(null, '2026-08-26', hoy)).toBe(false);
  });

  it('acepta el datetime completo que manda SQL Server', () => {
    expect(isAssignmentActive('2026-01-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z', hoy)).toBe(
      true,
    );
  });
});
