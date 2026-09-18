import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomerGroupPicker } from './CustomerGroupPicker';
import * as api from './warehouses.api';

vi.mock('./warehouses.api');

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.searchCustomerGroups).mockResolvedValue([
    {
      customerGroupCode: 'T3',
      customerGroupName: 'Ingenio El Ángel',
      customerCount: 715,
      assignable: true,
    },
    {
      // El contenedor genérico. Llega del API con `assignable: false`.
      customerGroupCode: '37',
      customerGroupName: 'Clientes Terceros',
      customerCount: 17260,
      assignable: false,
    },
  ]);
});

describe('CustomerGroupPicker', () => {
  it('el grupo 37 se muestra deshabilitado y con el motivo a la vista', async () => {
    render(<CustomerGroupPicker companyCode="1000" onPick={() => {}} />);
    await userEvent.click(screen.getByRole('searchbox', { name: /buscar grupo/i }));

    // No se oculta: si faltara, el usuario creería que el grupo no existe.
    const opcion37 = await screen.findByRole('button', { name: /37/ });
    expect(opcion37).toBeDisabled();
    expect(screen.getByText(/no se puede usar para reservar/i)).toBeInTheDocument();
  });

  it('clickear el 37 no reserva nada', async () => {
    const onPick = vi.fn();
    render(<CustomerGroupPicker companyCode="1000" onPick={onPick} />);
    await userEvent.click(screen.getByRole('searchbox', { name: /buscar grupo/i }));

    await userEvent.click(await screen.findByRole('button', { name: /37/ }));

    expect(onPick).not.toHaveBeenCalled();
  });

  it('un grupo asignable devuelve su código al elegirlo', async () => {
    const onPick = vi.fn();
    render(<CustomerGroupPicker companyCode="1000" onPick={onPick} />);
    await userEvent.click(screen.getByRole('searchbox', { name: /buscar grupo/i }));

    await userEvent.click(await screen.findByRole('button', { name: /Ingenio El Ángel/ }));

    expect(onPick).toHaveBeenCalledWith('T3');
  });

  it('muestra cuántos clientes tiene el grupo en esa sociedad', async () => {
    render(<CustomerGroupPicker companyCode="1000" onPick={() => {}} />);
    await userEvent.click(screen.getByRole('searchbox', { name: /buscar grupo/i }));

    expect(await screen.findByText(/715 clientes/)).toBeInTheDocument();
  });

  it('con un middleware viejo avisa el motivo dentro de la lista, sin romperse', async () => {
    vi.mocked(api.searchCustomerGroups).mockRejectedValue({
      response: {
        data: {
          message:
            'La reserva por grupo de clientes todavía no está disponible en este entorno',
        },
      },
    });
    render(<CustomerGroupPicker companyCode="1000" onPick={() => {}} />);
    await userEvent.click(screen.getByRole('searchbox', { name: /buscar grupo/i }));

    expect(await screen.findByText(/no está disponible en este entorno/)).toBeInTheDocument();
    // El buscador sigue en pie: el usuario puede cambiar a reservar por cliente.
    expect(screen.getByRole('searchbox', { name: /buscar grupo/i })).toBeInTheDocument();
  });
});
