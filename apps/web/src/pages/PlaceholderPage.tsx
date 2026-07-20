import { useEffect, useState } from 'react';
import { APP_NAME, APP_VERSION } from '../version';

interface HealthResponse {
  success: boolean;
  name: string;
  version: string;
  status: string;
}

/**
 * Pantalla de arranque de la fase 0: verifica que el front resuelve y que el
 * backend responde en /api/health por ruta relativa (contrato same-origin).
 * Se reemplaza por el shell de navegación en la fase 3.
 */
export function PlaceholderPage(): JSX.Element {
  const [apiVersion, setApiVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json() as Promise<HealthResponse>;
      })
      .then((data) => setApiVersion(data.version))
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '0.5rem',
      }}
    >
      <h1 style={{ margin: 0, fontSize: '1.5rem' }}>{APP_NAME}</h1>
      <p style={{ margin: 0, color: 'var(--bo-text-muted)' }}>
        Frontend v{APP_VERSION}
      </p>
      <p style={{ margin: 0, color: 'var(--bo-text-muted)' }}>
        {error !== null
          ? `API no disponible: ${error}`
          : apiVersion !== null
            ? `API v${apiVersion}`
            : 'Consultando API...'}
      </p>
    </main>
  );
}
