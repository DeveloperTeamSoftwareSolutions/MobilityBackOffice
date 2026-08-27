import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthorizersTable } from './AuthorizersTable';
import { Authorizer } from './autorizadores.types';

function authorizer(over: Partial<Authorizer> = {}): Authorizer {
  return {
    companyCode: '2100',
    userEmail: 'gerente@duwy.com',
    userId: '2100358',
    approvalLevel: null,
    minimumPercentage: 10,
    maximumPercentage: 30,
    band: { min: 10, max: 30, blocked: false, reason: null },
    profitCenters: [
      { code: '1002', name: 'CEBE Central', validFrom: null, validUntil: null, active: true },
    ],
    activeProfitCenterCount: 1,
    coversWholeCompany: false,
    ...over,
  };
}

function renderTable(rows: Authorizer[]) {
  return render(
    <AuthorizersTable rows={rows} sortBy="userEmail" sortDir="ASC" onSort={vi.fn()} />,
  );
}

describe('AuthorizersTable', () => {
  it('muestra la banda interpretada y NO el porcentaje crudo', () => {
    // El 200/200 crudo se leeria "de 200% a 200%", que es falso.
    renderTable([
      authorizer({
        minimumPercentage: 200,
        maximumPercentage: 200,
        band: { min: null, max: null, blocked: false, reason: 'sin_limite' },
      }),
    ]);

    expect(screen.getByText('Sin límite')).toBeInTheDocument();
    expect(screen.queryByText(/200% a 200%/)).not.toBeInTheDocument();
  });

  it('un autorizador bloqueado se ve como tal', () => {
    renderTable([
      authorizer({
        minimumPercentage: 0,
        maximumPercentage: 0,
        band: { min: null, max: null, blocked: true, reason: 'sin_configurar' },
      }),
    ]);

    expect(screen.getByText('Sin configurar')).toBeInTheDocument();
    expect(screen.getByText(/solo rechazar/)).toBeInTheDocument();
  });

  it('el comodin se muestra como "Toda la sociedad"', () => {
    renderTable([authorizer({ coversWholeCompany: true, profitCenters: [], activeProfitCenterCount: 0 })]);

    expect(screen.getByText('Toda la sociedad')).toBeInTheDocument();
    expect(screen.queryByText('Sin CEBEs asignados')).not.toBeInTheDocument();
  });

  it('el detalle expone los crudos de SAP para poder auditar', () => {
    renderTable([authorizer({ minimumPercentage: 200, maximumPercentage: 50 })]);

    fireEvent.click(screen.getByRole('button', { name: /Ver detalle/ }));

    expect(screen.getByText(/MinimumPercentage/)).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('el detalle muestra el nombre del CEBE y no solo el codigo', () => {
    renderTable([authorizer()]);

    fireEvent.click(screen.getByRole('button', { name: /Ver detalle/ }));
    expect(screen.getByText('1002 · CEBE Central')).toBeInTheDocument();
  });

  it('una asignacion 9999-12-31 se lee "Sin vencimiento"', () => {
    renderTable([
      authorizer({
        profitCenters: [
          {
            code: '1002',
            name: null,
            validFrom: '2023-08-09T00:00:00.000Z',
            validUntil: '9999-12-31T00:00:00.000Z',
            active: true,
          },
        ],
      }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: /Ver detalle/ }));
    expect(screen.getByText(/Sin vencimiento/)).toBeInTheDocument();
    expect(screen.queryByText(/9999/)).not.toBeInTheDocument();
  });

  it('el detalle de un comodin explica que no tiene restriccion', () => {
    renderTable([authorizer({ coversWholeCompany: true, profitCenters: [], activeProfitCenterCount: 0 })]);

    fireEvent.click(screen.getByRole('button', { name: /Ver detalle/ }));
    expect(screen.getByText(/no tiene restricción por CEBE/)).toBeInTheDocument();
  });

  it('el detalle se abre y se cierra', () => {
    renderTable([authorizer()]);

    const toggle = screen.getByRole('button', { name: /Ver detalle/ });
    expect(screen.queryByText(/Límites cargados en SAP/)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText(/Límites cargados en SAP/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Ocultar detalle/ }));
    expect(screen.queryByText(/Límites cargados en SAP/)).not.toBeInTheDocument();
  });

  it('el click en una columna pide el orden', () => {
    const onSort = vi.fn();
    render(
      <AuthorizersTable rows={[authorizer()]} sortBy="userEmail" sortDir="ASC" onSort={onSort} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Alcance/ }));
    expect(onSort).toHaveBeenCalledWith('profitCenterCount');
  });
});
