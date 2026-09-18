import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WarehouseReservations } from './WarehouseReservations';
import * as api from './warehouses.api';
import { Warehouse } from './warehouses.types';

vi.mock('./warehouses.api');

const ALMACEN: Warehouse = {
  guid: 'guid-alm-1',
  companyCode: '1000',
  centerCode: 'C01',
  warehouseCode: 'A01',
  centerName: 'Guatemala Central',
  warehouseName: 'Almacén central',
  warehouseAddress: 'Zona 12',
  customerCount: 0,
  groupCount: 1,
  restricted: true,
};

const GRUPO = {
  guid: 'guid-grupo-1',
  customerGroupCode: 'T3',
  customerGroupName: 'Ingenio El Ángel',
  customerCount: 715,
  userId: null,
  userEmail: null,
  timeStamp: 0,
  serverTimestamp: 0,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getReservedCustomers).mockResolvedValue([]);
  vi.mocked(api.getReservedGroups).mockResolvedValue([GRUPO]);
  vi.mocked(api.getGroupCustomers).mockResolvedValue({
    data: [{ customerCode: 'CL-900', customerName: 'Finca La Esperanza' }],
    pagination: { total: 715, page: 1, limit: 20, totalPages: 36 },
  });
});

describe('reservas por grupo', () => {
  it('la fila del grupo trae su conteo de clientes', async () => {
    render(<WarehouseReservations warehouse={ALMACEN} onChanged={() => {}} />);

    expect(await screen.findByRole('button', { name: /Grupo T3/ })).toBeInTheDocument();
    expect(screen.getByText(/715 clientes/)).toBeInTheDocument();
  });

  it('la fila del grupo se despliega a sus clientes, paginados por el servidor', async () => {
    render(<WarehouseReservations warehouse={ALMACEN} onChanged={() => {}} />);

    const fila = await screen.findByRole('button', { name: /Grupo T3/ });
    expect(fila).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(fila);

    expect(await screen.findByText('CL-900')).toBeInTheDocument();
    expect(fila).toHaveAttribute('aria-expanded', 'true');
    // Los 715 no viajan de una: la lista pide la primera página.
    expect(api.getGroupCustomers).toHaveBeenCalledWith('1000', 'T3', 1, 20);
  });
});

describe('quitar una reserva', () => {
  it('la última reserva pide confirmación antes de liberar el almacén', async () => {
    render(<WarehouseReservations warehouse={ALMACEN} onChanged={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /quitar grupo T3/i }));

    // El aviso es el requisito: el almacén pasa a estar disponible para todos.
    expect(await screen.findByRole('alert')).toHaveTextContent(/queda disponible/i);
    // Y no se borró nada todavía.
    expect(api.removeReservedGroup).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /confirmar/i }));

    expect(api.removeReservedGroup).toHaveBeenCalledWith('1000', 'C01', 'A01', 'T3');
  });

  it('si queda otra reserva viva, quitar una no pide confirmación', async () => {
    vi.mocked(api.getReservedCustomers).mockResolvedValue([
      { customerCode: 'CL-1', customerName: 'Cliente uno', guidCustomers: 'g1' },
    ]);
    vi.mocked(api.removeReservedGroup).mockResolvedValue({
      removed: true,
      stillRestricted: true,
    });
    render(
      <WarehouseReservations
        warehouse={{ ...ALMACEN, customerCount: 1 }}
        onChanged={() => {}}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: /quitar grupo T3/i }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.removeReservedGroup).toHaveBeenCalledWith('1000', 'C01', 'A01', 'T3');
  });
});

describe('entorno con un middleware anterior a 1.357.0', () => {
  it('las reservas por cliente siguen funcionando y el bloque de grupos explica por qué falta', async () => {
    vi.mocked(api.getReservedGroups).mockRejectedValue({
      response: {
        data: {
          message:
            'La reserva por grupo de clientes todavía no está disponible en este entorno',
        },
      },
    });
    vi.mocked(api.getReservedCustomers).mockResolvedValue([
      { customerCode: 'CL-1', customerName: 'Cliente uno', guidCustomers: 'g1' },
    ]);

    render(<WarehouseReservations warehouse={ALMACEN} onChanged={() => {}} />);

    // El cliente reservado se ve y se puede quitar: la pantalla no se cae.
    expect(await screen.findByText('CL-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /quitar cliente CL-1/i })).toBeInTheDocument();
    expect(screen.getByText(/no está disponible en este entorno/)).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /buscar cliente/i })).toBeInTheDocument();
  });
});
