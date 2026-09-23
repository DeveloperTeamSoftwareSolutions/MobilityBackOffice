import { describe, it, expect } from 'vitest';
import {
  blockingItemCount,
  cubreLaCantidad,
  draftsTrasRecarga,
  effectiveCenter,
  groupSapOrdersByAttempt,
  initialDrafts,
  itemWarnings,
  lineChanges,
  parseSapError,
  salesAreaParts,
  sapErrorTypeLabel,
  planResend,
  sapOrdersByCenter,
  sourceLabel,
  stockByCenter,
  stockFor,
} from './revision-sap.logic';
import {
  LineDraft,
  ProductStockRow,
  ReviewCatalogs,
  ReviewItem,
  SapOrder,
} from './revision-sap.types';

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
    cancelledAt: null,
    cancelledBy: null,
    noSaleReasonCode: null,
    noSaleReasonNotes: null,
    ...over,
  };
}

/** Una línea cancelada: no viaja a SAP, pero sigue en la orden. */
function cancelada(over: Partial<ReviewItem> = {}): ReviewItem {
  return item({
    cancelledAt: '2026-09-22T10:00:00.000Z',
    cancelledBy: 'bo@duwest.com',
    noSaleReasonCode: 'SIN_STOCK',
    noSaleReasonNotes: null,
    ...over,
  });
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
    // Heredar el de la cabecera son DOS avisos, y ninguno bloquea: desde el Middleware
    // 1.374.0 el envío hereda ese centro, así que es un dato —de dónde sale la línea— y
    // no un error. El segundo agrega que, además, ese centro no está permitido.
    expect(kinds(item(), draft(null, '30000124'), '2800')).toEqual([
      ['sin-centro-propio', false],
      ['centro-de-cabecera-no-permitido', false],
    ]);
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

  /**
   * Cancelar la línea problemática tiene que DESTRABAR la orden — es para lo que sirve.
   * Si su aviso siguiera bloqueando, cancelarla no serviría de nada.
   */
  it('una línea cancelada deja de bloquear el envío', () => {
    // Con centro propio, para que lo único que bloquee sea el destino que falta: sin eso,
    // la regla del 2026-09-23 (sin centro propio bloquea) sumaría un aviso a cada línea y
    // este test dejaría de medir lo suyo.
    const rota = { guid: 'item-1', lineNumber: 1, centerCode: '2801', deliveryDestinationCode: null };
    const sana = { guid: 'item-2', lineNumber: 2, centerCode: '2801' };
    const items = [item(rota), item(sana)];
    expect(blockingItemCount(items, initialDrafts(items), '2801', catalogs)).toBe(1);

    const conCancelada = [cancelada(rota), item(sana)];
    expect(blockingItemCount(conCancelada, initialDrafts(conCancelada), '2801', catalogs)).toBe(0);
  });

  /**
   * Una línea cancelada NO cuenta para el envío. Si contara, aparecería un centro que no
   * va a salir — y con todas las líneas de un centro canceladas, ese centro no existe.
   */
  it('las líneas canceladas no cuentan para las órdenes SAP', () => {
    const items = [
      item(),
      item({ guid: 'item-2', lineNumber: 2 }),
      cancelada({ guid: 'item-3', lineNumber: 3 }),
    ];
    const drafts = { ...initialDrafts(items), 'item-3': draft('2802', '30000124') };
    expect(sapOrdersByCenter(items, drafts, '2801')).toEqual([{ centerCode: '2801', lines: [1, 2] }]);

    // Y con todas canceladas no queda ningún centro: no hay nada que enviar.
    const todas = items.map((i) => cancelada({ guid: i.guid, lineNumber: i.lineNumber }));
    expect(sapOrdersByCenter(todas, initialDrafts(todas), '2801')).toEqual([]);
  });
});

/**
 * LA PREVISUALIZACIÓN del reenvío (pedido 2026-09-22): "que salga un modal informando
 * cómo van a salir las órdenes SAP (tantas como centros de distribución) con sus
 * respectivos productos (excluyendo los cancelados), el número de intento".
 *
 * Se calcula en el navegador porque las dos reglas —partir por centro, excluir las
 * canceladas— ya están acá. Lo delicado es que tiene que mostrar lo que el usuario ESTÁ
 * POR mandar, no lo que está guardado: si movió una línea de centro y no guardó, mostrarle
 * el centro viejo convertiría la confirmación en una trampa.
 */
describe('planResend', () => {
  const centers = catalogs.centers;

  it('agrupa por centro, con los productos de cada orden SAP', () => {
    const items = [
      item({ guid: 'item-1', lineNumber: 1 }),
      item({ guid: 'item-2', lineNumber: 2 }),
      item({ guid: 'item-3', lineNumber: 3, centerCode: '2802' }),
    ];
    const plan = planResend(items, initialDrafts(items), '2801', centers, 1);

    expect(plan.orders).toHaveLength(2);
    expect(plan.orders[0]).toMatchObject({ centerCode: '2801', centerName: 'DW Alm. Externo' });
    expect(plan.orders[0].items.map((i) => i.lineNumber)).toEqual([1, 2]);
    expect(plan.orders[1]).toMatchObject({ centerCode: '2802', centerName: 'DW Cartago' });
    expect(plan.orders[1].items.map((i) => i.lineNumber)).toEqual([3]);
    expect(plan.itemCount).toBe(3);
    expect(plan.cancelledCount).toBe(0);
  });

  it('el intento es el siguiente al último que se hizo', () => {
    const items = [item()];
    expect(planResend(items, initialDrafts(items), '2801', centers, 0).attemptNumber).toBe(1);
    expect(planResend(items, initialDrafts(items), '2801', centers, 2).attemptNumber).toBe(3);
  });

  it('las canceladas quedan afuera y se cuentan aparte', () => {
    const items = [item(), cancelada({ guid: 'item-2', lineNumber: 2 })];
    const plan = planResend(items, initialDrafts(items), '2801', centers, 1);

    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0].items.map((i) => i.lineNumber)).toEqual([1]);
    expect(plan.cancelledCount).toBe(1);
    expect(plan.itemCount).toBe(1);
  });

  /** El caso que hace rebotar el envío: sin líneas activas no sale ninguna orden SAP. */
  it('con todo cancelado no queda ninguna orden SAP', () => {
    const items = [cancelada(), cancelada({ guid: 'item-2', lineNumber: 2 })];
    const plan = planResend(items, initialDrafts(items), '2801', centers, 1);

    expect(plan.orders).toEqual([]);
    expect(plan.itemCount).toBe(0);
    expect(plan.cancelledCount).toBe(2);
  });

  /**
   * Toma los DRAFTS, no lo guardado. Sin esto, el usuario confirmaría un envío distinto
   * del que está mirando.
   */
  it('usa el centro sin guardar, no el que está en el servidor', () => {
    const items = [item({ guid: 'item-1', lineNumber: 1, centerCode: '2801' })];
    const drafts = { 'item-1': draft('2802', '30000124') };
    const plan = planResend(items, drafts, '2801', centers, 0);

    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0].centerCode).toBe('2802');
  });

  /** Un centro que no está en el catálogo sale igual: esconderlo sería peor que no nombrarlo. */
  it('un centro desconocido se muestra sin nombre, no se oculta', () => {
    const items = [item({ guid: 'item-1', lineNumber: 1, centerCode: '9999' })];
    const plan = planResend(items, initialDrafts(items), '2801', centers, 0);

    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0]).toMatchObject({ centerCode: '9999', centerName: null });
  });
});

/**
 * Separar las órdenes SAP POR INTENTO (pedido 2026-09-22).
 *
 * Una orden puede tener órdenes SAP de varios envíos: el del vendedor desde MobilityIA y
 * los reenvíos de BackOffice, que además crean UNA POR CENTRO. Mostrarlas en una sola
 * lista las hace parecer una tanda; hay que saber cuáles salieron juntas.
 *
 * Lo delicado es que no hay un "id de envío" guardado: se deduce. Estos tests fijan las
 * reglas de esa deducción, que es donde puede fallar en silencio.
 */
describe('groupSapOrdersByAttempt', () => {
  const orden = (over: Partial<SapOrder> = {}): SapOrder => ({
    guid: 'sap-' + Math.random().toString(36).slice(2, 8),
    status: 'accepted',
    statusCode: 'Authorized',
    orderNumber: 'ORD475S1',
    source: 'backoffice',
    centerCode: '2105',
    centerName: null,
    attemptAt: '2026-09-21T20:39:01.055Z',
    sapOrderNumber: '0002489380',
    sapDispatchNumber: '0082948112',
    error: null,
    items: [],
    ...over,
  });

  /** El caso real de la orden 475: un envío del vendedor y un reenvío que salió en dos. */
  it('separa el envío del vendedor del reenvío de BackOffice', () => {
    const intentos = groupSapOrdersByAttempt([
      orden({ centerCode: '2105', attemptAt: '2026-09-21T20:39:01.185Z' }),
      orden({ centerCode: '2104', attemptAt: '2026-09-21T20:39:01.055Z' }),
      orden({
        source: 'mobilityia',
        orderNumber: 'ORD475',
        centerCode: null,
        attemptAt: '2026-09-21T12:53:56.690Z',
      }),
    ]);

    expect(intentos).toHaveLength(2);
    expect(intentos[0].source).toBe('backoffice');
    expect(intentos[0].orders).toHaveLength(2);
    expect(intentos[1].source).toBe('mobilityia');
    expect(intentos[1].orders).toHaveLength(1);
  });

  /**
   * El envío del vendedor manda la orden ENTERA en una sola orden SAP, así que dos filas
   * suyas son siempre dos intentos — aunque caigan con segundos de diferencia.
   */
  it('dos envíos del vendedor nunca se fusionan', () => {
    const intentos = groupSapOrdersByAttempt([
      orden({ source: 'mobilityia', centerCode: null, attemptAt: '2026-09-21T12:53:56Z' }),
      orden({ source: 'mobilityia', centerCode: null, attemptAt: '2026-09-21T12:53:50Z' }),
    ]);
    expect(intentos).toHaveLength(2);
  });

  /**
   * Un centro repetido es la señal más fuerte de que hay otro envío: el de BackOffice
   * crea UNA orden SAP por centro, así que dentro de un mismo envío no se repite.
   */
  it('un centro que se repite abre un intento nuevo, aunque sea el mismo minuto', () => {
    const intentos = groupSapOrdersByAttempt([
      orden({ centerCode: '2105', attemptAt: '2026-09-21T20:39:05Z' }),
      orden({ centerCode: '2105', attemptAt: '2026-09-21T20:39:01Z' }),
    ]);
    expect(intentos).toHaveLength(2);
  });

  /** Dos reenvíos separados en el tiempo, aunque usen centros distintos. */
  it('una diferencia grande de tiempo separa los intentos', () => {
    const intentos = groupSapOrdersByAttempt([
      orden({ centerCode: '2105', attemptAt: '2026-09-21T20:39:00Z' }),
      orden({ centerCode: '2104', attemptAt: '2026-09-21T14:00:00Z' }),
    ]);
    expect(intentos).toHaveLength(2);
  });

  /**
   * Pero SAP puede tardar: el envío llama una vez por centro, en serie, con hasta 120 s
   * cada una. Dos minutos de diferencia siguen siendo el mismo envío.
   */
  it('una demora de SAP no parte un envío en dos', () => {
    const intentos = groupSapOrdersByAttempt([
      orden({ centerCode: '2105', attemptAt: '2026-09-21T20:41:00Z' }),
      orden({ centerCode: '2104', attemptAt: '2026-09-21T20:39:00Z' }),
    ]);
    expect(intentos).toHaveLength(1);
    expect(intentos[0].orders).toHaveLength(2);
    // La fecha del intento es la más reciente de sus órdenes.
    expect(intentos[0].attemptAt).toBe('2026-09-21T20:41:00Z');
  });

  it('sin órdenes SAP no hay intentos', () => {
    expect(groupSapOrdersByAttempt([])).toEqual([]);
  });

  it('una fecha ausente no rompe la agrupación', () => {
    const intentos = groupSapOrdersByAttempt([
      orden({ centerCode: '2105', attemptAt: null }),
      orden({ centerCode: '2104', attemptAt: null }),
    ]);
    expect(intentos).toHaveLength(1);
  });

  it('cada app se nombra como la conoce el operador', () => {
    expect(sourceLabel('mobilityia')).toBe('MobilityIA');
    expect(sourceLabel('backoffice')).toBe('BackOffice');
  });

  /**
   * `source` existe desde el Middleware 1.368.0. Contra uno anterior llega `undefined` y
   * hay que deducirlo del CENTRO, que es la misma huella del otro lado: el envío del
   * vendedor no guarda `CenterCode` en la fila de SAPOrders; el de BackOffice sí, una
   * por centro.
   *
   * Sin este respaldo, todas se leen como del vendedor —que nunca agrupa— y cada orden
   * SAP aparece como un intento suelto. Es el caso real de la orden 475 contra el
   * middleware 1.367.0.
   */
  describe('si el middleware es viejo y no manda el origen', () => {
    const sinOrigen = (over: Partial<SapOrder> = {}) => ({
      ...orden(over),
      source: undefined as unknown as SapOrder['source'],
    });

    it('con centro se deduce BackOffice, y agrupan', () => {
      const intentos = groupSapOrdersByAttempt([
        sinOrigen({ centerCode: '2105', attemptAt: '2026-09-21T20:39:01.185Z' }),
        sinOrigen({ centerCode: '2104', attemptAt: '2026-09-21T20:39:01.055Z' }),
      ]);

      expect(intentos).toHaveLength(1);
      expect(intentos[0].source).toBe('backoffice');
    });

    it('sin centro se deduce MobilityIA', () => {
      const intentos = groupSapOrdersByAttempt([sinOrigen({ centerCode: null })]);
      expect(intentos[0].source).toBe('mobilityia');
      expect(sourceLabel(intentos[0].source)).toBe('MobilityIA');
    });

    /** El caso completo de la orden 475: un envío del vendedor y un reenvío en dos. */
    it('la orden 475 se lee bien igual: dos intentos, no tres', () => {
      const intentos = groupSapOrdersByAttempt([
        sinOrigen({ centerCode: '2105', attemptAt: '2026-09-21T20:39:01.185Z' }),
        sinOrigen({ centerCode: '2104', attemptAt: '2026-09-21T20:39:01.055Z' }),
        sinOrigen({ centerCode: null, attemptAt: '2026-09-21T12:53:56.690Z' }),
      ]);

      expect(intentos).toHaveLength(2);
      expect(intentos[0].source).toBe('backoffice');
      expect(intentos[0].orders).toHaveLength(2);
      expect(intentos[1].source).toBe('mobilityia');
      expect(intentos[1].orders).toHaveLength(1);
    });
  });
});

/**
 * Separar las órdenes SAP POR INTENTO (pedido 2026-09-22).
 *
 * Una orden puede tener órdenes SAP de varios envíos: el del vendedor desde MobilityIA y
 * los reenvíos de BackOffice, que además crean UNA POR CENTRO. Mostrarlas en una sola
 * lista las hace parecer una tanda; hay que saber cuáles salieron juntas.
 *
 * Lo delicado es que no hay un "id de envío" guardado: se deduce. Estos tests fijan las
 * reglas de esa deducción, que es donde puede fallar en silencio.
 */
describe('groupSapOrdersByAttempt', () => {
  const orden = (over: Partial<SapOrder> = {}): SapOrder => ({
    guid: 'sap-' + Math.random().toString(36).slice(2, 8),
    status: 'accepted',
    statusCode: 'Authorized',
    orderNumber: 'ORD475S1',
    source: 'backoffice',
    centerCode: '2105',
    centerName: null,
    attemptAt: '2026-09-21T20:39:01.055Z',
    sapOrderNumber: '0002489380',
    sapDispatchNumber: '0082948112',
    error: null,
    items: [],
    ...over,
  });

  /** El caso real de la orden 475: un envío del vendedor y un reenvío que salió en dos. */
  it('separa el envío del vendedor del reenvío de BackOffice', () => {
    const intentos = groupSapOrdersByAttempt([
      orden({ centerCode: '2105', attemptAt: '2026-09-21T20:39:01.185Z' }),
      orden({ centerCode: '2104', attemptAt: '2026-09-21T20:39:01.055Z' }),
      orden({
        source: 'mobilityia',
        orderNumber: 'ORD475',
        centerCode: null,
        attemptAt: '2026-09-21T12:53:56.690Z',
      }),
    ]);

    expect(intentos).toHaveLength(2);
    expect(intentos[0].source).toBe('backoffice');
    expect(intentos[0].orders).toHaveLength(2);
    expect(intentos[1].source).toBe('mobilityia');
    expect(intentos[1].orders).toHaveLength(1);
  });

  /**
   * El envío del vendedor manda la orden ENTERA en una sola orden SAP, así que dos filas
   * suyas son siempre dos intentos — aunque caigan con segundos de diferencia.
   */
  it('dos envíos del vendedor nunca se fusionan', () => {
    const intentos = groupSapOrdersByAttempt([
      orden({ source: 'mobilityia', centerCode: null, attemptAt: '2026-09-21T12:53:56Z' }),
      orden({ source: 'mobilityia', centerCode: null, attemptAt: '2026-09-21T12:53:50Z' }),
    ]);
    expect(intentos).toHaveLength(2);
  });

  /**
   * Un centro repetido es la señal más fuerte de que hay otro envío: el de BackOffice
   * crea UNA orden SAP por centro, así que dentro de un mismo envío no se repite.
   */
  it('un centro que se repite abre un intento nuevo, aunque sea el mismo minuto', () => {
    const intentos = groupSapOrdersByAttempt([
      orden({ centerCode: '2105', attemptAt: '2026-09-21T20:39:05Z' }),
      orden({ centerCode: '2105', attemptAt: '2026-09-21T20:39:01Z' }),
    ]);
    expect(intentos).toHaveLength(2);
  });

  /** Dos reenvíos separados en el tiempo, aunque usen centros distintos. */
  it('una diferencia grande de tiempo separa los intentos', () => {
    const intentos = groupSapOrdersByAttempt([
      orden({ centerCode: '2105', attemptAt: '2026-09-21T20:39:00Z' }),
      orden({ centerCode: '2104', attemptAt: '2026-09-21T14:00:00Z' }),
    ]);
    expect(intentos).toHaveLength(2);
  });

  /**
   * Pero SAP puede tardar: el envío llama una vez por centro, en serie, con hasta 120 s
   * cada una. Dos minutos de diferencia siguen siendo el mismo envío.
   */
  it('una demora de SAP no parte un envío en dos', () => {
    const intentos = groupSapOrdersByAttempt([
      orden({ centerCode: '2105', attemptAt: '2026-09-21T20:41:00Z' }),
      orden({ centerCode: '2104', attemptAt: '2026-09-21T20:39:00Z' }),
    ]);
    expect(intentos).toHaveLength(1);
    expect(intentos[0].orders).toHaveLength(2);
    // La fecha del intento es la más reciente de sus órdenes.
    expect(intentos[0].attemptAt).toBe('2026-09-21T20:41:00Z');
  });

  it('sin órdenes SAP no hay intentos', () => {
    expect(groupSapOrdersByAttempt([])).toEqual([]);
  });

  it('una fecha ausente no rompe la agrupación', () => {
    const intentos = groupSapOrdersByAttempt([
      orden({ centerCode: '2105', attemptAt: null }),
      orden({ centerCode: '2104', attemptAt: null }),
    ]);
    expect(intentos).toHaveLength(1);
  });

  it('cada app se nombra como la conoce el operador', () => {
    expect(sourceLabel('mobilityia')).toBe('MobilityIA');
    expect(sourceLabel('backoffice')).toBe('BackOffice');
  });

  /**
   * `source` existe desde el Middleware 1.368.0. Contra uno anterior llega `undefined` y
   * hay que deducirlo del CENTRO, que es la misma huella del otro lado: el envío del
   * vendedor no guarda `CenterCode` en la fila de SAPOrders; el de BackOffice sí, una
   * por centro.
   *
   * Sin este respaldo, todas se leen como del vendedor —que nunca agrupa— y cada orden
   * SAP aparece como un intento suelto. Es el caso real de la orden 475 contra el
   * middleware 1.367.0.
   */
  describe('si el middleware es viejo y no manda el origen', () => {
    const sinOrigen = (over: Partial<SapOrder> = {}) => ({
      ...orden(over),
      source: undefined as unknown as SapOrder['source'],
    });

    it('con centro se deduce BackOffice, y agrupan', () => {
      const intentos = groupSapOrdersByAttempt([
        sinOrigen({ centerCode: '2105', attemptAt: '2026-09-21T20:39:01.185Z' }),
        sinOrigen({ centerCode: '2104', attemptAt: '2026-09-21T20:39:01.055Z' }),
      ]);

      expect(intentos).toHaveLength(1);
      expect(intentos[0].source).toBe('backoffice');
    });

    it('sin centro se deduce MobilityIA', () => {
      const intentos = groupSapOrdersByAttempt([sinOrigen({ centerCode: null })]);
      expect(intentos[0].source).toBe('mobilityia');
      expect(sourceLabel(intentos[0].source)).toBe('MobilityIA');
    });

    /** El caso completo de la orden 475: un envío del vendedor y un reenvío en dos. */
    it('la orden 475 se lee bien igual: dos intentos, no tres', () => {
      const intentos = groupSapOrdersByAttempt([
        sinOrigen({ centerCode: '2105', attemptAt: '2026-09-21T20:39:01.185Z' }),
        sinOrigen({ centerCode: '2104', attemptAt: '2026-09-21T20:39:01.055Z' }),
        sinOrigen({ centerCode: null, attemptAt: '2026-09-21T12:53:56.690Z' }),
      ]);

      expect(intentos).toHaveLength(2);
      expect(intentos[0].source).toBe('backoffice');
      expect(intentos[0].orders).toHaveLength(2);
      expect(intentos[1].source).toBe('mobilityia');
      expect(intentos[1].orders).toHaveLength(1);
    });
  });
});

describe('lineChanges y blockingItemCount', () => {
  const items = [item(), item({ guid: 'item-2', lineNumber: 2, deliveryDestinationCode: '30000112' })];

  it('sin tocar nada no hay cambios, aunque la orden traiga un destino de otra área', () => {
    const drafts = initialDrafts(items);
    expect(lineChanges(items, drafts)).toEqual([]);
    // Sólo el destino de otra área. Que las líneas hereden el centro de la cabecera ya no
    // bloquea: el envío lo hereda (Middleware 1.374.0).
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

/**
 * DOS PROBLEMAS DE LOS SELECTS DE CENTRO Y DESTINO (reportados 2026-09-23).
 *
 * 1. Sin tocar los selects, reenviar fallaba con
 *    "Este endpoint agrupa por CenterCode y 1 item(s) no lo tienen".
 *    La pantalla ofrecía "mismo de la cabecera" como si fuera válido, pero el envío
 *    agrupa por el centro de CADA LÍNEA y no hereda el de la cabecera.
 *
 * 2. Si cambiabas el centro de un producto y después cancelabas otro, el primero volvía
 *    solo a su centro original: recargar la orden hacía `initialDrafts` y descartaba en
 *    silencio TODOS los cambios sin guardar. Pasaba igual con el destino.
 */
describe('el centro propio de cada línea', () => {
  /**
   * Desde el Middleware 1.374.0 el envío hereda el centro de la cabecera. El aviso queda,
   * porque el operador tiene que poder ver DE DÓNDE va a salir cada línea, pero ya no
   * traba: pedir el centro a mano en el 68% de las líneas era trabajo que el propio envío
   * resuelve, y un aviso que salta siempre deja de leerse.
   */
  it('sin centro propio avisa de qué centro sale, y no bloquea', () => {
    const avisos = itemWarnings(item({ centerCode: null }), draft(null, '30000124'), '2801', catalogs);
    const aviso = avisos.find((w) => w.kind === 'sin-centro-propio');

    expect(aviso).toBeTruthy();
    expect(aviso?.blocking).toBe(false);
    // Dice cuál, no sólo que falta: es el dato que el operador necesita para decidir.
    expect(aviso?.message).toMatch(/2801/);
    expect(aviso?.message).toMatch(/cabecera/);
  });

  /** Lo único que sigue trabando: no hay centro en la línea NI en la cabecera. */
  it('sin centro en la línea ni en la cabecera sí bloquea: no hay de dónde heredar', () => {
    const avisos = itemWarnings(item({ centerCode: null }), draft(null, '30000124'), null, catalogs);
    const aviso = avisos.find((w) => w.kind === 'sin-centro-propio');

    expect(aviso?.blocking).toBe(true);
    expect(aviso?.message).toMatch(/la cabecera tampoco/);
  });

  it('con centro propio no molesta', () => {
    const avisos = itemWarnings(item({ centerCode: '2801' }), draft('2801', '30000124'), '2801', catalogs);
    expect(avisos.some((w) => w.kind === 'sin-centro-propio')).toBe(false);
  });

  /** Elegir el MISMO centro que la cabecera ya es tener centro propio: se guarda. */
  it('elegir el de la cabecera explícitamente alcanza', () => {
    const avisos = itemWarnings(item({ centerCode: null }), draft('2801', '30000124'), '2801', catalogs);
    expect(avisos.some((w) => w.kind === 'sin-centro-propio')).toBe(false);
  });

  it('una línea sin centro propio ya no bloquea el envío', () => {
    const items = [item({ guid: 'item-1', centerCode: null })];
    expect(blockingItemCount(items, initialDrafts(items), '2801', catalogs)).toBe(0);
    // Pero sin cabecera de dónde heredar, sí.
    expect(blockingItemCount(items, initialDrafts(items), null, catalogs)).toBe(1);
  });

  /** La previsualización tiene que DECIRLO, no mostrarlas como si fueran a salir. */
  it('la previsualización cuenta las líneas que heredan el centro', () => {
    const items = [
      item({ guid: 'item-1', lineNumber: 1, centerCode: null }),
      item({ guid: 'item-2', lineNumber: 2, centerCode: '2802' }),
    ];
    const plan = planResend(items, initialDrafts(items), '2801', catalogs.centers, 0);

    const cabecera = plan.orders.find((o) => o.centerCode === '2801');
    const propio = plan.orders.find((o) => o.centerCode === '2802');
    expect(cabecera?.heredados).toBe(1);
    expect(propio?.heredados).toBe(0);
  });
});

describe('draftsTrasRecarga — lo que el usuario venía editando no se pierde', () => {
  const previos = [
    item({ guid: 'item-1', lineNumber: 1, centerCode: '2801' }),
    item({ guid: 'item-2', lineNumber: 2, centerCode: '2801' }),
  ];

  /** EL CASO REPORTADO: cambio el centro de una, cancelo otra, y la primera no se toca. */
  it('conserva el centro cambiado de otra línea al recargar', () => {
    const drafts = { ...initialDrafts(previos), 'item-1': draft('2802', '30000124') };
    // item-2 vuelve cancelada; item-1 llega igual que antes.
    const frescos = [previos[0], cancelada({ guid: 'item-2', lineNumber: 2, centerCode: '2801' })];

    const next = draftsTrasRecarga(frescos, previos, drafts);
    expect(next['item-1'].centerCode).toBe('2802');
  });

  it('hace lo mismo con el destino', () => {
    const drafts = { ...initialDrafts(previos), 'item-1': draft('2801', '30000999') };
    const next = draftsTrasRecarga(previos, previos, drafts);
    expect(next['item-1'].destinationCode).toBe('30000999');
  });

  /** Sin cambios pendientes gana el servidor: es lo que evita pisar lo que guardó otro. */
  it('una línea sin tocar toma el valor fresco del servidor', () => {
    const drafts = initialDrafts(previos);
    const frescos = [item({ guid: 'item-1', lineNumber: 1, centerCode: '2802' }), previos[1]];

    const next = draftsTrasRecarga(frescos, previos, drafts);
    expect(next['item-1'].centerCode).toBe('2802');
  });

  it('una línea nueva arranca con lo que trae el servidor', () => {
    const frescos = [...previos, item({ guid: 'item-3', lineNumber: 3, centerCode: '2802' })];
    const next = draftsTrasRecarga(frescos, previos, initialDrafts(previos));
    expect(next['item-3'].centerCode).toBe('2802');
  });

  it('una línea que ya no está desaparece de los drafts', () => {
    const next = draftsTrasRecarga([previos[0]], previos, initialDrafts(previos));
    expect(Object.keys(next)).toEqual(['item-1']);
  });
});
