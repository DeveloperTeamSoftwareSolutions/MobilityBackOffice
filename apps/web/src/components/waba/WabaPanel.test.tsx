import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WabaPanel } from './WabaPanel';

describe('WabaPanel', () => {
  it('el iframe apunta al prefijo same-origin, no al panel directo', () => {
    // Un iframe hacia el origen de WABA lo bloquea el navegador: manda
    // X-Frame-Options SAMEORIGIN y CSP frame-ancestors 'self'. La unica via es /waba.
    render(<WabaPanel />);
    const frame = screen.getByTitle('Panel de WhatsApp (WABA)');
    expect(frame).toHaveAttribute('src', '/waba/');
  });

  it('avisa que el panel tiene su propio login', () => {
    // WABA conserva su autenticacion; sin este aviso su pantalla de acceso aparece
    // dentro de BackOffice sin ninguna explicacion.
    render(<WabaPanel />);
    expect(screen.getByText(/su propio usuario y contraseña/)).toBeInTheDocument();
  });

  it('el aviso se puede cerrar y no vuelve', () => {
    render(<WabaPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByText(/su propio usuario y contraseña/)).not.toBeInTheDocument();
  });

  it('cerrar el aviso no saca el panel', () => {
    render(<WabaPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(screen.getByTitle('Panel de WhatsApp (WABA)')).toBeInTheDocument();
  });
});
