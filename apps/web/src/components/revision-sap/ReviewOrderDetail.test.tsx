import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReviewOrderDetail } from './ReviewOrderDetail';
import { ProductStock, ReviewCatalogs, ReviewOrderDetail as Detail, SapOrder } from './revision-sap.types';

/**
 * Lo que se fija acá: el detalle son DOS pestañas con papeles distintos.
 *
 * "Productos" es la orden tal como se va a reenviar: ahí se corrige el centro y el
 * destino de CADA línea, sin importar en qué orden SAP cayó. "Órdenes SAP" es el
 * historial de cada intento y es solo consulta —ningún selector—, salvo el botón de
 * reenvío, que es por orden SAP y no por la orden entera.
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
  getProductStock: vi.fn(),
}));

vi.mock('./revision-sap.api', () => ({
  getReviewOrder: api.getReviewOrder,
  getReviewCatalogs: api.getReviewCatalogs,
  listSapOrders: api.listSapOrders,
  changeItemDestination: api.changeItemDestination,
  changeItemCenter: api.changeItemCenter,
  getProductStock: api.getProductStock,
  apiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

beforeEach(() => {
  api.getReviewOrder.mockReset().mockResolvedValue(order());
  api.getReviewCatalogs.mockReset().mockResolvedValue(catalogs);
  api.listSapOrders.mockReset().mockResolvedValue(sapOrders);
  api.changeItemDestination.mockReset().mockResolvedValue({});
  api.changeItemCenter.mockReset().mockResolvedValue({});
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

  it('cada orden SAP muestra su centro y su estado, en su pestaña', async () => {
    await renderDetail();
    // Los estados viven en la otra pestaña: no están hasta abrirla.
    expect(screen.queryByText('Aceptada')).toBeNull();

    verOrdenesSap();
    expect(screen.getByText('Centro 2801 · DW Alm. Externo')).toBeTruthy();
    expect(screen.getByText('Centro 2802 · DW Cartago')).toBeTruthy();
    expect(screen.getByText('Aceptada')).toBeTruthy();
    expect(screen.getByText('Rechazada')).toBeTruthy();
    expect(screen.getByText('Pedido 0099900101')).toBeTruthy();
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
    expect(screen.queryByRole('button', { name: 'Ver stock' })).toBeNull();
  });

  it('el reenvío es por orden SAP y todavía no está conectado', async () => {
    await renderDetail();
    verOrdenesSap();
    const reenviar = button('Reenviar esta orden SAP');
    expect(reenviar.disabled).toBe(true);
    expect(screen.getByText(/Se reenvía solo esta orden SAP/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reenviar a SAP' })).toBeNull();
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
    // La línea 3 es el producto 1200135, el que SAP rechazó.
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver stock' })[1]);
    expect(await screen.findByText('Stock de 1200135')).toBeTruthy();
    expect(api.getProductStock).toHaveBeenCalledWith(ORDER, '1200135');
    expect(screen.getByText('Mat / P. Ter')).toBeTruthy();
    expect(screen.getByText('Del cliente')).toBeTruthy();

    fireEvent.click(button('Cerrar'));
    await waitFor(() => expect(screen.queryByText('Stock de 1200135')).toBeNull());
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
