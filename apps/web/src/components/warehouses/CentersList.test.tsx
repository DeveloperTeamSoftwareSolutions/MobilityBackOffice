import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CentersList } from './CentersList';
import * as api from './warehouses.api';

vi.mock('./warehouses.api');

const CENTROS = [
  {
    companyCode: '1000',
    centerCode: 'C01',
    centerName: 'Guatemala Central',
    warehouseCount: 12,
    restrictedCount: 3,
    restricted: false,
    restrictionReason: null,
    restrictedByEmail: null,
    restrictedAt: null,
  },
  {
    companyCode: '2000',
    centerCode: 'C02',
    centerName: 'San Salvador',
    warehouseCount: 4,
    restrictedCount: 0,
    restricted: true,
    restrictionReason: 'CDI en remodelación',
    restrictedByEmail: 'alguien@empresa.com',
    restrictedAt: '2026-09-01T00:00:00Z',
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getCenters).mockResolvedValue({
    data: CENTROS,
    pagination: { total: 2, page: 1, limit: 50, totalPages: 1 },
  });
});

describe('CentersList', () => {
  it('muestra los conteos de almacenes y de reservados que manda el API', async () => {
    render(<CentersList onSelect={() => {}} />);

    expect(await screen.findByText('C01')).toBeInTheDocument();
    // Los números salen del API: la lista está paginada y no los recalcula.
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('distingue el centro restringido entero del que solo tiene almacenes reservados', async () => {
    render(<CentersList onSelect={() => {}} />);
    await screen.findByText('C01');

    // C01 tiene 3 almacenes reservados pero el CDI sigue en circulación.
    expect(screen.getByText('Disponible')).toBeInTheDocument();
    // C02 no tiene ninguno reservado y aun así está fuera de circulación, con su motivo.
    expect(screen.getByText('Restringido')).toBeInTheDocument();
    expect(screen.getByText(/remodelación/)).toBeInTheDocument();
  });

  it('el click en una columna pide ese orden al servidor', async () => {
    render(<CentersList onSelect={() => {}} />);
    await screen.findByText('C01');

    await userEvent.click(screen.getByRole('button', { name: /almacenes/i }));

    expect(api.getCenters).toHaveBeenLastCalledWith('', 1, 50, 'warehouseCount', 'ASC');
  });

  it('al hacer click en una fila entra al centro', async () => {
    const onSelect = vi.fn();
    render(<CentersList onSelect={onSelect} />);

    await userEvent.click(await screen.findByText('C01'));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ centerCode: 'C01' }));
  });

  it('si el API falla, muestra el error en vez de una tabla vacía sin explicación', async () => {
    vi.mocked(api.getCenters).mockRejectedValue({
      response: { data: { message: 'El middleware no responde' } },
    });
    render(<CentersList onSelect={() => {}} />);

    expect(await screen.findByText(/no responde/)).toBeInTheDocument();
  });
});
