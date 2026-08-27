import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CountryManagersPanel } from './CountryManagersPanel';
import { CountryManagerNode, CountryManagerNodeMember } from './autorizadores.types';

function member(over: Partial<CountryManagerNodeMember> = {}): CountryManagerNodeMember {
  return {
    name: 'ALONSO ARROYAVE',
    role: 'Vendedor',
    sapUserId: '2100425',
    email: 'alonso@duwest.com',
    companyCode: '2100',
    inCompany: true,
    ...over,
  };
}

function node(over: Partial<CountryManagerNode> = {}): CountryManagerNode {
  return {
    nodeGuid: 'n1',
    nodeName: 'COUNTRY MANAGER BAN',
    country: 'GUATEMALA',
    members: [member()],
    ...over,
  };
}

/**
 * El caso que estos tests protegen es real: en QATEST, el nodo "COUNTRY MANAGER BAN"
 * tiene dos integrantes con Role "Vendedor". La pantalla no puede presentarlos como
 * country managers.
 */
describe('CountryManagersPanel — no presentar a un vendedor como country manager', () => {
  it('muestra el rol de cada integrante', () => {
    render(<CountryManagersPanel result={{ available: true, diagnosis: 'ok', nodes: [node()] }} />);
    expect(screen.getByText('ALONSO ARROYAVE')).toBeInTheDocument();
    expect(screen.getByText('Vendedor')).toBeInTheDocument();
  });

  it('avisa que estar en el nodo no es ser country manager', () => {
    render(<CountryManagersPanel result={{ available: true, diagnosis: 'ok', nodes: [node()] }} />);
    expect(screen.getByText(/puesto del organigrama/)).toBeInTheDocument();
    // Aparece en el aviso de la lista y otra vez en el bloque de procedencia.
    expect(screen.getAllByText(/no significa/i).length).toBeGreaterThan(0);
  });

  it('el titulo no afirma que la lista sean country managers', () => {
    render(<CountryManagersPanel result={{ available: true, diagnosis: 'ok', nodes: [node()] }} />);
    expect(screen.getByRole('heading', { name: /Jerarquía comercial/ })).toBeInTheDocument();
  });

  it('agrupa por nodo y muestra su nombre', () => {
    render(<CountryManagersPanel result={{ available: true, diagnosis: 'ok', nodes: [node()] }} />);
    expect(screen.getByText('COUNTRY MANAGER BAN')).toBeInTheDocument();
    expect(screen.getByText('GUATEMALA')).toBeInTheDocument();
  });

  it('un integrante sin rol cargado lo dice, no lo inventa', () => {
    render(
      <CountryManagersPanel
        result={{ available: true, diagnosis: 'ok', nodes: [node({ members: [member({ role: null })] })] }}
      />,
    );
    expect(screen.getByText('Sin rol cargado')).toBeInTheDocument();
  });
});

describe('CountryManagersPanel — integrante de otra sociedad', () => {
  const otro = member({
    name: 'JORGE MARTINEZ',
    role: 'Gerente',
    sapUserId: '2100144',
    email: null,
    companyCode: null,
    inCompany: false,
  });

  it('se muestra igual, marcado', () => {
    // Sin esto, el gerente del nodo queda invisible en la sociedad de su propio equipo.
    render(
      <CountryManagersPanel
        result={{ available: true, diagnosis: 'ok', nodes: [node({ members: [member(), otro] })] }}
      />,
    );
    expect(screen.getByText('JORGE MARTINEZ')).toBeInTheDocument();
    expect(screen.getByText(/pertenece a otra sociedad/)).toBeInTheDocument();
  });

  it('no inventa el correo que esa consulta no trae', () => {
    render(
      <CountryManagersPanel
        result={{ available: true, diagnosis: 'ok', nodes: [node({ members: [otro] })] }}
      />,
    );
    expect(screen.getByText(/Correo no disponible/)).toBeInTheDocument();
  });
});

describe('CountryManagersPanel — procedencia del dato', () => {
  it('dice de que tabla sale el rol y que no se usa para filtrar', () => {
    render(<CountryManagersPanel result={{ available: true, diagnosis: 'ok', nodes: [node()] }} />);
    expect(screen.getByText(/CommercialTeamMembers.Role/)).toBeInTheDocument();
    expect(screen.getByText(/No se usa para filtrar/)).toBeInTheDocument();
  });

  it('dice que la pertenencia sale del NOMBRE del nodo', () => {
    render(<CountryManagersPanel result={{ available: true, diagnosis: 'ok', nodes: [node()] }} />);
    expect(screen.getByText(/CommercialTeamHierarchies.Name/)).toBeInTheDocument();
  });

  it('la procedencia esta tambien cuando no hay nadie', () => {
    render(<CountryManagersPanel result={{ available: true, diagnosis: 'sin_nodo', nodes: [] }} />);
    expect(screen.getByText(/CommercialTeamHierarchies.Name/)).toBeInTheDocument();
  });
});

describe('CountryManagersPanel — vacios', () => {
  it('un fallo NO se muestra como "no hay ninguno"', () => {
    render(
      <CountryManagersPanel result={{ available: false, diagnosis: 'unavailable', nodes: [] }} />,
    );
    expect(screen.getByText(/incompleta/)).toBeInTheDocument();
  });

  it('sin nodo en la jerarquia NO afirma que nadie autorice', () => {
    render(<CountryManagersPanel result={{ available: true, diagnosis: 'sin_nodo', nodes: [] }} />);
    expect(screen.getByText(/No significa que nadie autorice/)).toBeInTheDocument();
  });

  it('con nodo pero sin miembros apunta a la ficha de usuario', () => {
    render(
      <CountryManagersPanel result={{ available: true, diagnosis: 'sin_miembros', nodes: [] }} />,
    );
    expect(screen.getByText(/sociedad SAP cargada/)).toBeInTheDocument();
  });

  it('mientras carga no afirma nada', () => {
    render(<CountryManagersPanel result={null} />);
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
    expect(screen.queryByText(/No se encontró/)).not.toBeInTheDocument();
  });
});
