import { describe, it, expect } from 'vitest';
import {
  blockingItemCount,
  destinationChanges,
  effectiveCenter,
  initialDrafts,
  itemWarnings,
  stockFor,
} from './revision-sap.logic';
import { ReviewCatalogs, ReviewItem } from './revision-sap.types';

/**
 * Lo que se fija acá es qué frena y qué solo avisa.
 *
 * Frena el destino vacío o de otra área de venta: SAP lo rechaza seguro y el servidor
 * tampoco lo acepta. El centro y el stock solo avisan: el centro no se edita todavía y
 * el stock lo revalida SAP (el equipo decidió permitir centros sin stock).
 */

const catalogs: ReviewCatalogs = {
  centers: [
    { centerCode: '2801', centerName: 'DW Alm. Externo' },
    { centerCode: '2802', centerName: 'DW Cartago' },
  ],
  destinations: [
    { destinationCode: '30000124', destinationName: 'Inversiones', deliveryAddress: null },
  ],
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

function kinds(i: ReviewItem, destination: string | null, header: string | null, cat = catalogs) {
  return itemWarnings(i, destination, header, cat).map((w) => [w.kind, w.blocking]);
}

describe('itemWarnings', () => {
  it('destino del área y centro permitido con stock: sin avisos', () => {
    expect(kinds(item(), '30000124', '2801')).toEqual([]);
  });

  it('destino vacío o de otra área bloquea', () => {
    expect(kinds(item(), null, '2801')).toEqual([['sin-destino', true]]);
    expect(kinds(item(), '30000112', '2801')).toEqual([['destino-fuera-del-area', true]]);
  });

  it('el centro de cabecera fuera de los permitidos avisa pero no bloquea', () => {
    expect(kinds(item(), '30000124', '2800')).toEqual([['centro-no-permitido', false]]);
  });

  it('sin stock o con stock insuficiente avisa pero no bloquea', () => {
    expect(kinds(item(), '30000124', '2802')).toEqual([['sin-stock', false]]);
    expect(kinds(item({ quantity: 500 }), '30000124', '2801')).toEqual([['stock-insuficiente', false]]);
  });

  it('si el stock no se sabe, no inventa un aviso de stock', () => {
    expect(kinds(item(), '30000124', '2802', { ...catalogs, stock: null })).toEqual([]);
    expect(kinds(item({ productCode: 'SIN-RESPUESTA' }), '30000124', '2802')).toEqual([]);
  });
});

describe('centro y stock', () => {
  it('la línea sin centro propio hereda el de la cabecera', () => {
    expect(effectiveCenter(item(), '2801')).toEqual({ code: '2801', inherited: true });
    expect(effectiveCenter(item({ centerCode: '2802' }), '2801')).toEqual({ code: '2802', inherited: false });
  });

  it('stockFor distingue "no se sabe" de "cero"', () => {
    expect(stockFor(null, '1001917', '2801')).toBeNull();
    expect(stockFor(catalogs.stock, 'OTRO', '2801')).toBeNull();
    expect(stockFor(catalogs.stock, '1001917', '2803')).toBe(0);
  });
});

describe('destinationChanges y blockingItemCount', () => {
  const items = [item(), item({ guid: 'item-2', lineNumber: 2, deliveryDestinationCode: '30000112' })];

  it('sin tocar nada no hay cambios, aunque la orden traiga un destino de otra área', () => {
    const drafts = initialDrafts(items);
    expect(destinationChanges(items, drafts)).toEqual([]);
    expect(blockingItemCount(items, drafts, '2801', catalogs)).toBe(1);
  });

  it('corregir el destino registra el cambio y destraba', () => {
    const drafts = { ...initialDrafts(items), 'item-2': '30000124' };
    const changes = destinationChanges(items, drafts);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ before: '30000112', after: '30000124' });
    expect(blockingItemCount(items, drafts, '2801', catalogs)).toBe(0);
  });
});
