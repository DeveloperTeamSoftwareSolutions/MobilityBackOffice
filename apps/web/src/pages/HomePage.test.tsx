import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReactNode } from 'react';
import { HomePage } from './HomePage';
import { AuthContext, AuthContextValue } from '../auth/authContext';
import type { BackOfficeRole } from '../types';

function renderAs(role: BackOfficeRole | null, name = 'Juan Perez') {
  const value: AuthContextValue = {
    user: role ? { email: 'j@d.com', name, guidUsers: 'g1' } : null,
    role,
    permissions: [],
    isAuthenticated: role !== null,
    login: async () => {},
    logout: () => {},
  };
  const ui: ReactNode = (
    <MemoryRouter>
      <AuthContext.Provider value={value}>
        <HomePage />
      </AuthContext.Provider>
    </MemoryRouter>
  );
  return render(ui);
}

describe('HomePage', () => {
  it('saluda por el primer nombre', () => {
    renderAs('SuperAdmin', 'Alejandro Elias');
    expect(screen.getByText('Hola, Alejandro')).toBeInTheDocument();
  });

  it('SuperAdmin ve tarjetas de todas las secciones', () => {
    renderAs('SuperAdmin');
    expect(screen.getByRole('link', { name: /Regiones comerciales/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Templates de WhatsApp/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Documentación del RAG/ })).toBeInTheDocument();
  });

  it('Administrador solo ve la tarjeta de Regiones', () => {
    renderAs('Administrador');
    expect(screen.getByRole('link', { name: /Regiones comerciales/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Templates de WhatsApp/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Documentación del RAG/ })).not.toBeInTheDocument();
  });

  it('Marketing ve Templates y RAG, no Regiones', () => {
    renderAs('Marketing');
    expect(screen.queryByRole('link', { name: /Regiones comerciales/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Templates de WhatsApp/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Documentación del RAG/ })).toBeInTheDocument();
  });

  it('marca Templates de WhatsApp como Próximamente', () => {
    renderAs('Marketing');
    expect(screen.getByText('Próximamente')).toBeInTheDocument();
  });

  it('las tarjetas apuntan a la ruta de su seccion', () => {
    renderAs('Marketing');
    expect(screen.getByRole('link', { name: /Documentación del RAG/ })).toHaveAttribute(
      'href',
      '/documentacion-rag',
    );
  });

  it('sin secciones habilitadas muestra el mensaje de sin acceso', () => {
    // Un rol sin secciones: se simula pasando un rol que no matchea ninguna.
    renderAs(null);
    expect(screen.getByText(/no tiene secciones habilitadas/)).toBeInTheDocument();
  });
});
