import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReviewOrderDetail } from './ReviewOrderDetail';
import { ResendModal } from './ResendModal';
import {
  ProductStock,
  ResendBucket,
  ResendPlan,
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
        cancelledAt: null,
        cancelledBy: null,
        noSaleReasonCode: null,
        noSaleReasonNotes: null,
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
        cancelledAt: null,
        cancelledBy: null,
        noSaleReasonCode: null,
        noSaleReasonNotes: null,
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
  cancelItem: vi.fn(),
  reactivateItem: vi.fn(),
  listNoSaleReasons: vi.fn(),
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
  cancelItem: api.cancelItem,
  reactivateItem: api.reactivateItem,
  listNoSaleReasons: api.listNoSaleReasons,
  apiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

/** El catálogo de motivos: el mismo que usa MobilityIA. */
const MOTIVOS = [
  { code: 'SIN_STOCK', label: 'Sin stock', sortOrder: 1 },
  { code: 'PRECIO', label: 'Precio no aceptado', sortOrder: 2 },
];

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
  api.cancelItem.mockReset().mockResolvedValue({ ok: true, activosRestantes: 1, item: {} });
  api.reactivateItem.mockReset().mockResolvedValue({ ok: true, activosRestantes: 2, item: {} });
  api.listNoSaleReasons.mockReset().mockResolvedValue(MOTIVOS);
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
    // Lo que importa acá es DÓNDE vive: en la barra, una sola vez, no por orden SAP.
    expect(button('Reenviar a SAP')).toBeTruthy();

    verOrdenesSap();
    expect(screen.queryByRole('button', { name: 'Reenviar esta orden SAP' })).toBeNull();
    expect(button('Reenviar a SAP')).toBeTruthy();
  });

  /**
   * CONECTADO el 2026-09-21 (Middleware ≥ 1.361.1). Estuvo apagado desde el 2026-09-17:
   * primero porque el envío por centro no existía, después porque rebotaba todo con 422.
   *
   * Confirma antes de enviar, y eso no es ceremonia: crea pedidos REALES en SAP que no
   * se deshacen desde acá. Por eso el primer clic abre el aviso y no manda nada.
   */
  it('el reenvío pide confirmación antes de crear nada en SAP', async () => {
    await renderDetail();
    const reenviar = button('Reenviar a SAP');
    expect(reenviar.disabled).toBe(false);

    fireEvent.click(reenviar);
    // Se abrió el aviso, y todavía no se llamó a nadie.
    expect(screen.getByText(/Crea 2 pedidos reales en SAP/)).toBeTruthy();
    expect(api.resendToSap).not.toHaveBeenCalled();

    // Recién al confirmar sale, y vuelve el resultado por centro.
    fireEvent.click(button('Sí, reenviar a SAP'));
    await waitFor(() => expect(api.resendToSap).toHaveBeenCalledWith(ORDER));
    expect(await screen.findByText('Centro 2801')).toBeTruthy();
    expect(screen.getByText('Centro 2802')).toBeTruthy();
  });

  /**
   * La orden de prueba tiene líneas en 2801 y 2802, así que salen DOS pedidos. Decirlo
   * antes importa: es la diferencia entre crear uno y crear dos cosas irreversibles.
   */
  it('avisa cuántos pedidos va a crear, contando los cambios sin guardar', async () => {
    await renderDetail();
    // Unifico las dos líneas en un solo centro: ahora sería UN pedido, no dos.
    fireEvent.change(centerSelect(), { target: { value: '2801' } });

    fireEvent.click(button('Reenviar a SAP'));
    expect(screen.getByText(/todas las líneas van juntas en una sola orden SAP/)).toBeTruthy();
    expect(screen.getByText(/Crea un pedido real en SAP/)).toBeTruthy();
  });

  it('una orden fuera de revisión ya no se reenvía', async () => {
    api.getReviewOrder.mockResolvedValue(
      order({ backoffice: { inReview: false, decidedBy: 'bo@duwest.com', decidedAt: null } }),
    );
    await renderDetail();
    expect(button('Reenviar a SAP').disabled).toBe(true);
  });

  it('si el envío falla, el modal lo dice y no se pierde', async () => {
    await renderDetail();
    api.resendToSap.mockRejectedValue(new Error('503'));

    fireEvent.click(button('Reenviar a SAP'));
    fireEvent.click(button('Sí, reenviar a SAP'));

    await screen.findByText('No se pudo reenviar la orden a SAP.');
    // Y el aviso de no reintentar a ciegas: el pedido pudo haberse creado.
    expect(screen.getByText(/No reintentes sin mirar/)).toBeTruthy();
  });

  /**
   * El reenvío crea UNA orden SAP POR CENTRO, así que el resultado no es uno solo.
   *
   * Estos tests montan el modal directamente para llegar a cada desenlace sin depender
   * de lo que conteste el servidor. Lo que se fija acá es lo que el operador tiene que
   * poder leer — sobre todo el fallo parcial, donde parte de la orden YA existe en SAP
   * y reintentar la duplicaría.
   */
  describe('resultado del reenvío, por centro', () => {
    /**
     * Cómo va a salir el envío. `centros` arma una orden SAP por centro con la línea que
     * le corresponde de la orden de prueba, que es lo que muestra la previsualización.
     */
    const plan = (centros: number): ResendPlan => ({
      orders: [
        { centerCode: '2801', centerName: 'DW Alm. Externo', items: [order().items[0]], heredados: 0 },
        { centerCode: '2802', centerName: 'DW Cartago', items: [order().items[1]], heredados: 0 },
      ].slice(0, centros),
      attemptNumber: 3,
      cancelledCount: 0,
      itemCount: centros,
    });

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
          plan={plan(result.totalBuckets)}
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
          plan={plan(2)}
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

    /**
     * LA PREVISUALIZACIÓN. Antes de crear pedidos reales hay que poder ver QUÉ se manda:
     * el envío parte la orden por centro y deja afuera las canceladas, y ninguna de esas
     * dos cosas se ve mirando la orden.
     */
    it('antes de enviar muestra cada orden SAP con sus productos y el intento', () => {
      render(
        <ResendModal
          orderNumber="ORD00005729"
          pendingChanges={0}
          blocking={0}
          groupInvoice={false}
          plan={plan(2)}
          sending={false}
          result={null}
          error={null}
          onConfirm={() => undefined}
          onClose={() => undefined}
        />,
      );
      expect(screen.getByText(/intento 3/)).toBeTruthy();
      expect(screen.getByText('Orden SAP 1 de 2')).toBeTruthy();
      expect(screen.getByText('Orden SAP 2 de 2')).toBeTruthy();
      expect(screen.getByText(/Centro 2801/)).toBeTruthy();
      expect(screen.getByText(/Centro 2802/)).toBeTruthy();
      // Los productos, no sólo el conteo: es lo que deja ver que falta uno.
      expect(screen.getByText('1200183')).toBeTruthy();
      expect(screen.getByText('1200135')).toBeTruthy();
    });

    /**
     * EL CENTRO HEREDADO NO SALE. El envío agrupa por el CenterCode de la línea y no
     * hereda el de la cabecera: con una sola así, rebota la orden entera con
     * "Este endpoint agrupa por CenterCode y N item(s) no lo tienen".
     * Antes la previsualización las mostraba bajo "Centro de la cabecera" como si fueran
     * a salir, y el operador se enteraba al apretar el botón (reportado 2026-09-23).
     */
    it('avisa de las líneas que heredan el centro y no deja confirmar', () => {
      const conHeredados = plan(1);
      conHeredados.orders[0] = { ...conHeredados.orders[0], heredados: 1 };
      render(
        <ResendModal
          orderNumber="ORD00005729"
          pendingChanges={0}
          blocking={1}
          groupInvoice={false}
          plan={conHeredados}
          sending={false}
          result={null}
          error={null}
          onConfirm={() => undefined}
          onClose={() => undefined}
        />,
      );
      expect(screen.getByText(/1 línea sin centro de distribución propio/)).toBeTruthy();
      expect(screen.getByText(/no hereda/)).toBeTruthy();
      expect(
        (screen.getByRole('button', { name: /reenviar a SAP/i }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    /** Las canceladas se cuentan aparte: el faltante no puede aparecer sin explicación. */
    it('avisa cuántas líneas canceladas quedan afuera', () => {
      render(
        <ResendModal
          orderNumber="ORD00005729"
          pendingChanges={0}
          blocking={0}
          groupInvoice={false}
          plan={{ ...plan(1), cancelledCount: 2 }}
          sending={false}
          result={null}
          error={null}
          onConfirm={() => undefined}
          onClose={() => undefined}
        />,
      );
      expect(screen.getByText(/2 líneas canceladas quedan afuera/)).toBeTruthy();
    });

    /**
     * SIN NADA QUE ENVIAR. Con todas las líneas canceladas el envío rebota, así que el
     * modal lo dice y apaga el botón en vez de dejar que el usuario descubra el rechazo.
     */
    it('con todo cancelado no deja confirmar y sugiere rechazar la orden', () => {
      render(
        <ResendModal
          orderNumber="ORD00005729"
          pendingChanges={0}
          blocking={0}
          groupInvoice={false}
          plan={{ orders: [], attemptNumber: 2, cancelledCount: 3, itemCount: 0 }}
          sending={false}
          result={null}
          error={null}
          onConfirm={() => undefined}
          onClose={() => undefined}
        />,
      );
      expect(screen.getByText(/No queda ninguna línea para enviar/)).toBeTruthy();
      expect(screen.getByText(/las 3 líneas de la orden están canceladas/i)).toBeTruthy();
      expect(
        (screen.getByRole('button', { name: /reenviar a SAP/i }) as HTMLButtonElement).disabled,
      ).toBe(true);
      // Y no promete pedidos que no se van a crear.
      expect(screen.queryByText(/pedidos reales en SAP/)).toBeNull();
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

  /**
   * CANCELAR UNA LÍNEA con motivo de no venta (pedido 2026-09-22).
   *
   * Lo que se fija acá:
   *  - el motivo es obligatorio y sale del CATÁLOGO, no es texto libre;
   *  - la línea cancelada NO desaparece: sigue en la tabla, con su motivo, porque es la
   *    respuesta a "por qué el pedido que llegó a SAP es más chico";
   *  - cancelar la ÚLTIMA activa avisa y ofrece rechazar la orden, que es lo que
   *    corresponde cuando no va a salir nada;
   *  - reactivar no se confirma, porque no destruye nada.
   */
  describe('cancelar una línea con motivo de no venta', () => {
    /** Cómo vuelve la línea 1 ya cancelada desde el servidor. */
    function conLinea1Cancelada() {
      const base = order();
      return order({
        items: [
          {
            ...base.items[0],
            cancelledAt: '2026-09-22T10:00:00Z',
            cancelledBy: 'bo@duwest.com',
            noSaleReasonCode: 'SIN_STOCK',
            noSaleReasonNotes: 'el cliente no espera',
          },
          base.items[1],
        ],
      });
    }

    const cancelarLinea = () =>
      screen.getAllByRole('button', { name: 'Cancelar línea' })[0] as HTMLButtonElement;

    it('pide un motivo del catálogo y no deja confirmar sin elegirlo', async () => {
      await renderDetail();
      fireEvent.click(cancelarLinea());

      expect(screen.getByText('Cancelar línea 1')).toBeTruthy();
      // El botón arranca apagado: sin motivo no se puede cancelar.
      expect(button('Cancelar la línea').disabled).toBe(true);

      const select = screen.getByLabelText(/Motivo de no venta/) as HTMLSelectElement;
      // Las opciones son las del catálogo, con su etiqueta legible.
      expect(screen.getByRole('option', { name: 'Sin stock' })).toBeTruthy();
      expect(screen.getByRole('option', { name: 'Precio no aceptado' })).toBeTruthy();

      fireEvent.change(select, { target: { value: 'SIN_STOCK' } });
      expect(button('Cancelar la línea').disabled).toBe(false);
    });

    it('manda el motivo y la nota, y avisa cuántas líneas quedan', async () => {
      await renderDetail();
      fireEvent.click(cancelarLinea());
      fireEvent.change(screen.getByLabelText(/Motivo de no venta/), {
        target: { value: 'SIN_STOCK' },
      });
      fireEvent.change(screen.getByLabelText(/Aclaración/), {
        target: { value: 'el cliente no espera' },
      });
      api.getReviewOrder.mockResolvedValue(conLinea1Cancelada());

      fireEvent.click(button('Cancelar la línea'));

      await waitFor(() =>
        expect(api.cancelItem).toHaveBeenCalledWith(
          ORDER,
          'item-1',
          'SIN_STOCK',
          'el cliente no espera',
        ),
      );
      expect(await screen.findByText(/Quedan 1 línea activa/)).toBeTruthy();
    });

    it('la nota es opcional', async () => {
      await renderDetail();
      fireEvent.click(cancelarLinea());
      fireEvent.change(screen.getByLabelText(/Motivo de no venta/), {
        target: { value: 'PRECIO' },
      });
      fireEvent.click(button('Cancelar la línea'));

      await waitFor(() =>
        expect(api.cancelItem).toHaveBeenCalledWith(ORDER, 'item-1', 'PRECIO', null),
      );
    });

    /** Lo que distingue esto de un borrado: la línea sigue, y dice por qué no va. */
    it('la línea cancelada sigue en la tabla, con su motivo y quién la canceló', async () => {
      api.getReviewOrder.mockResolvedValue(conLinea1Cancelada());
      await renderDetail();

      expect(screen.getByText('1200183')).toBeTruthy();
      expect(screen.getByText('No se envía')).toBeTruthy();
      // El motivo con su ETIQUETA, no el código: 'SIN_STOCK' no le dice nada a nadie.
      expect(screen.getByText(/Sin stock/)).toBeTruthy();
      expect(screen.getByText(/el cliente no espera/)).toBeTruthy();
      expect(screen.getByText(/Cancelada por bo@duwest.com/)).toBeTruthy();
      // Y no se le puede cambiar el centro: no va a salir.
      expect(
        (screen.getByLabelText('Centro de distribución de la línea 1') as HTMLSelectElement)
          .disabled,
      ).toBe(true);
    });

    it('reactivar no pide confirmación y recarga la orden', async () => {
      api.getReviewOrder.mockResolvedValue(conLinea1Cancelada());
      await renderDetail();

      api.getReviewOrder.mockResolvedValue(order());
      fireEvent.click(button('Reactivar'));

      await waitFor(() => expect(api.reactivateItem).toHaveBeenCalledWith(ORDER, 'item-1'));
      expect(await screen.findByText(/vuelve a incluirse en el próximo envío/)).toBeTruthy();
    });

    /** El servidor frena la reactivación si hubo un envío: ese mensaje es el que importa. */
    it('si ya se reenvió, el fallo de reactivar queda al lado de la línea', async () => {
      api.getReviewOrder.mockResolvedValue(conLinea1Cancelada());
      await renderDetail();
      api.reactivateItem.mockRejectedValue(new Error('409'));

      fireEvent.click(button('Reactivar'));
      expect(await screen.findByText('No se pudo reactivar la línea.')).toBeTruthy();
    });

    /**
     * LA ÚLTIMA LÍNEA. Cancelarla deja el envío sin nada que mandar, así que el modal
     * avisa y ofrece el camino correcto en vez de dejar que lo descubra al reenviar.
     */
    it('al cancelar la última línea activa avisa y ofrece rechazar la orden', async () => {
      const base = order();
      api.getReviewOrder.mockResolvedValue(
        order({
          items: [
            {
              ...base.items[0],
              cancelledAt: '2026-09-22T10:00:00Z',
              cancelledBy: 'bo@duwest.com',
              noSaleReasonCode: 'SIN_STOCK',
              noSaleReasonNotes: null,
            },
            base.items[1],
          ],
        }),
      );
      await renderDetail();

      fireEvent.click(cancelarLinea());
      expect(screen.getByText(/Es la última línea que queda/)).toBeTruthy();
      expect(screen.getByText(/va a rebotar sin crear ningún pedido/)).toBeTruthy();

      // Y el atajo lleva al rechazo, cerrando este modal: son alternativas, no se suman.
      // Se busca DENTRO del diálogo: "Rechazar orden" también está en la barra de acciones
      // de atrás, y el que importa es el del modal.
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Rechazar orden' }),
      );
      expect(await screen.findByText('Rechazar ORD00005729')).toBeTruthy();
      expect(screen.queryByText(/Cancelar línea 3/)).toBeNull();
    });

    it('fuera de revisión no se puede cancelar ni reactivar', async () => {
      const base = order();
      api.getReviewOrder.mockResolvedValue(
        order({
          backoffice: { inReview: false, decidedBy: 'bo@duwest.com', decidedAt: null },
          items: [
            { ...base.items[0], cancelledAt: '2026-09-22T10:00:00Z', cancelledBy: 'bo@duwest.com', noSaleReasonCode: 'SIN_STOCK', noSaleReasonNotes: null },
            base.items[1],
          ],
        }),
      );
      await renderDetail();

      expect(button('Reactivar').disabled).toBe(true);
      expect(cancelarLinea().disabled).toBe(true);
    });
  });
});

/**
 * LOS CAMBIOS SIN GUARDAR NO SE PIERDEN AL CANCELAR O REACTIVAR (reportado 2026-09-23).
 *
 * "Si primero modifico y cambio algún producto a otro centro de distribución, y después
 * cancelo algún otro item, el producto al que le había cambiado el centro vuelve a su
 * centro original."
 *
 * Cancelar recarga la orden entera, y eso hacía `initialDrafts(frescos)` — que descartaba
 * en silencio lo que el usuario venía editando en TODAS las demás líneas. Se pierde un
 * trabajo que la pantalla decía tener ("1 cambio sin guardar") sin avisar nada.
 */
describe('cancelar no descarta lo que estabas editando', () => {
  /**
   * "Si primero modifico y cambio algún producto a otro centro de distribución, y después
   * cancelo algún otro item, el producto al que le había cambiado el centro vuelve a su
   * centro original." — reportado el 2026-09-23.
   *
   * Cancelar recarga la orden entera, y eso hacía `initialDrafts(frescos)`: descartaba en
   * silencio lo que el usuario venía editando en TODAS las demás líneas. Se perdía un
   * trabajo que la pantalla decía tener ("1 cambio sin guardar"), sin avisar nada.
   */

  /** La orden como vuelve del servidor con la línea 1 ya cancelada. */
  function conLinea1Cancelada() {
    const base = order();
    return order({
      items: [
        {
          ...base.items[0],
          cancelledAt: '2026-09-23T10:00:00Z',
          cancelledBy: 'bo@duwest.com',
          noSaleReasonCode: 'SIN_STOCK',
          noSaleReasonNotes: null,
        },
        base.items[1],
      ],
    });
  }

  /** Abre el modal de la primera línea, elige motivo y confirma. */
  async function cancelarPrimeraLinea() {
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancelar línea' })[0]);
    fireEvent.change(screen.getByLabelText(/Motivo de no venta/), {
      target: { value: 'SIN_STOCK' },
    });
    fireEvent.click(button('Cancelar la línea'));
    await waitFor(() => expect(api.cancelItem).toHaveBeenCalled());
  }

  it('el centro cambiado en otra línea sigue ahí después de cancelar', async () => {
    await renderDetail();

    // Cambio el centro de la línea 3 y NO guardo.
    fireEvent.change(centerSelect(), { target: { value: '2801' } });
    expect(centerSelect().value).toBe('2801');
    expect(screen.getByText('1 cambio sin guardar')).toBeTruthy();

    api.getReviewOrder.mockResolvedValue(conLinea1Cancelada());
    await cancelarPrimeraLinea();

    // El cambio sigue pendiente: la línea 3 no volvió a su centro original.
    await waitFor(() => expect(centerSelect().value).toBe('2801'));
    // Y la fila lo sigue marcando. Se mira el chip de la línea y no el contador de la
    // barra, porque ahí ahora está el mensaje de la cancelación.
    expect(screen.getByText('Sin guardar')).toBeTruthy();
  });

  it('lo mismo con el destino', async () => {
    await renderDetail();
    fireEvent.change(destinationSelect(), { target: { value: '10019279' } });
    expect(destinationSelect().value).toBe('10019279');

    api.getReviewOrder.mockResolvedValue(conLinea1Cancelada());
    await cancelarPrimeraLinea();

    await waitFor(() => expect(destinationSelect().value).toBe('10019279'));
  });

  /** Reactivar recarga igual, y tenía el mismo problema. */
  it('reactivar tampoco descarta los cambios', async () => {
    api.getReviewOrder.mockResolvedValue(conLinea1Cancelada());
    await renderDetail();

    fireEvent.change(centerSelect(), { target: { value: '2801' } });
    expect(centerSelect().value).toBe('2801');

    api.getReviewOrder.mockResolvedValue(order());
    fireEvent.click(button('Reactivar'));
    await waitFor(() => expect(api.reactivateItem).toHaveBeenCalled());

    await waitFor(() => expect(centerSelect().value).toBe('2801'));
  });

  /**
   * El reverso, y es lo que hace segura la regla: una línea que el usuario NO tocó toma
   * lo que trae el servidor. Sin esto, un draft viejo pisaría lo que guardó otra persona
   * con un valor que este usuario nunca eligió.
   */
  it('una línea sin tocar toma el valor que trae el servidor', async () => {
    await renderDetail();
    expect(centerSelect().value).toBe('2802');

    const base = order();
    api.getReviewOrder.mockResolvedValue(
      order({
        items: [
          {
            ...base.items[0],
            cancelledAt: '2026-09-23T10:00:00Z',
            cancelledBy: 'bo@duwest.com',
            noSaleReasonCode: 'SIN_STOCK',
            noSaleReasonNotes: null,
          },
          // Alguien le cambió el centro mientras tanto.
          { ...base.items[1], centerCode: '2801' },
        ],
      }),
    );
    await cancelarPrimeraLinea();

    await waitFor(() => expect(centerSelect().value).toBe('2801'));
    // Y NO queda marcada como pendiente: el valor vino del servidor, no lo eligió nadie acá.
    expect(screen.queryByText('Sin guardar')).toBeNull();
  });
});
