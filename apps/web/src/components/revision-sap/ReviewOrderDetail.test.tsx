import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReviewOrderDetail } from './ReviewOrderDetail';
import { ReviewCatalogs, ReviewOrderDetail as Detail } from './revision-sap.types';

/**
 * Lo que se fija acá es que BackOffice nunca guarda algo distinto de lo que ve: cada
 * cambio queda marcado hasta guardarse, se puede descartar, un destino que el servidor
 * rechaza deshabilita el guardado, y el reenvío no sale con cambios sin guardar.
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
  centers: [{ centerCode: '2801', centerName: 'DW Alm. Externo' }],
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
}));

vi.mock('./revision-sap.api', () => ({
  getReviewOrder: api.getReviewOrder,
  getReviewCatalogs: api.getReviewCatalogs,
  changeItemDestination: api.changeItemDestination,
  apiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

beforeEach(() => {
  api.getReviewOrder.mockReset().mockResolvedValue(order());
  api.getReviewCatalogs.mockReset().mockImplementation(async (_guid: string, includeStock: boolean) =>
    includeStock ? { ...catalogs, stock: { '1001917': { '2801': 0 } } } : catalogs,
  );
  api.changeItemDestination.mockReset().mockResolvedValue({});
});

async function renderDetail() {
  render(<ReviewOrderDetail guid={ORDER} onBack={() => undefined} />);
  await screen.findByText('ORD00005724');
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

const destinationSelect = () =>
  screen.getByLabelText('Destino de entrega de la línea 1') as HTMLSelectElement;

describe('ReviewOrderDetail', () => {
  it('muestra el motivo del rechazo y no muestra precios', async () => {
    await renderDetail();
    expect(screen.getByText(/no definido para el área/)).toBeTruthy();
    expect(screen.queryByText(/precio|descuento|total/i)).toBeNull();
  });

  it('pide primero sin stock y después con stock, y avisa si no hay', async () => {
    await renderDetail();
    expect(api.getReviewCatalogs).toHaveBeenNthCalledWith(1, ORDER, false);
    expect(api.getReviewCatalogs).toHaveBeenNthCalledWith(2, ORDER, true);
    expect(await screen.findByText(/Sin stock en el centro 2801/)).toBeTruthy();
  });

  it('cambiar el destino queda sin guardar, bloquea el reenvío y se puede descartar', async () => {
    await renderDetail();
    fireEvent.change(destinationSelect(), { target: { value: '10019279' } });
    expect(screen.getByText('1 destino sin guardar')).toBeTruthy();
    expect(button('Reenviar a SAP').disabled).toBe(true);

    fireEvent.click(button('Descartar cambios'));
    expect(screen.getByText('Sin cambios')).toBeTruthy();
    expect(destinationSelect().value).toBe('30000124');
  });

  it('guardar llama al servidor por la línea cambiada y recarga la orden', async () => {
    await renderDetail();
    fireEvent.change(destinationSelect(), { target: { value: '10019279' } });
    api.getReviewOrder.mockResolvedValue(
      order({ items: [{ ...order().items[0], deliveryDestinationCode: '10019279', deliveryDestinationName: 'Lobo Cruz' }] }),
    );

    fireEvent.click(button('Guardar cambios'));
    await screen.findByText('Se guardó 1 destino.');
    expect(api.changeItemDestination).toHaveBeenCalledWith(ORDER, 'item-1', '10019279');
    expect(destinationSelect().value).toBe('10019279');
    expect(button('Reenviar a SAP').disabled).toBe(false);
  });

  it('si el servidor rechaza un destino, el error queda en la línea y el cambio sigue pendiente', async () => {
    await renderDetail();
    fireEvent.change(destinationSelect(), { target: { value: '10019279' } });
    api.changeItemDestination.mockRejectedValue(new Error('409'));

    fireEvent.click(button('Guardar cambios'));
    await screen.findByText('No se pudo guardar el destino.');
    await waitFor(() => expect(destinationSelect().value).toBe('10019279'));
    expect(screen.getByText('1 destino sin guardar')).toBeTruthy();
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
    expect(button('Reenviar a SAP').disabled).toBe(true);
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
