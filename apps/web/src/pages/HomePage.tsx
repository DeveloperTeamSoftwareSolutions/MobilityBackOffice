import { useAuth } from '../auth/useAuth';

export function HomePage() {
  const { user, role } = useAuth();

  return (
    <>
      <h1 className="bo-page__title">Inicio</h1>
      <p className="bo-page__subtitle">
        {user ? `${user.name} · ${role}` : ''}
      </p>
      <div className="bo-card">
        <p style={{ margin: 0, color: 'var(--bo-text-muted)' }}>
          Elegí una sección en el panel de la izquierda. Solo se muestran las que
          corresponden a tu rol.
        </p>
      </div>
    </>
  );
}
