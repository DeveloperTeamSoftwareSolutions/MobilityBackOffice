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
    { guid: 'CAYCAR', code: 'CAYCAR', name: 'CAYCAR (común a Centroamérica y Caribe)', isGroup: true, cebeCount: 18 },
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
    // Su conteo es el que manda el API (los pares de la vista): la web no lo recalcula.
    expect(screen.getByText('18')).toBeInTheDocument();
  });

  it('describe CAYCAR como lo comun a Centroamerica y Caribe, no como su union', async () => {
    // El negocio decidio que CAYCAR es la interseccion por codigo de CEBE. El texto es parte
    // del requisito: "agrupa" / "+" le decia al usuario que era todo lo de las dos regiones.
    render(<RegionList onSelect={() => {}} />);
    await screen.findByText('CA');
    expect(screen.getByText(/comunes a Centroamérica y Caribe/)).toBeInTheDocument();
    expect(screen.queryByText(/agrupa Centroamérica/)).not.toBeInTheDocument();
  });

  it('si el API de agrupaciones falla, muestra el error en vez de una lista sin CAYCAR', async () => {
    // Forma del error de axios con el 503 que arma la API contra un middleware viejo.
    vi.mocked(api.getGroups).mockRejectedValue({
      response: {
        data: {
          message:
            'El middleware todavía no tiene las agrupaciones de regiones — requiere MW ≥ 1.331.0',
        },
      },
    });
    render(<RegionList onSelect={() => {}} />);
    expect(await screen.findByText(/requiere MW/)).toBeInTheDocument();
    expect(screen.queryByText('CA')).not.toBeInTheDocument();
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
