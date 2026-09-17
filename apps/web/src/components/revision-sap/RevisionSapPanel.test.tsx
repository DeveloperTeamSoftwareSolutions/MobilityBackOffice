import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RevisionSapPanel } from './RevisionSapPanel';
import { Pagination, ReviewQueueEntry } from './revision-sap.types';

/**
 * Lo que se fija acá son las DOS pestañas de la bandeja.
 *
 * La trampa que hay que cuidar: pendientes y resueltas salen del mismo endpoint y sólo
 * las separa el parámetro `view`. Si alguien dejara de mandarlo, el servidor devuelve
 * pendientes y las dos pestañas muestran lo mismo **sin fallar** — un bug mudo. Por eso
 * se verifica que `view` viaje en cada pedido.
 */

const pagination: Pagination = { total: 1, page: 1, limit: 20, totalPages: 1 };

function entry(over: Partial<ReviewQueueEntry> = {}): ReviewQueueEntry {
  return {
    guid: '11111111-2222-3333-4444-555555555555',
    orderNumber: 'ORD00005729',
    statusCode: 'PendingBackofficeReview',
    customerCode: '10002523',
    customerName: 'CONVENIO DE VENTAS DEMASA',
    sellerEmail: 'vendedor@duwest.com',
    salesArea: {
      companyCode: '2800', channelCode: '10', sectorCode: '10',
      companyName: 'Duwest Cafesa, S.A.', channelName: 'Clientes finales', sectorName: null,
    },
    sapLastError: '[E] El material 1200135 no está ampliado para el centro 2802.',
    sapLastAttemptAt: '2026-09-17T16:00:00Z',
    sapOrderNumber: null,
    sapDispatchNumber: null,
    orderDate: '2026-09-17T15:00:00Z',
    attempts: 2,
    itemCount: 3,
    decidedBy: null,
    decidedAt: null,
    ...over,
  };
}

const resuelta = entry({
  statusCode: 'SentToSAP',
  sapOrderNumber: '0004500123',
  sapDispatchNumber: '0080001234',
  sapLastError: null,
  decidedBy: 'bo@duwest.com',
  decidedAt: '2026-09-17T17:00:00Z',
});

const api = vi.hoisted(() => ({ listReviewQueue: vi.fn() }));

vi.mock('./revision-sap.api', () => ({
  listReviewQueue: api.listReviewQueue,
  apiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

beforeEach(() => {
  api.listReviewQueue.mockReset().mockResolvedValue({ data: [entry()], pagination });
});

/** El `view` del último pedido al servidor. */
const ultimaVista = () =>
  api.listReviewQueue.mock.calls[api.listReviewQueue.mock.calls.length - 1][0].view;

describe('RevisionSapPanel — pendientes y resueltas', () => {
  it('abre en Pendientes y se lo pide así al servidor', async () => {
    render(<RevisionSapPanel />);
    await screen.findByText('ORD00005729');

    expect(screen.getByRole('tab', { name: 'Pendientes' })).toBeTruthy();
    expect(ultimaVista()).toBe('pending');
    // En pendientes lo que importa es por qué está acá.
    expect(screen.getByText('Motivo del rechazo')).toBeTruthy();
    expect(screen.getByText('Intentos')).toBeTruthy();
  });

  it('al pasar a Resueltas pide la OTRA vista, no la misma', async () => {
    render(<RevisionSapPanel />);
    await screen.findByText('ORD00005729');

    api.listReviewQueue.mockResolvedValue({ data: [resuelta], pagination });
    fireEvent.click(screen.getByRole('tab', { name: 'Resueltas' }));

    await waitFor(() => expect(ultimaVista()).toBe('resolved'));
  });

  /** El registro de qué se resolvió y cómo: es para lo que existe la pestaña. */
  it('las resueltas muestran cómo terminó, quién y cuándo', async () => {
    render(<RevisionSapPanel />);
    await screen.findByText('ORD00005729');

    api.listReviewQueue.mockResolvedValue({ data: [resuelta], pagination });
    fireEvent.click(screen.getByRole('tab', { name: 'Resueltas' }));

    expect(await screen.findByText('Enviada a SAP')).toBeTruthy();
    expect(screen.getByText('Pedido 0004500123')).toBeTruthy();
    expect(screen.getByText('Enviado a SAP')).toBeTruthy();   // estado de hoy, traducido
    expect(screen.getByText('bo@duwest.com')).toBeTruthy();
    // Y deja de mostrar lo que ya no se puede accionar.
    expect(screen.queryByText('Motivo del rechazo')).toBeNull();
    expect(screen.queryByText('Intentos')).toBeNull();
  });

  it('una resuelta sin pedido se muestra como cerrada sin enviar', async () => {
    render(<RevisionSapPanel />);
    await screen.findByText('ORD00005729');

    api.listReviewQueue.mockResolvedValue({
      data: [{ ...resuelta, sapOrderNumber: null, sapDispatchNumber: null, statusCode: 'Processed' }],
      pagination,
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Resueltas' }));

    expect(await screen.findByText('Cerrada sin enviar')).toBeTruthy();
    expect(screen.getByText('Procesada')).toBeTruthy();
  });

  /** Pedido sin entrega: el pedido existe pero la mercadería no se despacha. */
  it('una resuelta con pedido y sin entrega lo avisa', async () => {
    render(<RevisionSapPanel />);
    await screen.findByText('ORD00005729');

    api.listReviewQueue.mockResolvedValue({
      data: [{ ...resuelta, sapDispatchNumber: null }],
      pagination,
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Resueltas' }));

    expect(await screen.findByText('Sin entrega')).toBeTruthy();
    expect(screen.getByText(/se resuelve en SAP/)).toBeTruthy();
  });

  it('el contador dice de qué está contando en cada pestaña', async () => {
    render(<RevisionSapPanel />);
    expect(await screen.findByText('1 orden en revisión')).toBeTruthy();

    api.listReviewQueue.mockResolvedValue({ data: [resuelta], pagination });
    fireEvent.click(screen.getByRole('tab', { name: 'Resueltas' }));
    expect(await screen.findByText('1 orden resuelta')).toBeTruthy();
  });

  it('la pestaña vacía explica para qué sirve en vez de decir "no hay nada"', async () => {
    render(<RevisionSapPanel />);
    await screen.findByText('ORD00005729');

    api.listReviewQueue.mockResolvedValue({ data: [], pagination: { ...pagination, total: 0, totalPages: 0 } });
    fireEvent.click(screen.getByRole('tab', { name: 'Resueltas' }));

    expect(await screen.findByText(/Todavía no se resolvió ninguna orden/)).toBeTruthy();
  });
});
