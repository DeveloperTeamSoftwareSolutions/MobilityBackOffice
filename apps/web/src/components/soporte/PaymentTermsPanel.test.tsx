import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaymentTermsPanel } from './PaymentTermsPanel';
import { ManagerTurn, PaymentTerms } from './soporte.types';

/**
 * El plazo de pago es un requisito de CABECERA: manda el documento al gerente aunque
 * ninguna línea lo pida y bloquea el cierre del turno hasta que se decida. Por eso el
 * panel tiene que verse aunque las líneas estén todas resueltas — y por eso mismo no
 * puede ofrecer decisiones que el flujo va a rechazar.
 */

vi.mock('./soporte.api', () => ({
  decidePaymentTerms: vi.fn(),
  respondPaymentTerms: vi.fn(),
}));

function plazo(over: Partial<PaymentTerms> = {}): PaymentTerms {
  return {
    requested: 'Crédito 60 días',
    status: null,
    approved: null,
    decidedByEmail: null,
    decidedAt: null,
    ...over,
  };
}

function turno(over: Partial<ManagerTurn> = {}): ManagerTurn {
  return {
    relevant: true,
    escalatedLines: 0,
    headerRequires: true,
    closed: false,
    resolvedAt: null,
    resolvedByEmail: null,
    ...over,
  };
}

function montar(
  paymentTerms: PaymentTerms,
  managerTurn: ManagerTurn,
  documentStatus: string | null = 'ReadyForApprove',
) {
  return render(
    <PaymentTermsPanel
      type="order"
      guid="g"
      paymentTerms={paymentTerms}
      managerTurn={managerTurn}
      documentStatus={documentStatus}
      onAplicado={() => {}}
    />,
  );
}

describe('PaymentTermsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sin pedido no se dibuja: no hay nada que decidir', () => {
    const { container } = montar(plazo({ requested: null }), turno());
    expect(container).toBeEmptyDOMElement();
  });

  it('muestra lo pedido y el estado como chip', () => {
    montar(plazo(), turno());
    expect(screen.getByText('Crédito 60 días')).toBeInTheDocument();
    expect(screen.getByText('Sin decidir')).toBeInTheDocument();
  });

  it('distingue lo contrapropuesto de lo concedido', () => {
    // Es el mismo campo de la base (`approved`) y significa cosas distintas segun el
    // estado: con `observed` es una propuesta, con `approved` es lo que se otorgo.
    const contra = montar(
      plazo({ status: 'observed', approved: 'Crédito 30 días' }),
      turno(),
    );
    expect(screen.getByText('Lo que contrapropuso el gerente')).toBeInTheDocument();
    contra.unmount();

    montar(plazo({ status: 'approved', approved: 'Crédito 60 días' }), turno());
    expect(screen.getByText('Lo concedido')).toBeInTheDocument();
  });

  it('con el turno abierto le toca al gerente', () => {
    montar(plazo(), turno());
    expect(screen.getByText('Decidir por el gerente')).toBeInTheDocument();
    expect(screen.queryByText('Responder por el vendedor')).toBeNull();
  });

  it('contraofertado y turno cerrado: le toca al vendedor', () => {
    montar(
      plazo({ status: 'observed', approved: 'Crédito 30 días' }),
      turno({ closed: true }),
    );
    expect(screen.getByText('Responder por el vendedor')).toBeInTheDocument();
    expect(screen.queryByText('Decidir por el gerente')).toBeNull();
  });

  it('fuera de los estados negociables no ofrece responder', () => {
    montar(
      plazo({ status: 'observed', approved: 'Crédito 30 días' }),
      turno({ closed: true }),
      'Invoiced',
    );
    expect(screen.queryByText('Responder por el vendedor')).toBeNull();
  });

  it('el campo del plazo aparece solo al contraofertar', () => {
    montar(plazo(), turno());
    fireEvent.click(screen.getByText('Decidir por el gerente'));

    expect(screen.queryByPlaceholderText('Plazo que se contrapropone')).toBeNull();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'observed' } });
    expect(
      screen.getByPlaceholderText('Plazo que se contrapropone'),
    ).toBeInTheDocument();
  });

  it('sin motivo no se puede aplicar', () => {
    montar(plazo(), turno());
    fireEvent.click(screen.getByText('Decidir por el gerente'));
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled();

    fireEvent.change(
      screen.getByPlaceholderText('Motivo: quién lo pidió y por qué'),
      { target: { value: 'lo pidió el gerente' } },
    );
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeEnabled();
  });
});
