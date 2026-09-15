import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JsonBox } from './JsonBox';

/**
 * El JSON va plegado y solo se pide cuando alguien lo mira: armarlo cuesta una llamada al
 * servidor, y para quien arma una plantilla de marketing es ruido.
 */
describe('JsonBox', () => {
  it('arranca cerrado', () => {
    render(<JsonBox titulo="Ver JSON" valor={{ a: 1 }} />);
    expect(screen.queryByText(/"a"/)).toBeNull();
  });

  it('muestra el JSON con sangría al abrirlo', async () => {
    render(<JsonBox titulo="Ver JSON" valor={{ a: 1 }} />);
    await userEvent.click(screen.getByRole('button', { name: /Ver JSON/ }));
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
  });

  it('avisa al abrir y al cerrar', async () => {
    // De eso depende no pedirle nada al servidor mientras nadie lo mira.
    const onOpenChange = vi.fn();
    render(<JsonBox titulo="Ver JSON" valor={null} onOpenChange={onOpenChange} />);

    const boton = screen.getByRole('button', { name: /Ver JSON/ });
    await userEvent.click(boton);
    await userEvent.click(boton);

    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it('mientras carga no muestra un JSON vacío como si fuera el resultado', async () => {
    render(<JsonBox titulo="Ver JSON" valor={null} cargando />);
    await userEvent.click(screen.getByRole('button', { name: /Ver JSON/ }));
    expect(screen.getByText('Armando el JSON…')).toBeInTheDocument();
    expect(screen.queryByText('Todavía no hay nada que mostrar.')).toBeNull();
  });

  it('un error del servidor se ve en vez del JSON', async () => {
    render(<JsonBox titulo="Ver JSON" valor={null} error="No se pudo armar" />);
    await userEvent.click(screen.getByRole('button', { name: /Ver JSON/ }));
    expect(screen.getByText('No se pudo armar')).toBeInTheDocument();
  });
});
