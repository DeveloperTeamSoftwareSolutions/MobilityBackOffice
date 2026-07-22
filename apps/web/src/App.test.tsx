import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { login } from './api/authApi';

// vi.mock (y no spyOn) porque AuthProvider importa el binding al cargar el
// modulo: hay que interceptar el modulo entero, no la propiedad del namespace.
vi.mock('./api/authApi', async (importOriginal) => {
  const real = await importOriginal<typeof import('./api/authApi')>();
  return { ...real, login: vi.fn() };
});

const loginMock = vi.mocked(login);

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('sin sesion, redirige al login', async () => {
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Mobility BackOffice' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('muestra el error que devuelve el backend si el login falla', async () => {
    loginMock.mockRejectedValue({
      response: {
        data: {
          message: 'El usuario no tiene un rol asignado en MobilityBackOffice',
        },
      },
    });

    render(<App />);
    await userEvent.type(screen.getByLabelText('Email'), 'juan@duwest.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'secreto');
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El usuario no tiene un rol asignado en MobilityBackOffice',
    );
  });

  it('tras un login exitoso muestra el shell con la seccion segun el rol', async () => {
    loginMock.mockResolvedValue({
      success: true,
      // exp lejano: el AuthProvider desloguea si el token esta vencido
      token: `${btoa('{}')}.${btoa(JSON.stringify({ exp: 4102444800 }))}.x`,
      user: {
        email: 'juan@duwest.com',
        name: 'Juan Perez',
        guidUsers: 'guid-1',
      },
      role: 'Administrador',
      permissions: [],
    });

    render(<App />);
    await userEvent.type(screen.getByLabelText('Email'), 'juan@duwest.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'secreto');
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));

    // Administrador ve Regiones comerciales (aparece en el sidebar y en la tarjeta
    // del inicio, por eso getAllByRole).
    expect(
      (await screen.findAllByRole('link', { name: /Regiones comerciales/ })).length,
    ).toBeGreaterThan(0);
    // ...y no ve las secciones de Marketing.
    expect(
      screen.queryAllByRole('link', { name: /Templates de WhatsApp/ }),
    ).toHaveLength(0);
    expect(
      screen.queryAllByRole('link', { name: /Documentación del RAG/ }),
    ).toHaveLength(0);
    // Aparece en la TopBar y en el encabezado de Inicio.
    expect(screen.getAllByText(/Juan Perez/).length).toBeGreaterThan(0);
  });
});
