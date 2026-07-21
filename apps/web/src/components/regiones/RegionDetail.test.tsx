import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegionDetail } from './RegionDetail';
import * as api from './regiones.api';
import type { Region } from './regiones.types';

vi.mock('./regiones.api');

const REGION_CA: Region = {
  guid: 'guid-ca',
  code: 'CA',
  name: 'Centroamérica',
  isGroup: false,
  cebeCount: 1,
};

const CAYCAR: Region = {
  guid: 'CAYCAR',
  code: 'CAYCAR',
  name: 'CAYCAR (Centroamérica + Caribe)',
  isGroup: true,
  cebeCount: 3,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('RegionDetail — región atómica', () => {
  beforeEach(() => {
    vi.mocked(api.getRegion).mockResolvedValue({
      ...REGION_CA,
      cebes: [
        {
          profitCenterCode: '1003',
          profitCenterName: 'Duwest Banano',
          companyCode: '2100',
          companyName: 'Duwest Guatemala',
        },
      ],
    });
  });

  it('lista los CEBEs vinculados de la region', async () => {
    render(<RegionDetail region={REGION_CA} onBack={() => {}} />);
    expect(await screen.findByText('1003')).toBeInTheDocument();
    expect(screen.getByText('Duwest Banano')).toBeInTheDocument();
    expect(screen.getByText('Duwest Guatemala')).toBeInTheDocument();
  });

  it('permite quitar un vinculo y recarga', async () => {
    vi.mocked(api.unlinkCebe).mockResolvedValue();
    render(<RegionDetail region={REGION_CA} onBack={() => {}} />);
    await screen.findByText('1003');

    await userEvent.click(screen.getByRole('button', { name: 'Quitar' }));

    expect(api.unlinkCebe).toHaveBeenCalledWith('guid-ca', '1003', '2100');
    await waitFor(() => expect(api.getRegion).toHaveBeenCalledTimes(2));
  });

  it('vincula un CEBE en dos pasos: elegir CEBE, luego sociedad', async () => {
    vi.mocked(api.searchCebes).mockResolvedValue([
      { code: '1080', name: 'Qualicon' },
    ]);
    vi.mocked(api.searchCompanies).mockResolvedValue([
      { code: '2100', name: 'Duwest Guatemala', country: 'GT' },
    ]);
    vi.mocked(api.linkCebe).mockResolvedValue();

    render(<RegionDetail region={REGION_CA} onBack={() => {}} />);
    await screen.findByText('1003');

    // Paso 1: buscar y elegir el CEBE.
    await userEvent.type(
      screen.getByPlaceholderText(/Vincular CEBE/),
      '1080',
    );
    await userEvent.click(await screen.findByText('Qualicon'));

    // Paso 2: aparece el picker de sociedad; buscar y elegir.
    await userEvent.type(
      await screen.findByPlaceholderText(/Elegir sociedad/),
      '2100',
    );
    await userEvent.click(await screen.findByText(/Duwest Guatemala · GT/));

    await waitFor(() =>
      expect(api.linkCebe).toHaveBeenCalledWith('guid-ca', '1080', '2100', 'Qualicon'),
    );
  });

  it('muestra el mensaje del backend si el link falla', async () => {
    vi.mocked(api.searchCebes).mockResolvedValue([{ code: '1080', name: 'Qualicon' }]);
    vi.mocked(api.searchCompanies).mockResolvedValue([
      { code: '2100', name: 'Duwest Guatemala', country: 'GT' },
    ]);
    vi.mocked(api.linkCebe).mockRejectedValue({
      response: { data: { message: 'Cada CEBE requiere una sociedad (companyCode)' } },
    });

    render(<RegionDetail region={REGION_CA} onBack={() => {}} />);
    await screen.findByText('1003');
    await userEvent.type(screen.getByPlaceholderText(/Vincular CEBE/), '1080');
    await userEvent.click(await screen.findByText('Qualicon'));
    await userEvent.type(await screen.findByPlaceholderText(/Elegir sociedad/), '2100');
    await userEvent.click(await screen.findByText(/Duwest Guatemala · GT/));

    expect(
      await screen.findByText('Cada CEBE requiere una sociedad (companyCode)'),
    ).toBeInTheDocument();
  });
});

describe('RegionDetail — agrupación (CAYCAR)', () => {
  it('muestra los pares efectivos en solo lectura, sin acciones', async () => {
    vi.mocked(api.resolveRegion).mockResolvedValue([
      {
        profitCenterCode: '1003',
        profitCenterName: 'Duwest Banano',
        companyCode: '3000',
        companyName: 'Duwest Dominicana',
      },
    ]);

    render(<RegionDetail region={CAYCAR} onBack={() => {}} />);

    expect(await screen.findByText('1003')).toBeInTheDocument();
    expect(api.resolveRegion).toHaveBeenCalledWith('CAYCAR');
    // Una agrupación no ofrece vincular ni quitar.
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Vincular CEBE/)).not.toBeInTheDocument();
    expect(screen.getByText(/Solo lectura/)).toBeInTheDocument();
  });
});
