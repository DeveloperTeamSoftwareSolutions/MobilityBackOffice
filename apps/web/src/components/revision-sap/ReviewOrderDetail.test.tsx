import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReviewOrderDetail } from './ReviewOrderDetail';
import { ReviewCatalogs, ReviewOrderDetail as Detail } from './revision-sap.types';

/**
 * Lo que se fija acá es que BackOffice nunca guarda algo distinto de lo que ve: cada
 * cambio de centro o destino queda marcado hasta guardarse, se puede descartar, lo que
 * el servidor rechaza deshabilita el guardado, y el reenvío no sale con cambios sin
 * guardar.
 */

const ORDER = '11111111-2222-3333-4444-555555555555';

function order(over: Partial<Detail> = {}): Detail {
  return {
    guid: ORDER,
    orderNumber: 'ORD00005724',
    statusCode: 'Processed',
    customerCode: '10002523',
    customerName: 'CONVENIO DE VENTAS DEMASA',
    sellerEmail: 'vendedor@duwest.com',
    sellerName: 'Vendedor',
    salesArea: { companyCode: '2800', channelCode: '10', sectorCode: '10' },
    centerCode: '2801',
    centerName: 'DW Alm. Externo',
    destination: null,
    orderDate: '2026-09-15T15:30:46.046Z',
    cancelledAt: null,
    sap: { orderNumber: null, lastError: 'Destinatario 30000112 no definido para el área', lastAttemptAt: '2026-09-15T16:00:00Z' },
    backoffice: { inReview: true, decidedBy: null, decidedAt: null },
    items: [
      {
        guid: 'item-1',
        lineNumber: 1,
        productCode: '1001917',
        productDescription: 'ACTIV 80 AG 23KG',
        quantity: 1,
        unitOfMeasure: 'UN',
        centerCode: null,
        deliveryDestinationCode: '30000124',
        deliveryDestinationName: 'Inversiones',
      },
    ],
    sapAttempts: [{ guid: 'a1', attemptAt: '2026-09-15T16:00:00Z', statusCode: 'Draft', error: 'Destinatario 30000112 no definido para el área' }],
    ...over,
  };
}

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

const api = vi.hoisted(() => ({
  getReviewOrder: vi.fn(),
  getReviewCatalogs: vi.fn(),
  changeItemDestination: vi.fn(),
  changeItemCenter: vi.fn(),
  listSapOrders: vi.fn(),
}));

vi.mock('./revision-sap.api', () => ({
  getReviewOrder: api.getReviewOrder,
  getReviewCatalogs: api.getReviewCatalogs,
  changeItemDestination: api.changeItemDestination,
  changeItemCenter: api.changeItemCenter,
  listSapOrders: api.listSapOrders,
  apiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

beforeEach(() => {
  api.getReviewOrder.mockReset().mockResolvedValue(order());
  api.getReviewCatalogs.mockReset().mockImplementation(async (_guid: string, includeStock: boolean) =>
    includeStock ? { ...catalogs, stock: { '1001917': { '2801': 0, '2802': 50 } } } : catalogs,
  );
  api.changeItemDestination.mockReset().mockResolvedValue({});
  api.changeItemCenter.mockReset().mockResolvedValue({});
  api.listSapOrders.mockReset().mockResolvedValue([]);
});

async function renderDetail() {
  render(<ReviewOrderDetail guid={ORDER} onBack={() => undefined} />);
  await screen.findByText('ORD00005724');
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
const destinationSelect = () => select('Destino de entrega de la línea 1');
const centerSelect = () => select('Centro de distribución de la línea 1');

describe('ReviewOrderDetail', () => {
  it('muestra el motivo del rechazo y no muestra precios', async () => {
    await renderDetail();
    expect(screen.getByText(/no definido para el área/)).toBeTruthy();
    expect(screen.queryByText(/precio|descuento|total/i)).toBeNull();
  });

  it('pide primero sin stock y después con stock, y avisa si no hay en el centro de cabecera', async () => {
    await renderDetail();
    expect(api.getReviewCatalogs).toHaveBeenNthCalledWith(1, ORDER, false);
    expect(api.getReviewCatalogs).toHaveBeenNthCalledWith(2, ORDER, true);
    expect(await screen.findByText(/Sin stock en el centro 2801/)).toBeTruthy();
  });

  it('cambiar el destino queda sin guardar, bloquea el reenvío y se puede descartar', async () => {
    await renderDetail();
    fireEvent.change(destinationSelect(), { target: { value: '10019279' } });
    expect(screen.getByText('1 cambio sin guardar')).toBeTruthy();
    expect(button('Reenviar a SAP').disabled).toBe(true);

    fireEvent.click(button('Descartar cambios'));
    expect(screen.getByText('Sin cambios')).toBeTruthy();
    expect(destinationSelect().value).toBe('30000124');
  });

  it('guardar manda el centro y el destino de la línea al servidor y recarga la orden', async () => {
    await renderDetail();
    fireEvent.change(centerSelect(), { target: { value: '2802' } });
    fireEvent.change(destinationSelect(), { target: { value: '10019279' } });
    expect(screen.getByText('2 cambios sin guardar')).toBeTruthy();
    expect(screen.getByText(/Si se reenvía así, sale en 1 orden SAP/)).toBeTruthy();

    api.getReviewOrder.mockResolvedValue(
      order({
        items: [{ ...order().items[0], centerCode: '2802', deliveryDestinationCode: '10019279', deliveryDestinationName: 'Lobo Cruz' }],
      }),
    );
    fireEvent.click(button('Guardar cambios'));
    await screen.findByText('Se guardaron 2 cambios.');
    expect(api.changeItemCenter).toHaveBeenCalledWith(ORDER, 'item-1', '2802');
    expect(api.changeItemDestination).toHaveBeenCalledWith(ORDER, 'item-1', '10019279');
    expect(centerSelect().value).toBe('2802');
    expect(button('Reenviar a SAP').disabled).toBe(false);
  });

  it('si el servidor rechaza un cambio, el error queda en la línea y el cambio sigue pendiente', async () => {
    await renderDetail();
    fireEvent.change(centerSelect(), { target: { value: '2802' } });
    api.changeItemCenter.mockRejectedValue(new Error('400'));

    fireEvent.click(button('Guardar cambios'));
    await screen.findByText('No se pudo guardar el centro.');
    await waitFor(() => expect(centerSelect().value).toBe('2802'));
    expect(screen.getByText('1 cambio sin guardar')).toBeTruthy();
  });

  it('quitar el destino deshabilita guardar', async () => {
    await renderDetail();
    fireEvent.change(destinationSelect(), { target: { value: '' } });
    expect(screen.getByText('Elegí un destino de entrega.')).toBeTruthy();
    expect(button('Guardar cambios').disabled).toBe(true);
  });

  it('una orden que ya no está en revisión se muestra en solo lectura', async () => {
    api.getReviewOrder.mockResolvedValue(
      order({ backoffice: { inReview: false, decidedBy: 'bo@duwest.com', decidedAt: '2026-09-15T17:00:00Z' } }),
    );
    await renderDetail();
    expect(screen.getByText(/ya no está en revisión/)).toBeTruthy();
    expect(destinationSelect().disabled).toBe(true);
    expect(centerSelect().disabled).toBe(true);
    expect(button('Reenviar a SAP').disabled).toBe(true);
  });

  it('la pestaña de órdenes SAP muestra cada una con su estado', async () => {
    api.listSapOrders.mockResolvedValue([
      { guid: 's1', status: 'accepted', statusCode: 'Authorized', centerCode: '2801', centerName: 'DW Alm. Externo', attemptAt: '2026-09-15T10:00:00Z', sapOrderNumber: '0004500123', sapDispatchNumber: '0080001234', error: null, items: [{ lineNumber: 1, productCode: '1001917', description: 'ACTIV', quantity: 1, unitOfMeasure: 'UN' }] },
      { guid: 's2', status: 'rejected', statusCode: 'Draft', centerCode: '2802', centerName: 'DW Cartago', attemptAt: '2026-09-15T10:01:00Z', sapOrderNumber: null, sapDispatchNumber: null, error: 'Material no ampliado para el centro 2802', items: [] },
    ]);
    await renderDetail();
    fireEvent.click(screen.getByRole('tab', { name: 'Órdenes SAP' }));
    expect(await screen.findByText('Pedido 0004500123')).toBeTruthy();
    expect(screen.getByText('Centro 2801 · DW Alm. Externo')).toBeTruthy();
    expect(screen.getByText('Centro 2802 · DW Cartago')).toBeTruthy();
    expect(screen.getByText(/ya se enviaron/)).toBeTruthy();
    expect(screen.getByText('Aceptada')).toBeTruthy();
    expect(screen.getByText('Rechazada')).toBeTruthy();
    expect(screen.getByText('Material no ampliado para el centro 2802')).toBeTruthy();
    expect(api.listSapOrders).toHaveBeenCalledWith(ORDER);
  });

  it('la confirmación del reenvío no deja confirmar mientras no esté conectado', async () => {
    await renderDetail();
    fireEvent.click(button('Reenviar a SAP'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(button('Confirmar reenvío').disabled).toBe(true);
    fireEvent.click(button('Cancelar'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
