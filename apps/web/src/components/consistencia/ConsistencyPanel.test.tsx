import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AxiosError, AxiosResponse } from 'axios';
import { ConsistencyPanel } from './ConsistencyPanel';
import { Finding, FindingsPage, Summary } from './consistencia.types';

/**
 * Lo que se fija acá es el recorrido completo de un hallazgo: listarlo, filtrarlo por
 * situación desde la tarjeta, abrirlo y corregirlo. Las trampas que se cuidan:
 * - que el filtro de la tarjeta viaje al servidor (si no, filtra en silencio nada);
 * - que lo que se resuelve en ITManager no ofrezca botones que después fallarían;
 * - que la baja pida la segunda confirmación y que toda escritura lleve `findingGroup`;
 * - que un 409 se muestre en el formulario con la opción de recargar.
 */

const api = vi.hoisted(() => ({
  getSummary: vi.fn(),
  listFindings: vi.fn(),
  listNodes: vi.fn(),
  listCustomerGaps: vi.fn(),
  createMember: vi.fn(),
  fixMemberSapUserId: vi.fn(),
  removeMember: vi.fn(),
  assignPortfolioOwner: vi.fn(),
}));

vi.mock('./consistencia.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./consistencia.api')>();
  return { ...actual, ...api };
});

const summary: Summary = {
  generatedAt: Date.now() - 5 * 60_000,
  total: 3,
  sapAccountsAvailable: true,
  categories: { JERARQUIA: 3, CARTERA: 0, USUARIOS_SAP: 0 },
  groups: [
    {
      group: 'CARTERA_SIN_JERARQUIA',
      label: 'Vendedor con cartera y sin jerarquía',
      hint: 'Tiene clientes pero no cuelga de ningún nodo.',
      category: 'JERARQUIA',
      severity: 'alta',
      resolution: 'BACKOFFICE',
      count: 2,
    },
    {
      group: 'ROL_SIN_SAPUSERID',
      label: 'Rol comercial sin usuario SAP',
      hint: 'Se corrige en la ficha del usuario.',
      category: 'JERARQUIA',
      severity: 'media',
      resolution: 'ITMANAGER',
      count: 1,
    },
  ],
};

function finding(over: Partial<Finding>): Finding {
  return {
    key: 'k',
    group: 'CARTERA_SIN_JERARQUIA',
    category: 'JERARQUIA',
    severity: 'alta',
    resolution: 'BACKOFFICE',
    label: 'Vendedor con cartera y sin jerarquía',
    companyCode: '2800',
    sapUserId: 'VEND01',
    personName: 'Ana Pérez',
    email: 'ana@duwest.com',
    guidUsers: 'user-1',
    roles: ['MOBILITY_2.0IA_WEB_VENDEDOR'],
    members: [],
    portfolios: [],
    sapAccount: null,
    suggestion: null,
    detail: 'Tiene 12 clientes en cartera.',
    actions: [],
    ...over,
  };
}

const alta = finding({ key: 'f1', actions: ['ALTA_MIEMBRO'] });
const itm = finding({
  key: 'f2',
  group: 'ROL_SIN_SAPUSERID',
  resolution: 'ITMANAGER',
  label: 'Rol comercial sin usuario SAP',
  personName: 'Beto Gómez',
  sapUserId: null,
  actions: [],
});
const baja = finding({
  key: 'f3',
  group: 'IDENTIDAD_MAL_APAREADA',
  personName: 'Carla Díaz',
  label: 'Identidad mal apareada',
  actions: ['BAJA_MIEMBRO'],
  members: [
    {
      guid: 'member-9',
      sapUserId: 'CARLA',
      memberName: 'Carla Díaz',
      role: 'Vendedor',
      guidNode: 'n1',
      nodeName: 'Guatemala Norte',
      nodeCountry: 'GT',
    },
  ],
});

function page(data: Finding[]): FindingsPage {
  return {
    data,
    companies: ['2800', '3100'],
    generatedAt: summary.generatedAt,
    pagination: { total: data.length, page: 1, limit: 20, totalPages: 1 },
  };
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.getSummary.mockResolvedValue(summary);
  api.listFindings.mockResolvedValue(page([alta, itm, baja]));
  api.listCustomerGaps.mockResolvedValue({
    available: false,
    data: [],
    summary: {},
    pagination: { total: 0, page: 1, limit: 0, totalPages: 0 },
  });
  api.listNodes.mockResolvedValue({
    nodes: [
      { guid: 'n1', guidParent: null, name: 'Guatemala Norte', country: 'GT', businessUnit: null, region: null },
      { guid: 'n2', guidParent: null, name: 'Costa Rica', country: 'CR', businessUnit: null, region: null },
    ],
    roles: ['Vendedor', 'Gerente'],
  });
});

const lastFindingsQuery = () =>
  api.listFindings.mock.calls[api.listFindings.mock.calls.length - 1][0];

async function openDetail(person: string) {
  render(<ConsistencyPanel />);
  await screen.findByText(person);
  const row = screen.getByText(person).closest('tr') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: /^Ver/ }));
  return screen.getByRole('dialog');
}

describe('ConsistencyPanel', () => {
  it('lista los hallazgos de la categoría y muestra los conteos en las pestañas', async () => {
    render(<ConsistencyPanel />);
    expect(await screen.findByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByText('Beto Gómez')).toBeInTheDocument();
    expect(lastFindingsQuery()).toMatchObject({ category: 'JERARQUIA', page: 1 });
    expect(screen.getByRole('tab', { name: /Jerarquía comercial\s*3/ })).toBeInTheDocument();
    expect(screen.getByText(/Generado hace 5 minutos/)).toBeInTheDocument();
  });

  it('la tarjeta filtra por su situación en el servidor y un segundo clic lo quita', async () => {
    render(<ConsistencyPanel />);
    await screen.findByText('Ana Pérez');
    const cards = screen.getByRole('group', { name: 'Situaciones de la categoría' });
    const card = within(cards).getByRole('button', { name: /Vendedor con cartera y sin jerarquía/ });

    fireEvent.click(card);
    await waitFor(() => expect(lastFindingsQuery().group).toBe('CARTERA_SIN_JERARQUIA'));
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/no cuelga de ningún nodo/)).toBeInTheDocument();

    fireEvent.click(card);
    await waitFor(() => expect(lastFindingsQuery().group).toBeNull());
  });

  it('lo que se resuelve en ITManager no ofrece correcciones', async () => {
    const dialog = await openDetail('Beto Gómez');
    expect(within(dialog).getByText('Esto se resuelve en ITManager.')).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: /Dar de alta|Corregir|Dar de baja|Asignar dueño/ }),
    ).not.toBeInTheDocument();
  });

  it('el alta valida el motivo y postea el cuerpo con findingGroup', async () => {
    api.createMember.mockResolvedValue({ guid: 'nuevo' });
    const dialog = await openDetail('Ana Pérez');
    await within(dialog).findByLabelText('Nodo de la jerarquía (obligatorio)');

    fireEvent.change(within(dialog).getByLabelText('Nodo de la jerarquía (obligatorio)'), {
      target: { value: 'n1' },
    });
    fireEvent.change(within(dialog).getByLabelText('Rol (obligatorio)'), {
      target: { value: 'Vendedor' },
    });
    fireEvent.change(within(dialog).getByLabelText('Motivo (obligatorio)'), {
      target: { value: 'abc' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de alta' }));

    expect(
      await within(dialog).findByText('El motivo debe tener al menos 5 caracteres.'),
    ).toBeInTheDocument();
    expect(api.createMember).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Motivo (obligatorio)'), {
      target: { value: 'Falta en la jerarquía de Guatemala' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de alta' }));

    await waitFor(() => expect(api.createMember).toHaveBeenCalledTimes(1));
    expect(api.createMember).toHaveBeenCalledWith({
      guidCommercialTeamHierarchies: 'n1',
      memberSapUserId: 'VEND01',
      memberName: 'Ana Pérez',
      role: 'Vendedor',
      memberGuidUsers: 'user-1',
      reason: 'Falta en la jerarquía de Guatemala',
      findingGroup: 'CARTERA_SIN_JERARQUIA',
    });
    expect(
      await screen.findByText('Se dio de alta al miembro en la jerarquía comercial.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Tras la corrección se recalcula el resumen.
    expect(api.getSummary).toHaveBeenLastCalledWith(true);
  });

  it('la baja exige una segunda confirmación', async () => {
    api.removeMember.mockResolvedValue(null);
    const dialog = await openDetail('Carla Díaz');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de baja' }));
    expect(api.removeMember).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Motivo de la baja (obligatorio)'), {
      target: { value: 'Ya no trabaja en la región' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar baja' }));

    await waitFor(() =>
      expect(api.removeMember).toHaveBeenCalledWith('member-9', {
        reason: 'Ya no trabaja en la región',
        findingGroup: 'IDENTIDAD_MAL_APAREADA',
      }),
    );
  });

  it('un 409 se muestra en el formulario y ofrece recargar', async () => {
    api.createMember.mockRejectedValue(
      new AxiosError('conflict', '409', undefined, undefined, {
        status: 409,
        data: { success: false, message: 'El miembro ya existe en ese nodo.' },
      } as AxiosResponse),
    );
    const dialog = await openDetail('Ana Pérez');
    await within(dialog).findByLabelText('Nodo de la jerarquía (obligatorio)');
    fireEvent.change(within(dialog).getByLabelText('Nodo de la jerarquía (obligatorio)'), {
      target: { value: 'n2' },
    });
    fireEvent.change(within(dialog).getByLabelText('Rol (obligatorio)'), {
      target: { value: 'Gerente' },
    });
    fireEvent.change(within(dialog).getByLabelText('Motivo (obligatorio)'), {
      target: { value: 'Corrección de prueba' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de alta' }));

    expect(await within(dialog).findByText('El miembro ya existe en ese nodo.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Recargar' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('clientes vs SAP no disponible muestra un aviso neutro', async () => {
    render(<ConsistencyPanel />);
    await screen.findByText('Ana Pérez');
    fireEvent.click(screen.getByRole('tab', { name: /Clientes vs SAP/ }));
    expect(
      await screen.findByText('Todavía no está disponible en este ambiente.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
