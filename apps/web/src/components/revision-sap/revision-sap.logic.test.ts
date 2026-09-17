import { describe, it, expect } from 'vitest';
import {
  blockingItemCount,
  cubreLaCantidad,
  effectiveCenter,
  initialDrafts,
  itemWarnings,
  lineChanges,
  parseSapError,
  salesAreaParts,
  sapErrorTypeLabel,
  sapOrdersByCenter,
  stockByCenter,
  stockFor,
} from './revision-sap.logic';
import { LineDraft, ProductStockRow, ReviewCatalogs, ReviewItem } from './revision-sap.types';

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

  /**
   * Sin lista de destinos no hay opinión. Si no se pudieron traer —la vista falta en esa
   * base, o el cliente no tiene ninguno cargado— la lista llega vacía y CUALQUIER destino
   * parecería "fuera del área": acusaría a todas las líneas de un problema inexistente y,
   * como ese aviso bloquea, no dejaría guardar ni el centro, que sí funciona.
   */
  it('si no hay lista de destinos, no acusa a la línea', () => {
    const sinDestinos = { ...catalogs, destinations: [] };
    expect(kinds(item(), draft('2801', '30000124'), '2800', sinDestinos)).toEqual([]);
    // Y lo que sí se puede saber se sigue avisando: el destino vacío es vacío igual.
    expect(kinds(item(), draft('2801', null), '2800', sinDestinos)).toEqual([['sin-destino', true]]);
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

/**
 * Elegir el centro DESDE el stock.
 *
 * Lo delicado es que "hay stock" y "se puede elegir" son cosas distintas: lo elegible
 * sale de los centros permitidos del cliente (4a), y un centro sin stock se elige igual
 * porque SAP revalida al enviar (4b). Mezclarlas dejaría al operador sin opciones
 * válidas o le ofrecería centros que el Middleware va a rechazar.
 */
describe('stockByCenter', () => {
  const centrosPermitidos = [
    { centerCode: '2801', centerName: 'DW Alm. Externo' },
    { centerCode: '2802', centerName: 'DW Cartago' },
  ];
  const fila = (over: Partial<ProductStockRow> = {}): ProductStockRow => ({
    centerCode: '2801', centerName: 'DW Alm. Externo', warehouseCode: '0100',
    warehouseName: 'Principal', unitOfMeasure: 'UN', available: 10,
    inInspection: 0, inTransit: 0, allowedForCustomer: true, ...over,
  });

  it('suma los almacenes de un mismo centro', () => {
    const r = stockByCenter(
      [fila({ available: 10 }), fila({ warehouseCode: '0200', available: 15 })],
      centrosPermitidos,
    );
    const c2801 = r.find((x) => x.centerCode === '2801');
    expect(c2801?.available).toBe(25);
    expect(c2801?.warehouses).toBe(2);
  });

  it('un centro con stock pero NO permitido no se puede elegir', () => {
    const r = stockByCenter([fila({ centerCode: '2900', available: 999 })], centrosPermitidos);
    expect(r.find((x) => x.centerCode === '2900')?.elegible).toBe(false);
  });

  it('un centro permitido SIN stock sí se puede elegir, en cero', () => {
    const r = stockByCenter([fila({ centerCode: '2801' })], centrosPermitidos);
    const c2802 = r.find((x) => x.centerCode === '2802');
    expect(c2802).toEqual(
      expect.objectContaining({ available: 0, warehouses: 0, elegible: true }),
    );
  });

  it('ordena: primero los elegibles, y entre ellos los de más stock', () => {
    const r = stockByCenter(
      [fila({ centerCode: '2900', available: 999 }), fila({ centerCode: '2801', available: 5 })],
      centrosPermitidos,
    );
    expect(r.map((x) => x.centerCode)).toEqual(['2801', '2802', '2900']);
  });

  it('dice si alcanza para lo que pide la línea, y admite no saberlo', () => {
    expect(cubreLaCantidad(40, 40)).toBe(true);
    expect(cubreLaCantidad(39, 40)).toBe(false);
    expect(cubreLaCantidad(0, null)).toBeNull();
  });
});

describe('motivo del rechazo de SAP', () => {
  it('separa el tipo del mensaje y parte las líneas que SAP une con |', () => {
    expect(
      parseSapError('[E] El material 1200135 no está ampliado. | [W] Verificá la extensión.'),
    ).toEqual([
      { type: 'E', message: 'El material 1200135 no está ampliado.' },
      { type: 'W', message: 'Verificá la extensión.' },
    ]);
  });

  it('un mensaje sin tipo se muestra igual, sin inventar uno', () => {
    expect(parseSapError('SAP no contestó')).toEqual([{ type: null, message: 'SAP no contestó' }]);
    expect(parseSapError(null)).toEqual([]);
    expect(parseSapError('   ')).toEqual([]);
  });

  it('el tipo se traduce a algo legible', () => {
    expect(sapErrorTypeLabel('E')).toBe('Error');
    expect(sapErrorTypeLabel('W')).toBe('Aviso');
    expect(sapErrorTypeLabel('X')).toBe('X');
    expect(sapErrorTypeLabel(null)).toBeNull();
  });
});

describe('área de venta', () => {
  it('muestra código y nombre, y solo el código si no hay maestro', () => {
    expect(
      salesAreaParts({
        companyCode: '2800',
        channelCode: '10',
        sectorCode: '99',
        companyName: 'Duwest Cafesa, S.A.',
        channelName: 'Clientes finales',
        sectorName: null,
      }).map((p) => p.value),
    ).toEqual(['2800 · Duwest Cafesa, S.A.', '10 · Clientes finales', '99']);
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
