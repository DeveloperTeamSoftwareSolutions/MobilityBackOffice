import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CountryManagersPanel } from './CountryManagersPanel';
import { CountryManager } from './autorizadores.types';

function cm(over: Partial<CountryManager> = {}): CountryManager {
  return {
    companyCode: '2100',
    email: 'ana@duwy.com',
    name: 'Ana Cardona',
    role: 'Country Manager',
    sapUserId: '2100358',
    country: 'AR',
    businessUnit: 'Mobility',
    ...over,
  };
}

describe('CountryManagersPanel', () => {
  it('explica que es un permiso distinto al de la matriz', () => {
    render(<CountryManagersPanel result={{ available: true, data: [cm()] }} />);
    expect(screen.getByText(/otra forma de pago/)).toBeInTheDocument();
    expect(screen.getByText(/no sale de la matriz/)).toBeInTheDocument();
  });

  it('lista nombre y correo', () => {
    render(<CountryManagersPanel result={{ available: true, data: [cm()] }} />);
    expect(screen.getByText('Ana Cardona')).toBeInTheDocument();
    expect(screen.getByText('ana@duwy.com')).toBeInTheDocument();
  });

  it('un fallo NO se muestra como "no hay ninguno"', () => {
    // Decir que nadie autoriza otra forma de pago cuando en realidad fallo la consulta
    // es exactamente la afirmacion falsa que esta pantalla intenta evitar.
    render(<CountryManagersPanel result={{ available: false, data: [] }} />);
    expect(screen.getByText(/incompleta/)).toBeInTheDocument();
    expect(screen.queryByText(/no tiene ningún Country Manager/)).not.toBeInTheDocument();
  });

  it('una sociedad realmente vacia lo dice con su consecuencia', () => {
    render(<CountryManagersPanel result={{ available: true, data: [] }} />);
    expect(screen.getByText(/no tiene ningún Country Manager/)).toBeInTheDocument();
    expect(screen.getByText(/no tienen quién los autorice/)).toBeInTheDocument();
  });

  it('mientras carga no afirma nada', () => {
    render(<CountryManagersPanel result={null} />);
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
    expect(screen.queryByText(/no tiene ningún Country Manager/)).not.toBeInTheDocument();
  });

  it('tolera un country manager sin nombre ni correo', () => {
    render(
      <CountryManagersPanel
        result={{ available: true, data: [cm({ name: null, email: null })] }}
      />,
    );
    expect(screen.getByText('Sin nombre')).toBeInTheDocument();
    expect(screen.getByText('Sin correo')).toBeInTheDocument();
  });
});
