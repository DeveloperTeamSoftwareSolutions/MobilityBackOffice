import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { RoleGuard } from './RoleGuard';
import { AuthContext, AuthContextValue } from './authContext';
import type { BackOfficeRole } from '../types';

function conRol(role: BackOfficeRole | null, children: ReactNode) {
  const value: AuthContextValue = {
    user: null,
    role,
    permissions: [],
    isAuthenticated: role !== null,
    login: async () => {},
    logout: () => {},
  };
  return render(
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>,
  );
}

const CONTENIDO = <span>contenido protegido</span>;

describe('RoleGuard', () => {
  it('muestra el contenido al rol permitido', () => {
    conRol('Administrador', <RoleGuard allow={['Administrador']}>{CONTENIDO}</RoleGuard>);
    expect(screen.getByText('contenido protegido')).toBeInTheDocument();
  });

  it('oculta el contenido a un rol no permitido', () => {
    conRol('Marketing', <RoleGuard allow={['Administrador']}>{CONTENIDO}</RoleGuard>);
    expect(screen.queryByText('contenido protegido')).not.toBeInTheDocument();
  });

  it('SuperAdmin ve todo aunque no este listado', () => {
    conRol('SuperAdmin', <RoleGuard allow={['Marketing']}>{CONTENIDO}</RoleGuard>);
    expect(screen.getByText('contenido protegido')).toBeInTheDocument();
  });

  it('oculta el contenido si no hay rol en la sesion', () => {
    conRol(null, <RoleGuard allow={['Administrador']}>{CONTENIDO}</RoleGuard>);
    expect(screen.queryByText('contenido protegido')).not.toBeInTheDocument();
  });

  it('renderiza el fallback cuando el rol no alcanza', () => {
    conRol(
      'Marketing',
      <RoleGuard allow={['Administrador']} fallback={<span>sin permiso</span>}>
        {CONTENIDO}
      </RoleGuard>,
    );
    expect(screen.getByText('sin permiso')).toBeInTheDocument();
    expect(screen.queryByText('contenido protegido')).not.toBeInTheDocument();
  });

  it('acepta varios roles permitidos', () => {
    conRol(
      'Marketing',
      <RoleGuard allow={['Administrador', 'Marketing']}>{CONTENIDO}</RoleGuard>,
    );
    expect(screen.getByText('contenido protegido')).toBeInTheDocument();
  });
});
