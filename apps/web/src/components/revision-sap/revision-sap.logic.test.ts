import { describe, it, expect } from 'vitest';
import {
  blockingItemCount,
  changedItems,
  filterQueue,
  initialAssignments,
  itemWarnings,
} from './revision-sap.logic';
import { ReviewCatalogs, ReviewItem, ReviewQueueEntry } from './revision-sap.types';

/**
 * Lo que se fija acá es qué frena el reenvío y qué solo avisa.
 *
 * El equipo decidió que se pueda elegir un centro sin stock (SAP lo revalida con el
 * stock real), pero no un centro fuera de los permitidos del cliente ni un destino
 * de otra área de venta: esos SAP los rechaza seguro, y reenviarlos solo suma otro
 * intento fallido.
 */

const catalogs: ReviewCatalogs = {
  centers: [
    { centerCode: '2101', centerName: 'CD Villa Nueva' },
    { centerCode: '2102', centerName: 'CD Escuintla' },
  ],
  destinations: [
    { destinationCode: '30001187', destinationName: 'Bodega central', deliveryAddress: null },
  ],
  stock: { '100245': { '2101': 320, '2102': 10 } },
};

function item(over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    guid: 'item-1',
    lineNumber: 1,
    productCode: '100245',
    productName: 'Glifosato',
    quantity: 40,
    unitOfMeasure: 'UN',
    centerCode: '2101',
    destinationCode: '30001187',
    ...over,
  };
}

function kinds(i: ReviewItem, centerCode: string | null, destinationCode: string | null) {
  return itemWarnings(i, { centerCode, destinationCode }, catalogs).map((w) => [
    w.kind,
    w.blocking,
  ]);
}

describe('itemWarnings', () => {
  it('un centro permitido con stock y un destino del área no generan avisos', () => {
    expect(kinds(item(), '2101', '30001187')).toEqual([]);
  });

  it('un centro sin registro de stock avisa pero no bloquea', () => {
    expect(kinds(item({ productCode: 'OTRO' }), '2101', '30001187')).toEqual([
      ['sin-stock', false],
    ]);
  });

  it('stock menor que la cantidad pedida avisa pero no bloquea', () => {
    expect(kinds(item(), '2102', '30001187')).toEqual([['stock-insuficiente', false]]);
  });

  it('un centro fuera de los permitidos del cliente bloquea', () => {
    expect(kinds(item(), '2803', '30001187')).toEqual([['centro-no-permitido', true]]);
  });

  it('un destino de otra área de venta bloquea', () => {
    expect(kinds(item(), '2101', '30000877')).toEqual([['destino-fuera-del-area', true]]);
  });

  it('sin centro ni destino bloquea por los dos', () => {
    expect(kinds(item(), null, null)).toEqual([
      ['sin-centro', true],
      ['sin-destino', true],
    ]);
  });
});

describe('changedItems y blockingItemCount', () => {
  const items = [
    item(),
    item({ guid: 'item-2', lineNumber: 2, centerCode: '2803' }),
  ];

  it('sin tocar nada no hay cambios, aunque la orden traiga un dato inválido', () => {
    const assignments = initialAssignments(items);
    expect(changedItems(items, assignments)).toEqual([]);
    expect(blockingItemCount(items, assignments, catalogs)).toBe(1);
  });

  it('corregir el centro inválido registra el cambio y libera el reenvío', () => {
    const assignments = {
      ...initialAssignments(items),
      'item-2': { centerCode: '2101', destinationCode: '30001187' },
    };
    const changes = changedItems(items, assignments);
    expect(changes).toHaveLength(1);
    expect(changes[0].before.centerCode).toBe('2803');
    expect(changes[0].after.centerCode).toBe('2101');
    expect(blockingItemCount(items, assignments, catalogs)).toBe(0);
  });
});

describe('filterQueue', () => {
  const entries = [
    { orderNumber: 'ORD-1', customerCode: '100', customerName: 'Finca La Esperanza', sellerEmail: 'ana@x.com' },
    { orderNumber: 'ORD-2', customerCode: '200', customerName: 'Agro Norte', sellerEmail: 'luis@x.com' },
  ] as ReviewQueueEntry[];

  it('busca por número, cliente y vendedor sin distinguir mayúsculas', () => {
    expect(filterQueue(entries, 'esperanza').map((e) => e.orderNumber)).toEqual(['ORD-1']);
    expect(filterQueue(entries, 'LUIS@').map((e) => e.orderNumber)).toEqual(['ORD-2']);
    expect(filterQueue(entries, '  ')).toHaveLength(2);
  });
});
