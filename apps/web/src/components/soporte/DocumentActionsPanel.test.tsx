import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DocumentActionsPanel } from './DocumentActionsPanel';
import { DocumentActions, SupportAction } from './soporte.types';

/**
 * Lo que se fija acá: **las acciones que no aplican no se dibujan**.
 *
 * Antes se mostraban deshabilitadas con su motivo, y el usuario tenía que descartar
 * botones grises de a uno para encontrar el que servía. El motivo no se perdió: vive
 * en una nota de la cabecera, a un hover, sin ocupar una fila por acción.
 */

const listActions = vi.fn();

vi.mock('./soporte.api', () => ({
  listActions: (...args: unknown[]) => listActions(...args),
  runAction: vi.fn(),
}));

function accion(over: Partial<SupportAction> = {}): SupportAction {
  return {
    action: 'annul',
    target: null,
    label: 'Anular',
    effect: 'Marca el documento como anulado.',
    available: true,
    reason: null,
    warning: false,
    expects: 'Annulled',
    ...over,
  } as SupportAction;
}

function montar(actions: SupportAction[]) {
  const data: DocumentActions = {
    documentNumber: 'ORD-1',
    statusCode: 'ReadyForApprove',
    actions,
  } as DocumentActions;
  listActions.mockResolvedValue(data);
  return render(
    <DocumentActionsPanel type="order" guid="g" onDocumentStatusChange={() => {}} />,
  );
}

describe('DocumentActionsPanel — qué se dibuja', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('el título ya no es una pregunta', async () => {
    montar([accion()]);
    expect(await screen.findByText('Acciones')).toBeInTheDocument();
    expect(screen.queryByText(/Qué querés/)).toBeNull();
  });

  it('NO dibuja las acciones que no aplican', async () => {
    montar([
      accion({ action: 'annul', label: 'Anular' }),
      accion({
        action: 'revert_to',
        target: 'Draft',
        label: 'Volver a Borrador',
        available: false,
        reason: 'el documento no fue enviado.',
      }),
    ]);
    expect(await screen.findByRole('button', { name: 'Anular' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Volver a Borrador' })).toBeNull();
  });

  it('cuenta las que no aplican y guarda el motivo en el globo', async () => {
    montar([
      accion({ action: 'annul', label: 'Anular' }),
      accion({
        action: 'revert_to',
        target: 'Draft',
        label: 'Volver a Borrador',
        available: false,
        reason: 'el documento no fue enviado.',
      }),
      accion({
        action: 'revert_annulment',
        label: 'Deshacer anulación',
        available: false,
        reason: 'el documento no está anulado.',
      }),
    ]);
    expect(await screen.findByText(/2 acciones no aplican/)).toBeInTheDocument();
    // El detalle queda accesible: el globo del InfoTip es su aria-label.
    const globo = screen.getByLabelText(/Volver a Borrador: el documento no fue enviado/);
    expect(globo).toHaveAttribute('data-tip', expect.stringContaining('Deshacer anulación'));
  });

  it('sin ninguna disponible lo dice, en vez de mostrar una lista de grises', async () => {
    montar([
      accion({ available: false, reason: 'el documento ya está anulado.' }),
    ]);
    expect(
      await screen.findByText('No hay ninguna acción disponible sobre este documento.'),
    ).toBeInTheDocument();
  });

  it('el rótulo ES el botón: no hay un "Aplicar" repetido por acción', async () => {
    montar([accion({ label: 'Anular' }), accion({ action: 'x', label: 'Volver atrás' })]);
    await screen.findByRole('button', { name: 'Anular' });
    expect(screen.queryByRole('button', { name: 'Aplicar' })).toBeNull();
  });
});

describe('DocumentActionsPanel — documento que ya es de SAP', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function montarSap(sap: Record<string, unknown>) {
    listActions.mockResolvedValue({
      documentNumber: 'ORD-1',
      statusCode: 'SentToSAP',
      sap,
      actions: [],
    } as unknown as DocumentActions);
    return render(
      <DocumentActionsPanel type="order" guid="g" onDocumentStatusChange={() => {}} />,
    );
  }

  it('no ofrece ninguna acción y explica por qué', async () => {
    montarSap({
      locked: true,
      sapId: '0000123456',
      message: 'La orden ya tiene identificador de SAP (0000123456): desde la consola de soporte no se puede modificar de ninguna forma.',
    });
    expect(await screen.findByText(/ya tiene identificador de SAP/)).toBeInTheDocument();
    expect(screen.getByText('Bloqueado por SAP')).toBeInTheDocument();
    // Ni siquiera anular, que antes se ofrecía con una advertencia.
    expect(screen.queryByRole('button', { name: /Anular/ })).toBeNull();
  });

  it('distingue el caso entregado-y-SAP-todavía-no-contestó', async () => {
    // Es el que el identificador solo no cubría: 45 órdenes así en QATEST.
    montarSap({ locked: true, entregadoSinId: true, message: 'ya fue entregado a SAP' });
    expect(
      await screen.findByText(/todavía no devolvió su identificador/),
    ).toBeInTheDocument();
  });

  it('un documento normal sigue mostrando sus acciones', async () => {
    listActions.mockResolvedValue({
      documentNumber: 'ORD-1',
      statusCode: 'ReadyForApprove',
      sap: { locked: false },
      actions: [accion({ label: 'Anular' })],
    } as unknown as DocumentActions);
    render(
      <DocumentActionsPanel type="order" guid="g" onDocumentStatusChange={() => {}} />,
    );
    expect(await screen.findByRole('button', { name: 'Anular' })).toBeInTheDocument();
    expect(screen.queryByText('Bloqueado por SAP')).toBeNull();
  });
});
