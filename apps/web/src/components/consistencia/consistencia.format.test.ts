import { describe, it, expect } from 'vitest';
import {
  BOM,
  csvCell,
  formatAgo,
  humanizeRole,
  isoDate,
  reasonError,
  suggestionSourceLabel,
  toCsv,
} from './consistencia.format';

describe('humanizeRole', () => {
  it('quita el prefijo técnico y deja el nombre legible', () => {
    expect(humanizeRole('MOBILITY_2.0IA_WEB_VENDEDOR')).toBe('Vendedor');
    expect(humanizeRole('MOBILITYMGR_GERENTE_COMERCIAL')).toBe('Gerente comercial');
    expect(humanizeRole('Supervisor')).toBe('Supervisor');
  });
});

describe('formatAgo', () => {
  const now = 1_000_000_000;
  it('expresa el tiempo transcurrido', () => {
    expect(formatAgo(now - 10_000, now)).toBe('hace instantes');
    expect(formatAgo(now - 60_000, now)).toBe('hace 1 minuto');
    expect(formatAgo(now - 5 * 60_000, now)).toBe('hace 5 minutos');
    expect(formatAgo(now - 2 * 3_600_000, now)).toBe('hace 2 horas');
    expect(formatAgo(now - 86_400_000, now)).toBe('hace 1 día');
    expect(formatAgo(0, now)).toBe('—');
  });
});

describe('CSV', () => {
  it('escapa separador, comillas y saltos de línea', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('di "hola"')).toBe('"di ""hola"""');
    expect(csvCell('uno\ndos')).toBe('"uno\ndos"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(['x', 'y'])).toBe('x, y');
  });

  it('neutraliza lo que Excel ejecutaría como fórmula', () => {
    expect(csvCell('=SUMA(A1)')).toBe("'=SUMA(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
  });

  it('arma el archivo con BOM, encabezado y CRLF', () => {
    const csv = toCsv([{ a: 'x', b: 1 }], [
      { header: 'Col A', value: (r) => r.a },
      { header: 'Col B', value: (r) => r.b },
    ]);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.slice(1)).toBe('Col A;Col B\r\nx;1\r\n');
  });

  it('isoDate da aaaa-mm-dd local', () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('reasonError', () => {
  it('exige entre 5 y 500 caracteres', () => {
    expect(reasonError('')).toMatch(/Escribí el motivo/);
    expect(reasonError('abc')).toMatch(/al menos 5/);
    expect(reasonError('x'.repeat(501))).toMatch(/500/);
    expect(reasonError('Motivo correcto')).toBeNull();
  });
});

describe('suggestionSourceLabel', () => {
  it('traduce el origen de la sugerencia a texto para quien corrige', () => {
    expect(suggestionSourceLabel('CARTERA')).toBe('es el de su cartera');
    expect(suggestionSourceLabel('NOMBRE')).toContain('confirmalo');
  });

  it('un origen desconocido no muestra el codigo interno', () => {
    expect(suggestionSourceLabel('ALGO_NUEVO')).not.toContain('ALGO_NUEVO');
  });
});
