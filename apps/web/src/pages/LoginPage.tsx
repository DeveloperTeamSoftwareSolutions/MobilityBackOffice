import { useState, FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { apiErrorMessage } from '../api/authApi';
import { APP_NAME, APP_VERSION } from '../version';
import './login.css';

export function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo iniciar sesión'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="bo-login">
      <form className="bo-login__card" onSubmit={onSubmit}>
        <h1 className="bo-login__title">{APP_NAME}</h1>
        <p className="bo-login__subtitle">
          Ingresá con tu cuenta corporativa.
        </p>

        {error !== null && (
          <div className="bo-login__error" role="alert">
            {error}
          </div>
        )}

        <div className="bo-login__field">
          <label className="bo-login__label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="bo-login__input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="bo-login__field">
          <label className="bo-login__label" htmlFor="password">
            Contraseña
          </label>
          <input
            id="password"
            className="bo-login__input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button
          type="submit"
          className="bo-login__submit"
          disabled={enviando}
        >
          {enviando ? 'Ingresando...' : 'Ingresar'}
        </button>

        <p className="bo-login__version">v{APP_VERSION}</p>
      </form>
    </div>
  );
}
