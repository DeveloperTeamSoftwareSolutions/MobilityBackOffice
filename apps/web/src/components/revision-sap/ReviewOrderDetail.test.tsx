import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReviewOrderDetail } from './ReviewOrderDetail';
import { ReviewCatalogs, ReviewOrderDetail as Detail } from './revision-sap.types';

/**
 * Lo que se fija acá es que BackOffice nunca reenvía algo distinto de lo que ve:
 * cada cambio queda marcado, se puede descartar, y un dato que SAP rechaza seguro
 * deshabilita el reenvío.
 */

const order: Detail = {
  guid: 'orden-1',
  orderNumber: 'ORD-00000001',
  customerCode: '10090011',
  customerName: 'Cliente de prueba',
  sellerEmail: 'vendedor@example.com',
  salesArea: { companyCode: '2100', channelCode: '10', sectorCode: '10' },
  sapError: 'Material 100245: no ampliado para el centro 2102.',
  rejectedAt: '2026-09-15T13:05:00Z',
  attempts: 1,
  itemCount: 1,
  orderDate: '2026-09-14T15:20:00Z',
  headerCenterCode: '2102',
  headerDestinationCode: '30001187',
  sapAttempts: [
    { attemptAt: '2026-09-15T13:05:00Z', message: 'Material 100245: no ampliado para el centro 2102.' },
  ],
  items: [
    {
      guid: 'item-1',
      lineNumber: 1,
      productCode: '100245',
      productName: 'Glifosato',
      quantity: 40,
      unitOfMeasure: 'UN',
      centerCode: '2102',
      destinationCode: '30001187',
    },
  ],
};

const catalogs: ReviewCatalogs = {
  centers: [
    { centerCode: '2101', centerName: 'CD Villa Nueva' },
    { centerCode: '2102', centerName: 'CD Escuintla' },
    { centerCode: '2104', centerName: 'CD Quetzaltenango' },
  ],
  destinations: [
    { destinationCode: '30001187', destinationName: 'Bodega central', deliveryAddress: 'Km 17.5' },
    { destinationCode: '30001190', destinationName: 'Finca San Rafael', deliveryAddress: null },
  ],
  stock: { '100245': { '2101': 320, '2102': 0, '2104': 15 } },
};

vi.mock('./revision-sap.api', () => ({
  getReviewOrder: vi.fn(async () => structuredClone(order)),
  getReviewCatalogs: vi.fn(async () => structuredClone(catalogs)),
  ReviewOrderNotFoundError: class extends Error {},
}));

async function renderDetail() {
  render(<ReviewOrderDetail guid="orden-1" onBack={() => undefined} />);
  await screen.findByText('ORD-00000001');
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

describe('ReviewOrderDetail', () => {
  it('muestra el motivo del rechazo y no muestra precios', async () => {
    await renderDetail();
    expect(screen.getAllByText(/no ampliado para el centro 2102/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/precio|descuento|total/i)).toBeNull();
  });

  it('la línea sin stock en su centro avisa pero deja reenviar', async () => {
    await renderDetail();
    expect(screen.getByText(/Sin stock en el centro 2102/)).toBeTruthy();
    expect(button('Reenviar a SAP').disabled).toBe(false);
    expect(screen.getByText('Sin cambios')).toBeTruthy();
  });

  it('cambiar el centro marca la línea y se puede descartar', async () => {
    await renderDetail();
    fireEvent.change(screen.getByLabelText('Centro de distribución de la línea 1'), {
      target: { value: '2101' },
    });
    expect(screen.getByText('1 ítem modificado')).toBeTruthy();
    expect(screen.getByText('Modificado')).toBeTruthy();
    expect(screen.queryByText(/Sin stock/)).toBeNull();

    fireEvent.click(button('Descartar cambios'));
    expect(screen.getByText('Sin cambios')).toBeTruthy();
    expect(button('Descartar cambios').disabled).toBe(true);
  });

  it('quitar el destino deshabilita el reenvío', async () => {
    await renderDetail();
    fireEvent.change(screen.getByLabelText('Destino de entrega de la línea 1'), {
      target: { value: '' },
    });
    expect(screen.getByText('Elegí un destino de entrega.')).toBeTruthy();
    expect(button('Reenviar a SAP').disabled).toBe(true);
  });

  it('la confirmación lista el cambio y no deja confirmar en la vista previa', async () => {
    await renderDetail();
    fireEvent.change(screen.getByLabelText('Destino de entrega de la línea 1'), {
      target: { value: '30001190' },
    });
    fireEvent.click(button('Reenviar a SAP'));

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Destino: 30001187 · Bodega central');
    expect(dialog.textContent).toContain('30001190 · Finca San Rafael');
    expect(button('Confirmar reenvío').disabled).toBe(true);

    fireEvent.click(button('Cancelar'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
