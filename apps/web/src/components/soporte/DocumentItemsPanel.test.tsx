import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DocumentItemsPanel } from './DocumentItemsPanel';
import { DocumentItems, ManagerTurn, SupportItem } from './soporte.types';

/**
 * Lo que se fija acá es UNA regla: la consola no ofrece una decisión que el
 * middleware va a rechazar.
 *
 * No es una preferencia estética. Con las acciones de cabecera ya pasó que un botón
 * disponible fallaba al apretarlo, y desde afuera "no corresponde" y "está roto" se
 * ven igual. Las condiciones de `disponibilidad` son las mismas que aplica el flujo:
 * turno cerrado, ronda única, línea no escalada.
 */

const listItems = vi.fn();
const decideItem = vi.fn();
const respondItem = vi.fn();
const recompute = vi.fn();

vi.mock('./soporte.api', () => ({
  listItems: (...args: unknown[]) => listItems(...args),
  decideItem: (...args: unknown[]) => decideItem(...args),
  respondItem: (...args: unknown[]) => respondItem(...args),
  recompute: (...args: unknown[]) => recompute(...args),
  decidePaymentTerms: vi.fn(),
  respondPaymentTerms: vi.fn(),
}));

function item(over: Partial<SupportItem> = {}): SupportItem {
  return {
    guid: 'item-1',
    lineNumber: 1,
    productCode: 'PROD-1',
    productDescription: 'Producto de prueba',
    unitOfMeasure: 'UN',
    quantity: 2,
    unitPrice: 100,
    lineTotal: 200,
    authorizationRequired: true,
    authorizationStatus: null,
    authorizationReason: null,
    authTriggerReason: null,
    proposedPrice: null,
    proposedPriceCurrency: null,
    decidedByEmail: null,
    decidedAt: null,
    sellerResponse: null,
    sellerResponseReason: null,
    sellerRespondedByEmail: null,
    sellerRespondedAt: null,
    ...over,
  };
}

function turno(over: Partial<ManagerTurn> = {}): ManagerTurn {
  return {
    relevant: true,
    escalatedLines: 1,
    headerRequires: false,
    closed: false,
    resolvedAt: null,
    resolvedByEmail: null,
    ...over,
  };
}

function datos(
  items: SupportItem[],
  managerTurn: ManagerTurn,
  statusCode = 'ReadyForApprove',
): DocumentItems {
  return {
    document: { guid: 'g', documentNumber: 'ORD-1', statusCode },
    paymentTerms: {
      requested: null,
      status: null,
      approved: null,
      decidedByEmail: null,
      decidedAt: null,
    },
    managerTurn,
    items,
  };
}

function montar(
  items: SupportItem[],
  managerTurn: ManagerTurn,
  statusCode = 'ReadyForApprove',
) {
  listItems.mockResolvedValue(datos(items, managerTurn, statusCode));
  return render(
    <DocumentItemsPanel type="order" guid="g" onDocumentStatusChange={() => {}} />,
  );
}

describe('DocumentItemsPanel — qué decisiones se ofrecen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('con el turno abierto y la línea sin decidir, ofrece decidir por el gerente', async () => {
    montar([item()], turno());
    expect(await screen.findByText('Decidir por el gerente')).toBeInTheDocument();
    expect(screen.queryByText('Responder por el vendedor')).toBeNull();
  });

  it('con el turno CERRADO no ofrece decidir: el flujo responde already_resolved', async () => {
    montar([item()], turno({ closed: true, resolvedByEmail: 'gerente@duwest.com' }));
    await waitFor(() => expect(listItems).toHaveBeenCalled());
    expect(screen.queryByText('Decidir por el gerente')).toBeNull();
    expect(
      await screen.findByText(/reabrirlo desde las acciones del documento/),
    ).toBeInTheDocument();
  });

  it('contraofertada y turno cerrado: le toca al vendedor, no al gerente', async () => {
    montar([item({ authorizationStatus: 'countered', proposedPrice: 88 })], turno({ closed: true }));
    expect(await screen.findByText('Responder por el vendedor')).toBeInTheDocument();
    expect(screen.queryByText('Decidir por el gerente')).toBeNull();
  });

  it('si el vendedor ya respondió, no ofrece nada: la ronda es una sola', async () => {
    montar(
      [item({ authorizationStatus: 'countered', sellerResponse: 'accepted' })],
      turno({ closed: true }),
    );
    expect(
      await screen.findByText(/El vendedor ya respondió y la ronda es una sola/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Decidir por el gerente')).toBeNull();
    expect(screen.queryByText('Responder por el vendedor')).toBeNull();
  });

  it('una línea que no requiere autorización no tiene decisiones', async () => {
    montar([item({ authorizationRequired: false })], turno({ relevant: false, escalatedLines: 0 }));
    expect(await screen.findByText('No requiere autorización.')).toBeInTheDocument();
  });

  it('contraofertada SIN precio: no se puede responder, y lo dice', async () => {
    // El flujo exige `proposedPrice` para responder (`not_countered`). Pasa con
    // líneas viejas anteriores a esa columna. Lo encontró el banco de pruebas.
    montar([item({ authorizationStatus: 'countered', proposedPrice: null })], turno({ closed: true }));
    expect(
      await screen.findByText(/La contraoferta no tiene precio/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Responder por el vendedor')).toBeNull();
  });

  it('documento fuera de los estados negociables: tampoco se puede responder', async () => {
    montar(
      [item({ authorizationStatus: 'countered', proposedPrice: 88 })],
      turno({ closed: true }),
      'Invoiced',
    );
    expect(await screen.findByText(/ya no admite respuestas sobre sus líneas/)).toBeInTheDocument();
    expect(screen.queryByText('Responder por el vendedor')).toBeNull();
  });

  it('avisa del turno pendiente solo mientras el documento espere al gerente', async () => {
    montar([item()], turno());
    expect(
      await screen.findByText(/El gerente todavía no cerró su turno/),
    ).toBeInTheDocument();
  });

  it('NO avisa del turno pendiente si el documento ya avanzó', async () => {
    // ORD-00005419: solo-cabecera, plazo decidido, sin fila de resolución. El aviso
    // decía que iba a quedarse en ReadyForApprove cuando ya estaba en Processed.
    montar(
      [item({ authorizationRequired: false })],
      turno({ relevant: true, escalatedLines: 0, headerRequires: true }),
      'Processed',
    );
    await waitFor(() => expect(listItems).toHaveBeenCalled());
    expect(screen.queryByText(/El gerente todavía no cerró su turno/)).toBeNull();
    expect(
      await screen.findByText(/no tenía ninguna línea escalada/),
    ).toBeInTheDocument();
  });

  it('dice que el cierre del turno no se hace desde la consola', async () => {
    montar([item()], turno());
    expect(
      await screen.findByText(/El cierre no se puede hacer desde acá/),
    ).toBeInTheDocument();
  });

  it('muestra la contraoferta vigente junto al precio', async () => {
    montar(
      [item({ authorizationStatus: 'countered', proposedPrice: 88, proposedPriceCurrency: 'USD' })],
      turno({ closed: true }),
    );
    expect(await screen.findByText(/Contraoferta: 88 USD/)).toBeInTheDocument();
  });
});
