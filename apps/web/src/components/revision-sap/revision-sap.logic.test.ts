import { describe, it, expect } from 'vitest';
import {
  blockingItemCount,
  effectiveCenter,
  initialDrafts,
  itemWarnings,
  lineChanges,
  sapOrdersByCenter,
  stockFor,
} from './revision-sap.logic';
import { LineDraft, ReviewCatalogs, ReviewItem } from './revision-sap.types';

/**
 * Lo que se fija acá es qué frena y qué solo avisa.
 *
 * Frenan lo que el servidor también rechaza: destino vacío o de otra área, y un centro
 * elegido que no está permitido para el cliente (decisión 4a). Solo avisan el centro
 * heredado de la cabecera y el stock, que SAP revalida (decisión 4b).
 */

const catalogs: ReviewCatalogs = {
  centers: [
    { centerCode: '2801', centerName: 'DW Alm. Externo' },
    { centerCode: '2802', centerName: 'DW Cartago' },
  ],
  destinations: [{ destinationCode: '30000124', destinationName: 'Inversiones', deliveryAddress: null }],
  stock: { '1001917': { '2801': 320, '2802': 0 } },
  errors: [],
};

function item(over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    guid: 'item-1',
    lineNumber: 1,
    productCode: '1001917',
    productDescription: 'ACTIV 80',
    quantity: 40,
    unitOfMeasure: 'UN',
    centerCode: null,
    deliveryDestinationCode: '30000124',
    deliveryDestinationName: 'Inversiones',
    ...over,
  };
}

const draft = (centerCode: string | null, destinationCode: string | null): LineDraft => ({
  centerCode,
  destinationCode,
});

function kinds(i: ReviewItem, d: LineDraft, header: string | null, cat = catalogs) {
  return itemWarnings(i, d, header, cat).map((w) => [w.kind, w.blocking]);
}

describe('itemWarnings', () => {
  it('destino del área y centro permitido con stock: sin avisos', () => {
    expect(kinds(item(), draft('2801', '30000124'), '2800')).toEqual([]);
  });

  it('destino vacío o de otra área bloquea', () => {
    expect(kinds(item(), draft('2801', null), '2800')).toEqual([['sin-destino', true]]);
    expect(kinds(item(), draft('2801', '30000112'), '2800')).toEqual([['destino-fuera-del-area', true]]);
  });

  it('un centro ELEGIDO no permitido bloquea; el heredado de la cabecera solo avisa', () => {
    expect(kinds(item(), draft('2899', '30000124'), '2801')).toEqual([['centro-no-permitido', true]]);
    expect(kinds(item(), draft(null, '30000124'), '2800')).toEqual([['centro-de-cabecera-no-permitido', false]]);
  });

  it('sin stock o con stock insuficiente avisa pero no bloquea', () => {
    expect(kinds(item(), draft('2802', '30000124'), '2800')).toEqual([['sin-stock', false]]);
    expect(kinds(item({ quantity: 500 }), draft('2801', '30000124'), '2800')).toEqual([['stock-insuficiente', false]]);
  });

  it('si el stock no se sabe, no inventa un aviso de stock', () => {
    expect(kinds(item(), draft('2802', '30000124'), '2800', { ...catalogs, stock: null })).toEqual([]);
    expect(kinds(item({ productCode: 'SIN-RESPUESTA' }), draft('2802', '30000124'), '2800')).toEqual([]);
  });
});

describe('centro y stock', () => {
  it('sin centro elegido, la línea sale con el de la cabecera', () => {
    expect(effectiveCenter(null, '2801')).toEqual({ code: '2801', inherited: true });
    expect(effectiveCenter('2802', '2801')).toEqual({ code: '2802', inherited: false });
  });

  it('stockFor distingue "no se sabe" de "cero"', () => {
    expect(stockFor(null, '1001917', '2801')).toBeNull();
    expect(stockFor(catalogs.stock, 'OTRO', '2801')).toBeNull();
    expect(stockFor(catalogs.stock, '1001917', '2803')).toBe(0);
  });

  it('una orden SAP por cada centro distinto, contando el heredado', () => {
    const items = [item(), item({ guid: 'item-2', lineNumber: 2 }), item({ guid: 'item-3', lineNumber: 3 })];
    const drafts = { ...initialDrafts(items), 'item-3': draft('2802', '30000124') };
    expect(sapOrdersByCenter(items, drafts, '2801')).toEqual([
      { centerCode: '2801', lines: [1, 2] },
      { centerCode: '2802', lines: [3] },
    ]);
  });
});

describe('lineChanges y blockingItemCount', () => {
  const items = [item(), item({ guid: 'item-2', lineNumber: 2, deliveryDestinationCode: '30000112' })];

  it('sin tocar nada no hay cambios, aunque la orden traiga un destino de otra área', () => {
    const drafts = initialDrafts(items);
    expect(lineChanges(items, drafts)).toEqual([]);
    expect(blockingItemCount(items, drafts, '2801', catalogs)).toBe(1);
  });

  it('centro y destino de una misma línea son dos cambios, y corregir destraba', () => {
    const drafts = { ...initialDrafts(items), 'item-2': draft('2802', '30000124') };
    const changes = lineChanges(items, drafts);
    expect(changes.map((c) => [c.field, c.before, c.after])).toEqual([
      ['center', null, '2802'],
      ['destination', '30000112', '30000124'],
    ]);
    expect(blockingItemCount(items, drafts, '2801', catalogs)).toBe(0);
  });
});
