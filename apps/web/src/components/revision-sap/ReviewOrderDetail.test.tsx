import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReviewOrderDetail } from './ReviewOrderDetail';
import { ResendModal } from './ResendModal';
import {
  ProductStock,
  ResendBucket,
  ResendResult,
  ReviewCatalogs,
  ReviewOrderDetail as Detail,
  SapOrder,
} from './revision-sap.types';

/**
 * Lo que se fija acá: el detalle son DOS pestañas con papeles distintos.
 *
 * "Productos" es la orden tal como se va a reenviar: ahí se corrige el centro y el
 * destino de CADA línea, sin importar en qué orden SAP cayó. "Órdenes SAP" es el
 * historial de cada intento y es solo consulta: ningún selector y ningún botón.
 *
 * El reenvío es de la orden COMPLETA (confirmado con el equipo el 2026-09-17), así que
 * su botón vive en la barra de acciones, fuera de las dos pestañas.
 */

const ORDER = '11111111-2222-3333-4444-555555555555';

function order(over: Partial<Detail> = {}): Detail {
  return {
    guid: ORDER,
    orderNumber: 'ORD00005729',
    statusCode: 'Processed',
    customerCode: '10002523',
    customerName: 'CONVENIO DE VENTAS DEMASA',
    sellerEmail: 'vendedor@duwest.com',
    sellerName: 'Vendedor',
    salesArea: {
      companyCode: '2800',
      channelCode: '10',
      sectorCode: '10',
      companyName: 'Duwest Cafesa, S.A.',
      channelName: 'Clientes finales',
      sectorName: 'Protec de Cultivo',
    },
    centerCode: '2801',
    centerName: 'DW Alm. Externo',
    destination: '30000124',
    orderDate: '2026-09-15T15:30:46.046Z',
    cancelledAt: null,
    groupInvoice: false,
    sap: {
      orderNumber: null,
      lastError: '[E] El material 1200135 no está ampliado para el centro 2802. | [W] Verificá la extensión.',
      lastAttemptAt: '2026-09-15T16:00:00Z',
    },
    backoffice: { inReview: true, decidedBy: null, decidedAt: null },
    items: [
      {
        guid: 'item-1',
        lineNumber: 1,
        productCode: '1200183',
        productDescription: 'AMISTAR 50 WG',
        quantity: 1,
        unitOfMeasure: 'PI',
        centerCode: '2801',
        deliveryDestinationCode: '30000124',
        deliveryDestinationName: 'Inversiones',
      },
      {
        guid: 'item-3',
        lineNumber: 3,
        productCode: '1200135',
        productDescription: 'AGROKIN V 200LT',
        quantity: 1,
        unitOfMeasure: 'L',
        centerCode: '2802',
        deliveryDestinationCode: '30000124',
        deliveryDestinationName: 'Inversiones',
      },
    ],
    sapAttempts: [
      { guid: 'a1', attemptAt: '2026-09-15T16:00:00Z', statusCode: 'Draft', error: '[E] El material 1200135 no está ampliado para el centro 2802.' },
    ],
    ...over,
  };
}

const sapOrders: SapOrder[] = [
  {
    guid: 'sap-ok',
    status: 'accepted',
    statusCode: 'Authorized',
    // Las dos salieron del MISMO envío de BackOffice: mismo número base, sufijo distinto
    // por centro. Es lo que las agrupa en un solo intento.
    orderNumber: 'ORD00005729S1',
    source: 'backoffice',
    centerCode: '2801',
    centerName: 'DW Alm. Externo',
    attemptAt: '2026-09-15T16:00:00Z',
    sapOrderNumber: '0099900101',
    sapDispatchNumber: '0089900101',
    error: null,
    items: [
      {
        lineNumber: 1,
        productCode: '1200183',
        description: 'AMISTAR 50 WG',
        quantity: 1,
        unitOfMeasure: 'PI',
        itemGuid: 'item-1',
        centerCode: '2801',
        deliveryDestinationCode: '30000124',
        deliveryDestinationName: 'Inversiones',
      },
    ],
  },
  {
    guid: 'sap-rej',
    status: 'rejected',
    statusCode: 'Draft',
    orderNumber: 'ORD00005729S2',
    source: 'backoffice',
    centerCode: '2802',
    centerName: 'DW Cartago',
    attemptAt: '2026-09-15T16:00:00Z',
    sapOrderNumber: null,
    sapDispatchNumber: null,
    error: '[E] El material 1200135 no está ampliado para el centro 2802.',
    items: [
      {
        lineNumber: 3,
        productCode: '1200135',
        description: 'AGROKIN V 200LT',
        quantity: 1,
        unitOfMeasure: 'L',
        itemGuid: 'item-3',
        centerCode: '2802',
        deliveryDestinationCode: '30000124',
        deliveryDestinationName: 'Inversiones',
      },
    ],
  },
];

const catalogs: ReviewCatalogs = {
  centers: [
    { centerCode: '2801', centerName: 'DW Alm. Externo' },
    { centerCode: '2802', centerName: 'DW Cartago' },
  ],
  destinations: [
    { destinationCode: '30000124', destinationName: 'Inversiones', deliveryAddress: 'Cañas' },
    { destinationCode: '10019279', destinationName: 'Lobo Cruz', deliveryAddress: 'Upala' },
  ],
  stock: null,
  errors: [],
};

const stock: ProductStock = {
  productCode: '1200135',
  companyCode: '2800',
  unitOfMeasure: 'L',
  totals: { available: 2000, availableForCustomer: 2000, centers: 1 },
  rows: [
    {
      centerCode: '2802',
      centerName: 'DW Cartago',
      warehouseCode: '0020',
      warehouseName: 'Mat / P. Ter',
      unitOfMeasure: 'L',
      available: 2000,
      inInspection: 0,
      inTransit: 0,
      allowedForCustomer: true,
    },
  ],
  errors: [],
};

const api = vi.hoisted(() => ({
  getReviewOrder: vi.fn(),
  getReviewCatalogs: vi.fn(),
  listSapOrders: vi.fn(),
  changeItemDestination: vi.fn(),
  changeItemCenter: vi.fn(),
  changeGroupInvoice: vi.fn(),
  rejectOrder: vi.fn(),
  resendToSap: vi.fn(),
  getProductStock: vi.fn(),
}));

vi.mock('./revision-sap.api', () => ({
  getReviewOrder: api.getReviewOrder,
  getReviewCatalogs: api.getReviewCatalogs,
  listSapOrders: api.listSapOrders,
  changeItemDestination: api.changeItemDestination,
  changeItemCenter: api.changeItemCenter,
  changeGroupInvoice: api.changeGroupInvoice,
  rejectOrder: api.rejectOrder,
  resendToSap: api.resendToSap,
  getProductStock: api.getProductStock,
  apiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

/**
 * El envío devuelve UNA ENTRADA POR CENTRO: parte la orden en una orden SAP por centro
 * de distribución. La orden de prueba tiene líneas en 2801 y 2802, así que salen dos.
 */
const envioAceptado = {
  accepted: true,
  partial: false,
  skipped: false,
  skippedReason: null,
  buckets: [
    {
      centerCode: '2801',
      itemsCount: 1,
      status: 'accepted' as const,
      sapOrderNumber: '0004500123',
      sapDispatchNumber: '0080001234',
      error: null,
      sapMessages: [],
    },
    {
      centerCode: '2802',
      itemsCount: 1,
      status: 'accepted' as const,
      sapOrderNumber: '0004500124',
      sapDispatchNumber: '0080001235',
      error: null,
      sapMessages: [],
    },
  ],
  totalBuckets: 2,
  acceptedBuckets: 2,
  failedBuckets: 0,
  error: null,
  filteredItemsCount: 0,
  itemsSent: 2,
  stillInReview: false,
};

beforeEach(() => {
  api.getReviewOrder.mockReset().mockResolvedValue(order());
  api.getReviewCatalogs.mockReset().mockResolvedValue(catalogs);
  api.listSapOrders.mockReset().mockResolvedValue(sapOrders);
  api.changeItemDestination.mockReset().mockResolvedValue({});
  api.changeItemCenter.mockReset().mockResolvedValue({});
  api.changeGroupInvoice.mockReset().mockResolvedValue({ ok: true, unchanged: false, groupInvoice: true });
  api.rejectOrder.mockReset().mockResolvedValue({ ok: true, statusCode: 'Rejected' });
  api.resendToSap.mockReset().mockResolvedValue(envioAceptado);
  api.getProductStock.mockReset().mockResolvedValue(stock);
});

async function renderDetail() {
  render(<ReviewOrderDetail guid={ORDER} onBack={() => undefined} />);
  await screen.findByText('ORD00005729');
}

function button(name: string | RegExp): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

const centerSelect = () => screen.getByLabelText('Centro de distribución de la línea 3') as HTMLSelectElement;
const destinationSelect = () => screen.getByLabelText('Destino de entrega de la línea 3') as HTMLSelectElement;

/**
 * La pestaña de órdenes SAP: el detalle abre en Productos. Se busca por rol `tab`, no
 * `button`: declarar `role="tab"` reemplaza el rol implícito del `<button>`.
 */
function verOrdenesSap() {
  fireEvent.click(screen.getByRole('tab', { name: /Órdenes SAP/ }));
}

describe('ReviewOrderDetail', () => {
  it('muestra el motivo separado en tipo y mensaje, y no muestra precios', async () => {
    await renderDetail();
    expect(screen.getAllByText('Error').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Aviso').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('El material 1200135 no está ampliado para el centro 2802.').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/precio|descuento|total/i)).toBeNull();
  });

  it('dice si la orden agrupa factura', async () => {
    await renderDetail();
    expect(screen.getByText('No')).toBeTruthy();

    api.getReviewOrder.mockResolvedValue(order({ groupInvoice: true }));
    render(<ReviewOrderDetail guid={ORDER} onBack={() => undefined} />);
    expect(await screen.findByText(/no puede salir parcial/)).toBeTruthy();
  });

  /**
   * Las órdenes SAP se separan POR ENVÍO (pedido 2026-09-22), con una divisoria que dice
   * cuándo fue y desde qué app.
   *
   * Sin esto, una orden con órdenes SAP del vendedor y de un reenvío de BackOffice las
   * muestra en una lista corrida, y parecen todas del mismo intento.
   */
  describe('las órdenes SAP se separan por intento', () => {
    /** Un envío del vendedor (una sola orden SAP, sin centro) además de las dos de BackOffice. */
    const desdeMobilityIA = {
      ...sapOrders[1],
      guid: 'sap-ia',
      orderNumber: 'ORD00005729',
      source: 'mobilityia' as const,
      centerCode: null,
      centerName: null,
      attemptAt: '2026-09-15T10:00:00Z',
    };

    it('muestra una divisoria por envío, con su fecha y su app', async () => {
      api.listSapOrders.mockResolvedValue([...sapOrders, desdeMobilityIA]);
      await renderDetail();
      verOrdenesSap();

      // Dos intentos: el reenvío de BackOffice (2 órdenes SAP) y el del vendedor (1).
      expect(screen.getByText('Intento 2')).toBeTruthy();
      expect(screen.getByText('Intento 1')).toBeTruthy();
      expect(screen.getByText('desde BackOffice')).toBeTruthy();
      expect(screen.getByText('desde MobilityIA')).toBeTruthy();
      // Y cuántas órdenes SAP salieron en cada uno.
      expect(screen.getByText('2 órdenes SAP')).toBeTruthy();
      expect(screen.getByText('1 orden SAP')).toBeTruthy();
    });

    /** El más reciente primero: es el que se mira al abrir. */
    it('el intento más nuevo va arriba', async () => {
      api.listSapOrders.mockResolvedValue([...sapOrders, desdeMobilityIA]);
      await renderDetail();
      verOrdenesSap();

      const titulos = screen.getAllByText(/^Intento \d$/).map((n) => n.textContent);
      expect(titulos).toEqual(['Intento 2', 'Intento 1']);
    });

    /**
     * Cada intento es colapsable para no descargar todo de golpe. El más reciente arranca
     * ABIERTO —es el que se viene a mirar— y los viejos, plegados.
     */
    it('el intento más nuevo arranca abierto y los viejos plegados', async () => {
      api.listSapOrders.mockResolvedValue([...sapOrders, desdeMobilityIA]);
      await renderDetail();
      verOrdenesSap();

      const plegables = document.querySelectorAll('details.bo-rs__sap-attempt');
      expect(plegables).toHaveLength(2);
      expect((plegables[0] as HTMLDetailsElement).open).toBe(true);
      expect((plegables[1] as HTMLDetailsElement).open).toBe(false);
    });

    /**
     * Plegado, lo que no puede esconderse es que algo salió mal: si hay que abrir para
     * enterarse de un rechazo, el resumen no está haciendo su trabajo.
     */
    it('un intento con rechazos lo avisa aunque esté plegado', async () => {
      api.listSapOrders.mockResolvedValue([...sapOrders, desdeMobilityIA]);
      await renderDetail();
      verOrdenesSap();

      const plegables = document.querySelectorAll('details.bo-rs__sap-attempt');
      const plegado = plegables[1] as HTMLDetailsElement;
      expect(plegado.open).toBe(false);
      // El aviso vive en el RESUMEN, que es lo único visible con el intento cerrado.
      expect(plegado.querySelector('summary')?.textContent).toContain('1 rechazada');
    });

    it('con un solo envío igual se indica de dónde vino', async () => {
      api.listSapOrders.mockResolvedValue([desdeMobilityIA]);
      await renderDetail();
      verOrdenesSap();

      expect(screen.getByText('Intento 1')).toBeTruthy();
      expect(screen.getByText('desde MobilityIA')).toBeTruthy();
      expect(screen.getByText('1 orden SAP')).toBeTruthy();
    });
  });

  it('cada orden SAP muestra su centro y su estado, en su pestaña', async () => {
    await renderDetail();
    // Los estados viven en la otra pestaña: no están hasta abrirla.
    expect(screen.queryByText('Aceptada')).toBeNull();

    verOrdenesSap();
    expect(screen.getByText('Centro 2801 · DW Alm. Externo')).toBeTruthy();
    expect(screen.getByText('Centro 2802 · DW Cartago')).toBeTruthy();
    expect(screen.getByText('Aceptada')).toBeTruthy();
    expect(screen.getByText('Rechazada por SAP')).toBeTruthy();
    expect(screen.getByText('Pedido 0099900101')).toBeTruthy();
  });

  /**
   * El StatusCode crudo NO se muestra: no aporta y engaña — una rechazada se queda en
   * 'Draft' porque SAP no lo actualiza. Queda en el title, para quien lo necesite.
   */
  it('no muestra el StatusCode crudo, que diría "Draft" en una rechazada', async () => {
    await renderDetail();
    verOrdenesSap();
    expect(screen.queryByText('Draft')).toBeNull();
    expect(screen.queryByText('Authorized')).toBeNull();
  });

  /** Las etiquetas son las mismas que usa MobilityIA para estas mismas órdenes SAP. */
  it('los estados se llaman igual que en MobilityIA', async () => {
    api.listSapOrders.mockResolvedValue([
      { ...sapOrders[0], status: 'no_response', sapOrderNumber: null, sapDispatchNumber: null, error: null },
      { ...sapOrders[1], status: 'accepted_no_dispatch', sapOrderNumber: '0099900101', sapDispatchNumber: null, error: null },
    ]);
    await renderDetail();
    verOrdenesSap();

    expect(screen.getByText('Sin respuesta de SAP')).toBeTruthy();
    expect(screen.getByText('Aceptada sin entrega')).toBeTruthy();
  });

  /**
   * Es lo que cambia al reenviar, así que se ve sin salir del detalle. Pero UNA sola
   * etiqueta destacada: en revisión, el estado formal va en chico y no compite con el
   * cartel —si no, una orden en revisión se anuncia como "Procesada", que se lee como
   * lo contrario de lo que pasa.
   */
  it('en revisión: se muestra SOLO el cartel, sin el estado formal', async () => {
    api.getReviewOrder.mockResolvedValue(order({ statusCode: 'Processed' }));
    await renderDetail();

    expect(screen.getByText('En revisión por BackOffice')).toBeTruthy();
    // Nada de "Procesada": no agrega nada y se lee como lo contrario de lo que pasa.
    expect(screen.queryByText(/Procesada/)).toBeNull();
    expect(screen.queryByText(/^Estado: /)).toBeNull();
  });

  it('en revisión tampoco repite el estado nuevo, que diría lo mismo dos veces', async () => {
    api.getReviewOrder.mockResolvedValue(order({ statusCode: 'PendingBackofficeReview' }));
    await renderDetail();

    // Una sola vez, no "En revisión por BackOffice — Pendiente revisión Backoffice".
    expect(screen.getAllByText(/revisión (por )?Backoffice/i)).toHaveLength(1);
  });

  it('fuera de revisión: el estado es lo único que importa y toma la etiqueta', async () => {
    api.getReviewOrder.mockResolvedValue(
      order({
        statusCode: 'SentToSAP',
        backoffice: { inReview: false, decidedBy: 'bo@duwest.com', decidedAt: '2026-09-17T17:00:00Z' },
      }),
    );
    await renderDetail();

    expect(screen.getByText('Enviado a SAP')).toBeTruthy();
    expect(screen.queryByText('En revisión por BackOffice')).toBeNull();
    expect(screen.queryByText(/^Estado: /)).toBeNull();
  });

  it('todas las líneas se corrigen en Productos, esté aceptada o rechazada su orden SAP', async () => {
    await renderDetail();
    expect(centerSelect()).toBeTruthy();
    // La línea 1 salió en la orden SAP aceptada y se edita igual: la corrección es de
    // la orden, no de la orden SAP.
    expect(screen.getByLabelText('Centro de distribución de la línea 1')).toBeTruthy();
    expect(screen.getByLabelText('Destino de entrega de la línea 1')).toBeTruthy();
  });

  it('la pestaña de órdenes SAP es solo consulta', async () => {
    await renderDetail();
    verOrdenesSap();
    expect(screen.queryByLabelText('Centro de distribución de la línea 3')).toBeNull();
    expect(screen.queryByLabelText('Destino de entrega de la línea 3')).toBeNull();
    expect(screen.queryByRole('button', { name: /Ver stock/ })).toBeNull();
  });

  /**
   * El reenvío es de la orden COMPLETA, no de cada orden SAP (confirmado con el equipo
   * el 2026-09-17): se manda la BusinessOrder y el Middleware decide en cuántas órdenes
   * SAP sale. Por eso el botón vive en la barra de acciones y no dentro de una pestaña.
   */
  it('el reenvío es de la orden completa, no por orden SAP', async () => {
    await renderDetail();
    // Que esté apagado lo cubre el test de abajo; acá lo que importa es DÓNDE vive.
    expect(button('Reenviar a SAP')).toBeTruthy();

    verOrdenesSap();
    expect(screen.queryByRole('button', { name: 'Reenviar esta orden SAP' })).toBeNull();
    expect(button('Reenviar a SAP')).toBeTruthy();
  });

  /**
   * El reenvío está DESCONECTADO (2026-09-17): el envío del middleware manda la orden
   * como una sola orden SAP —el camino de MobilityIA— y BackOffice necesita el que la
   * parte por centro, que todavía no existe. El botón queda a la vista para que se sepa
   * que va ahí, pero apagado y explicando por qué.
   */
  it('el reenvío está a la vista pero apagado, con el motivo en el título', async () => {
    await renderDetail();
    const reenviar = button('Reenviar a SAP');
    expect(reenviar.disabled).toBe(true);
    expect(reenviar.title).toMatch(/por centro de distribución/);

    fireEvent.click(reenviar);
    // Ni siquiera abre la confirmación: no hay forma de llegar a SAP desde acá.
    expect(screen.queryByText(/Crea un pedido real en SAP/)).toBeNull();
    expect(api.resendToSap).not.toHaveBeenCalled();
  });

  /**
   * El reenvío crea UNA orden SAP POR CENTRO, así que el resultado no es uno solo.
   *
   * Estos tests montan el modal directamente: el botón está apagado a propósito (ver
   * arriba), así que por la pantalla no hay forma de llegar al resultado todavía. Lo que
   * se fija acá es lo que el operador tiene que poder leer cuando se reconecte — sobre
   * todo el fallo parcial, donde parte de la orden YA existe en SAP y reintentar la
   * duplicaría.
   */
  describe('resultado del reenvío, por centro', () => {
    const bucket = (over: Partial<ResendBucket> = {}): ResendBucket => ({
      centerCode: '2801',
      itemsCount: 1,
      status: 'accepted',
      sapOrderNumber: '0004500123',
      sapDispatchNumber: '0080001234',
      error: null,
      sapMessages: [],
      ...over,
    });

    function verResultado(over: Partial<ResendResult>) {
      const result: ResendResult = { ...envioAceptado, ...over };
      render(
        <ResendModal
          orderNumber="ORD00005729"
          pendingChanges={0}
          blocking={0}
          groupInvoice={false}
          centersToSend={result.totalBuckets}
          sending={false}
          result={result}
          error={null}
          onConfirm={() => undefined}
          onClose={() => undefined}
        />,
      );
    }

    it('muestra cada centro con su estado y sus números', () => {
      verResultado({});
      expect(screen.getByText('Centro 2801')).toBeTruthy();
      expect(screen.getByText('Centro 2802')).toBeTruthy();
      expect(screen.getAllByText('Aceptada')).toHaveLength(2);
      expect(screen.getByText('0004500123')).toBeTruthy();
      expect(screen.getByText('0004500124')).toBeTruthy();
      expect(screen.getByText(/salió de la bandeja/)).toBeTruthy();
    });

    /**
     * El caso peligroso: los pedidos que salieron NO se deshacen. Reenviar la orden
     * entera crearía un segundo pedido de los centros que ya están.
     */
    it('en un fallo parcial avisa que lo que salió ya existe en SAP', () => {
      verResultado({
        accepted: false,
        partial: true,
        buckets: [
          bucket(),
          bucket({
            centerCode: '2802',
            status: 'rejected',
            sapOrderNumber: null,
            sapDispatchNumber: null,
            error: '[E] El material 1200135 no está ampliado para el centro 2802.',
          }),
        ],
        acceptedBuckets: 1,
        failedBuckets: 1,
        stillInReview: true,
      });

      expect(screen.getByText(/SAP aceptó una parte/)).toBeTruthy();
      expect(screen.getByText(/ya existen en SAP/)).toBeTruthy();
      expect(screen.getByText(/no reenvíes/i)).toBeTruthy();
      // Y se ve CUÁL falló, que es lo único accionable.
      expect(screen.getByText('Rechazada por SAP')).toBeTruthy();
      expect(screen.getByText('El material 1200135 no está ampliado para el centro 2802.')).toBeTruthy();
      expect(screen.getByText(/sigue en la bandeja/)).toBeTruthy();
    });

    /** Pedido sin entrega: el middleware lo da por bueno, BackOffice no. */
    it('un centro con pedido pero sin entrega se marca y se explica', () => {
      verResultado({
        buckets: [bucket({ status: 'accepted_no_dispatch', sapDispatchNumber: null })],
        totalBuckets: 1,
        acceptedBuckets: 1,
      });

      expect(screen.getByText('Aceptada sin entrega')).toBeTruthy();
      expect(screen.getByText(/no devolvió el N° de entrega/)).toBeTruthy();
      expect(screen.getByText(/se resuelve en SAP/i)).toBeTruthy();
    });

    it('si no se llegó a enviar, dice por qué y no lo muestra como rechazo', () => {
      verResultado({
        accepted: false,
        skipped: true,
        skippedReason: 'GroupInvoice=1 con items sin stock: la orden no puede salir parcial.',
        buckets: [],
        totalBuckets: 0,
        acceptedBuckets: 0,
        stillInReview: true,
      });

      expect(screen.getByText('No se envió a SAP')).toBeTruthy();
      expect(screen.getByText(/no puede salir parcial/)).toBeTruthy();
      expect(screen.queryByText('Rechazada por SAP')).toBeNull();
    });

    /** Antes de enviar hay que decir en cuántos pedidos reales se va a convertir. */
    it('antes de enviar avisa cuántos pedidos va a crear', () => {
      render(
        <ResendModal
          orderNumber="ORD00005729"
          pendingChanges={0}
          blocking={0}
          groupInvoice={false}
          centersToSend={2}
          sending={false}
          result={null}
          error={null}
          onConfirm={() => undefined}
          onClose={() => undefined}
        />,
      );
      expect(screen.getByText(/se crean 2 órdenes SAP, una por centro/)).toBeTruthy();
      expect(screen.getByText(/Crea 2 pedidos reales en SAP/)).toBeTruthy();
      // Y que cada uno va por su cuenta: unos pueden salir y otros no.
      expect(screen.getByText(/puede que unos salgan y otros no/)).toBeTruthy();
    });
  });

  it('cambiar el centro queda sin guardar y se puede descartar', async () => {
    await renderDetail();
    fireEvent.change(centerSelect(), { target: { value: '2801' } });
    expect(screen.getByText('1 cambio sin guardar')).toBeTruthy();
    expect(screen.getByText('Sin guardar')).toBeTruthy();

    fireEvent.click(button('Descartar cambios'));
    expect(screen.getByText('Sin cambios')).toBeTruthy();
    expect(centerSelect().value).toBe('2802');
  });

  it('guardar manda centro y destino al servidor y recarga las órdenes SAP', async () => {
    await renderDetail();
    fireEvent.change(centerSelect(), { target: { value: '2801' } });
    fireEvent.change(destinationSelect(), { target: { value: '10019279' } });
    expect(screen.getByText('2 cambios sin guardar')).toBeTruthy();

    fireEvent.click(button('Guardar cambios'));
    await screen.findByText('Se guardaron 2 cambios.');
    expect(api.changeItemCenter).toHaveBeenCalledWith(ORDER, 'item-3', '2801');
    expect(api.changeItemDestination).toHaveBeenCalledWith(ORDER, 'item-3', '10019279');
    expect(api.listSapOrders).toHaveBeenCalledTimes(2);
  });

  it('si el servidor rechaza un cambio, el error queda en el producto', async () => {
    await renderDetail();
    fireEvent.change(centerSelect(), { target: { value: '2801' } });
    api.changeItemCenter.mockRejectedValue(new Error('400'));

    fireEvent.click(button('Guardar cambios'));
    await screen.findByText('No se pudo guardar el centro.');
    await waitFor(() => expect(centerSelect().value).toBe('2801'));
  });

  it('el stock de un producto se ve en un modal, por centro y almacén', async () => {
    await renderDetail();
    // "y elegir centro" porque la orden es editable: el modal también sirve para elegir.
    // La línea 3 es el producto 1200135, el que SAP rechazó.
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver stock y elegir centro' })[1]);
    expect(await screen.findByText('Stock de 1200135')).toBeTruthy();
    expect(api.getProductStock).toHaveBeenCalledWith(ORDER, '1200135');
    // El almacén ya no es un nodo suelto: va en una línea con su código y cantidades.
    expect(screen.getByText(/Mat \/ P\. Ter/)).toBeTruthy();
    expect(screen.getByText('Del cliente')).toBeTruthy();

    fireEvent.click(button('Cerrar'));
    await waitFor(() => expect(screen.queryByText('Stock de 1200135')).toBeNull());
  });

  /**
   * Agrupa factura es lo único editable de la cabecera, y no se guarda con el resto:
   * cambia cómo sale la orden ENTERA, así que se confirma aparte y avisando qué implica.
   */
  it('cambiar agrupa factura avisa qué va a pasar antes de guardar', async () => {
    await renderDetail();
    fireEvent.click(button('Cambiar a Sí'));

    expect(screen.getByText(/deja de poder salir parcial/)).toBeTruthy();
    expect(screen.getByText(/no se manda nada a SAP/)).toBeTruthy();
    // Nada se guardó por abrir el aviso.
    expect(api.changeGroupInvoice).not.toHaveBeenCalled();

    fireEvent.click(button('Sí, agrupar factura'));
    await waitFor(() => expect(api.changeGroupInvoice).toHaveBeenCalledWith(ORDER, true, null));
    await screen.findByText(/ya no puede salir parcial/);
  });

  it('el aviso explica lo contrario si la orden ya agrupa factura, y se puede cancelar', async () => {
    api.getReviewOrder.mockResolvedValue(order({ groupInvoice: true }));
    await renderDetail();
    fireEvent.click(button('Cambiar a No'));

    expect(screen.getByText(/va a poder salir parcial/)).toBeTruthy();
    expect(screen.getByText(/deja de coincidir con la orden de compra/)).toBeTruthy();

    fireEvent.click(button('Cancelar'));
    await waitFor(() => expect(screen.queryByText(/va a poder salir parcial/)).toBeNull());
    expect(api.changeGroupInvoice).not.toHaveBeenCalled();
  });

  /**
   * El punto del modal: elegir el centro VIENDO cuánto hay, en vez de a ciegas en el
   * selector. Lo elegido queda como cualquier otro cambio — sin guardar hasta apretar
   * "Guardar cambios".
   */
  it('desde el modal se elige el centro, y queda sin guardar', async () => {
    await renderDetail();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver stock y elegir centro' })[1]);
    await screen.findByText('Stock de 1200135');

    // El stock de prueba está en el 2802, que es el centro que ya tiene la línea 3.
    expect(screen.getByText('Es el actual')).toBeTruthy();

    // 2801 es permitido y no tiene stock: se puede elegir igual (decisión 4b).
    fireEvent.click(screen.getAllByRole('button', { name: 'Elegir' })[0]);

    await waitFor(() => expect(screen.queryByText('Stock de 1200135')).toBeNull());
    expect(screen.getByText('1 cambio sin guardar')).toBeTruthy();
    expect(centerSelect().value).toBe('2801');
  });

  it('en solo lectura el modal sigue sirviendo para mirar, pero no para elegir', async () => {
    api.getReviewOrder.mockResolvedValue(
      order({ backoffice: { inReview: false, decidedBy: 'bo@duwest.com', decidedAt: null } }),
    );
    await renderDetail();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver stock por centro' })[1]);
    await screen.findByText('Stock de 1200135');

    expect(screen.queryByRole('button', { name: 'Elegir' })).toBeNull();
  });

  /**
   * Rechazar cierra la orden y NO se deshace (directiva 2026-09-18). Lo que se fija acá
   * es que no se pueda disparar de un solo clic ni sin motivo: el motivo es lo ÚNICO que
   * el vendedor va a leer, porque el estado sólo dice "Rechazada".
   */
  describe('rechazar la orden', () => {
    /**
     * El campo del motivo. Se busca por su label propio y no por /Motivo del rechazo/:
     * el detalle ya muestra un bloque "Motivo del rechazo de SAP" —lo que contestó SAP—
     * y ese matcher engancharía los dos. Son dos motivos distintos y de autores
     * distintos, así que tampoco se llaman igual en pantalla.
     */
    const motivoInput = () => screen.getByLabelText(/Por qué se rechaza/) as HTMLInputElement;

    it('avisa qué implica antes de rechazar, y no rechaza por abrir el aviso', async () => {
      await renderDetail();
      fireEvent.click(button('Rechazar orden'));

      expect(screen.getByText(/No se puede deshacer/)).toBeTruthy();
      expect(screen.getByText(/sólo puede copiarla|Lo único que va a poder hacer es copiarla/)).toBeTruthy();
      // El vendedor al que le vuelve, por nombre.
      expect(screen.getByText(/vendedor@duwest\.com/)).toBeTruthy();
      expect(api.rejectOrder).not.toHaveBeenCalled();
    });

    it('sin motivo no deja confirmar: es lo único que el vendedor va a leer', async () => {
      await renderDetail();
      fireEvent.click(button('Rechazar orden'));

      const confirmar = button('Sí, rechazar la orden');
      expect(confirmar.disabled).toBe(true);
      // Espacios tampoco alcanzan.
      fireEvent.change(motivoInput(), { target: { value: '   ' } });
      expect(button('Sí, rechazar la orden').disabled).toBe(true);
      expect(api.rejectOrder).not.toHaveBeenCalled();
    });

    it('con motivo rechaza, recarga la orden y avisa dónde quedó el motivo', async () => {
      await renderDetail();
      fireEvent.click(button('Rechazar orden'));
      fireEvent.change(motivoInput(), { target: { value: 'el cliente desistió de la compra' } });

      api.getReviewOrder.mockResolvedValue(
        order({
          statusCode: 'Rejected',
          backoffice: { inReview: false, decidedBy: 'bo@duwest.com', decidedAt: '2026-09-18T12:00:00Z' },
        }),
      );
      fireEvent.click(button('Sí, rechazar la orden'));

      await waitFor(() =>
        expect(api.rejectOrder).toHaveBeenCalledWith(ORDER, 'el cliente desistió de la compra'),
      );
      // El vendedor lee el motivo en el hilo: decirlo cierra el circuito para quien rechazó.
      await screen.findByText(/quedó en el hilo de comentarios/);
      // Y la orden recargada ya es de solo lectura: el estado manda.
      await waitFor(() => expect(screen.getByText('Rechazada')).toBeTruthy());
    });

    it('se puede cancelar sin rechazar', async () => {
      await renderDetail();
      fireEvent.click(button('Rechazar orden'));
      fireEvent.click(button('Cancelar'));

      await waitFor(() => expect(screen.queryByText(/No se puede deshacer/)).toBeNull());
      expect(api.rejectOrder).not.toHaveBeenCalled();
    });

    it('una orden fuera de revisión ya no se puede rechazar', async () => {
      api.getReviewOrder.mockResolvedValue(
        order({ backoffice: { inReview: false, decidedBy: 'bo@duwest.com', decidedAt: null } }),
      );
      await renderDetail();
      expect(button('Rechazar orden').disabled).toBe(true);
    });

    it('si el servidor rechaza la operación, el error queda en el modal', async () => {
      await renderDetail();
      fireEvent.click(button('Rechazar orden'));
      fireEvent.change(motivoInput(), { target: { value: 'sin stock' } });
      api.rejectOrder.mockRejectedValue(new Error('409'));

      fireEvent.click(button('Sí, rechazar la orden'));
      await screen.findByText('No se pudo rechazar la orden.');
      // El modal sigue abierto: el motivo escrito no se pierde.
      expect(button('Sí, rechazar la orden')).toBeTruthy();
    });
  });

  it('una orden que ya no está en revisión se muestra en solo lectura', async () => {
    api.getReviewOrder.mockResolvedValue(
      order({ backoffice: { inReview: false, decidedBy: 'bo@duwest.com', decidedAt: '2026-09-15T17:00:00Z' } }),
    );
    await renderDetail();
    expect(screen.getByText(/ya no está en revisión/)).toBeTruthy();
    expect(centerSelect().disabled).toBe(true);
    expect(destinationSelect().disabled).toBe(true);
  });
});
