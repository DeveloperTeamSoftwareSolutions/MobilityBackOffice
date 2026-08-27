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
    render(<CountryManagersPanel result={{ available: true, diagnosis: 'ok', data: [cm()] }} />);
    expect(screen.getByText(/otra forma de pago/)).toBeInTheDocument();
    expect(screen.getByText(/no sale de la matriz/)).toBeInTheDocument();
  });

  it('lista nombre y correo', () => {
    render(<CountryManagersPanel result={{ available: true, diagnosis: 'ok', data: [cm()] }} />);
    expect(screen.getByText('Ana Cardona')).toBeInTheDocument();
    expect(screen.getByText('ana@duwy.com')).toBeInTheDocument();
  });


  it('un fallo NO se muestra como "no hay ninguno"', () => {
    render(
      <CountryManagersPanel result={{ available: false, diagnosis: 'unavailable', data: [] }} />,
    );
    expect(screen.getByText(/incompleta/)).toBeInTheDocument();
  });

  it('sin nodo en la jerarquia NO afirma que nadie autorice', () => {
    // Es el caso mas enganoso: la consulta identifica a los CM por el NOMBRE del nodo,
    // asi que un renombre los esconde a todos y el endpoint responde 200 con vacio.
    render(
      <CountryManagersPanel result={{ available: true, diagnosis: 'sin_nodo', data: [] }} />,
    );
    expect(screen.getByText(/nombre del nodo/)).toBeInTheDocument();
    expect(screen.getByText(/No significa que nadie autorice/)).toBeInTheDocument();
  });

  it('con nodo pero sin miembros de la sociedad apunta a la ficha de usuario', () => {
    render(
      <CountryManagersPanel result={{ available: true, diagnosis: 'sin_miembros', data: [] }} />,
    );
    expect(screen.getByText(/ninguno de sus integrantes resuelve a esta sociedad/)).toBeInTheDocument();
    expect(screen.getByText(/sociedad SAP cargada/)).toBeInTheDocument();
  });

  it('los dos diagnosticos de carga se ven como advertencia, no como un dato', () => {
    const { container, rerender } = render(
      <CountryManagersPanel result={{ available: true, diagnosis: 'sin_nodo', data: [] }} />,
    );
    expect(container.querySelector('.bo-az__warn')).not.toBeNull();

    rerender(
      <CountryManagersPanel result={{ available: true, diagnosis: 'sin_miembros', data: [] }} />,
    );
    expect(container.querySelector('.bo-az__warn')).not.toBeNull();
  });

  it('mientras carga no afirma nada', () => {
    render(<CountryManagersPanel result={null} />);
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
    expect(screen.queryByText(/No se encontró/)).not.toBeInTheDocument();
  });

  it('tolera un country manager sin nombre ni correo', () => {
    render(
      <CountryManagersPanel
        result={{ available: true, diagnosis: 'ok', data: [cm({ name: null, email: null })] }}
      />,
    );
    expect(screen.getByText('Sin nombre')).toBeInTheDocument();
    expect(screen.getByText('Sin correo')).toBeInTheDocument();
  });
});
