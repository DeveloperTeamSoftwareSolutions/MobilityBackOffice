import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegionList } from './RegionList';
import * as api from './regiones.api';

vi.mock('./regiones.api');

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getRegions).mockResolvedValue({
    data: [
      { guid: 'guid-ca', code: 'CA', name: 'Centroamérica', isGroup: false, cebeCount: 2 },
      { guid: 'guid-an', code: 'AN', name: 'Andina', isGroup: false, cebeCount: 2 },
    ],
    pagination: { total: 2, page: 1, limit: 200, totalPages: 1 },
  });
  vi.mocked(api.getGroups).mockResolvedValue([
    { guid: 'CAYCAR', code: 'CAYCAR', name: 'CAYCAR (Centroamérica + Caribe)', isGroup: true, cebeCount: 3 },
  ]);
});

describe('RegionList', () => {
  it('lista regiones atomicas y agrupaciones juntas', async () => {
    render(<RegionList onSelect={() => {}} />);
    expect(await screen.findByText('CA')).toBeInTheDocument();
    expect(screen.getByText('AN')).toBeInTheDocument();
    expect(screen.getByText('CAYCAR')).toBeInTheDocument();
    // La agrupacion se distingue con su badge.
    expect(screen.getByText('Agrupación')).toBeInTheDocument();
  });

  it('filtra por codigo o nombre', async () => {
    render(<RegionList onSelect={() => {}} />);
    await screen.findByText('CA');

    await userEvent.type(screen.getByPlaceholderText(/Buscar región/), 'andina');

    expect(screen.getByText('AN')).toBeInTheDocument();
    expect(screen.queryByText('CA')).not.toBeInTheDocument();
    expect(screen.queryByText('CAYCAR')).not.toBeInTheDocument();
  });

  it('al hacer click en una fila la selecciona', async () => {
    const onSelect = vi.fn();
    render(<RegionList onSelect={onSelect} />);
    await userEvent.click(await screen.findByText('CA'));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CA', guid: 'guid-ca' }),
    );
  });
});
