import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './useAuth';
import { login } from '../api/authApi';

vi.mock('../api/authApi', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/authApi')>();
  return { ...real, login: vi.fn() };
});
const loginMock = vi.mocked(login);

function jwtConExp(expSegundos: number): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o));
  return `${b64({ alg: 'HS256' })}.${b64({ exp: expSegundos })}.firma`;
}

function Sonda() {
  const { isAuthenticated, role } = useAuth();
  return <div data-testid="sonda">{`${isAuthenticated}|${role ?? '-'}`}</div>;
}

async function loguearCon(token: string): Promise<void> {
  loginMock.mockResolvedValue({
    success: true,
    token,
    user: { email: 'j@duwest.com', name: 'Juan', guidUsers: 'g1' },
    role: 'Administrador',
    permissions: [],
  });

  let ctxLogin!: (e: string, p: string) => Promise<void>;
  function Captura() {
    ctxLogin = useAuth().login;
    return null;
  }

  render(
    <AuthProvider>
      <Captura />
      <Sonda />
    </AuthProvider>,
  );
  await act(async () => {
    await ctxLogin('j@duwest.com', 'x');
  });
}

const enSegundos = (offset: number) => Math.floor(Date.now() / 1000) + offset;

describe('AuthProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
  });

  it('tras el login deja la sesion activa y persiste el token', async () => {
    await loguearCon(jwtConExp(enSegundos(3600)));
    expect(screen.getByTestId('sonda')).toHaveTextContent('true|Administrador');
    expect(localStorage.getItem('bo_token')).not.toBeNull();
  });

  it('NO desloguea cuando el token vence muy lejos en el futuro', async () => {
    // setTimeout trunca el delay a 32 bits: sin acotarlo, un exp lejano hace que
    // el timer dispare de inmediato y el usuario quede deslogueado al entrar.
    await loguearCon(jwtConExp(enSegundos(60 * 60 * 24 * 365 * 10)));
    expect(screen.getByTestId('sonda')).toHaveTextContent('true|Administrador');
  });

  it('desloguea si el token ya esta vencido', async () => {
    await loguearCon(jwtConExp(enSegundos(-10)));
    expect(screen.getByTestId('sonda')).toHaveTextContent('false|-');
    expect(localStorage.getItem('bo_token')).toBeNull();
  });

  it('desloguea al vencer el token mientras la sesion esta abierta', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await loguearCon(jwtConExp(enSegundos(60)));
      expect(screen.getByTestId('sonda')).toHaveTextContent('true|Administrador');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(61_000);
      });
      expect(screen.getByTestId('sonda')).toHaveTextContent('false|-');
    } finally {
      vi.useRealTimers();
    }
  });

  it('restaura la sesion persistida al montar', async () => {
    localStorage.setItem('bo_token', jwtConExp(enSegundos(3600)));
    localStorage.setItem(
      'bo_session',
      JSON.stringify({
        user: { email: 'j@duwest.com', name: 'Juan', guidUsers: 'g1' },
        role: 'Marketing',
        permissions: [],
      }),
    );

    render(
      <AuthProvider>
        <Sonda />
      </AuthProvider>,
    );
    expect(screen.getByTestId('sonda')).toHaveTextContent('true|Marketing');
  });

  it('descarta una sesion persistida ilegible', () => {
    localStorage.setItem('bo_token', jwtConExp(enSegundos(3600)));
    localStorage.setItem('bo_session', 'no-es-json');

    render(
      <AuthProvider>
        <Sonda />
      </AuthProvider>,
    );
    expect(screen.getByTestId('sonda')).toHaveTextContent('false|-');
  });
});
