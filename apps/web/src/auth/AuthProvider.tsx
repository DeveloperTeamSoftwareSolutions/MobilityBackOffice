import { useState, useCallback, useEffect, ReactNode } from 'react';
import type { BackOfficeRole, User } from '../types';
import { login as apiLogin } from '../api/authApi';
import { TOKEN_KEY } from '../api/httpClient';
import { AuthContext, AuthContextValue } from './authContext';
import { isJwtExpired, jwtExpiryMs } from './jwt';

const SESSION_KEY = 'bo_session';

// setTimeout guarda el delay en 32 bits con signo: cualquier valor mayor se
// trunca y el timer dispara INMEDIATAMENTE. Con un token de exp lejano eso
// desloguearia al usuario apenas entra. Se acota el timer y, si la expiracion
// queda mas lejos, alcanza con el re-chequeo al volver el foco.
const MAX_TIMEOUT_MS = 2_147_483_647;

interface SessionState {
  user: User;
  role: BackOfficeRole;
  permissions: string[];
}

/** Lee la sesión persistida desde localStorage, si existe y es legible. */
function readStoredSession(): SessionState | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const raw = localStorage.getItem(SESSION_KEY);
  if (!token || !raw) return null;
  try {
    return JSON.parse(raw) as SessionState;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Restauración síncrona: la sesión ya está resuelta en el primer render, así
  // ProtectedRoute no manda al login por un instante a un usuario que sí la tiene.
  const [session, setSession] = useState<SessionState | null>(readStoredSession);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password);
    const next: SessionState = {
      user: res.user,
      role: res.role,
      permissions: res.permissions,
    };
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  }, []);

  // Vigilancia de expiración. Sin esto, la app queda abierta con un token vencido
  // y el usuario descubre el problema recién cuando una request devuelve 401.
  // Dos disparadores: un timer al instante exacto de expiración, y un re-chequeo
  // al volver el foco (el timer se atrasa en pestañas en segundo plano).
  useEffect(() => {
    if (session === null) return;

    const token = localStorage.getItem(TOKEN_KEY);

    // Sesión restaurada pero ya vencida: fuera de una.
    if (!token || isJwtExpired(token)) {
      logout();
      return;
    }

    const enforceIfExpired = (): void => {
      const current = localStorage.getItem(TOKEN_KEY);
      if (!current || isJwtExpired(current)) logout();
    };

    let timer: number | undefined;
    const expMs = jwtExpiryMs(token);
    if (expMs !== null) {
      const restante = Math.max(0, expMs - Date.now());
      if (restante <= MAX_TIMEOUT_MS) {
        timer = window.setTimeout(logout, restante);
      }
    }

    window.addEventListener('focus', enforceIfExpired);
    document.addEventListener('visibilitychange', enforceIfExpired);

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('focus', enforceIfExpired);
      document.removeEventListener('visibilitychange', enforceIfExpired);
    };
  }, [session, logout]);

  const value: AuthContextValue = {
    user: session?.user ?? null,
    role: session?.role ?? null,
    permissions: session?.permissions ?? [],
    isAuthenticated: session !== null,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
