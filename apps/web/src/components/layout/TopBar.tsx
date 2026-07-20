import { useAuth } from '../../auth/useAuth';
import { APP_VERSION } from '../../version';
import { IconMenu } from './icons';

export function TopBar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { user, role, logout } = useAuth();

  return (
    <header className="bo-topbar">
      <div className="bo-topbar__left">
        <button
          type="button"
          className="bo-topbar__toggle"
          onClick={onToggleSidebar}
          title="Mostrar u ocultar el panel"
          aria-label="Mostrar u ocultar el panel"
        >
          <IconMenu />
        </button>
      </div>
      <div className="bo-topbar__right">
        {user && (
          <span className="bo-topbar__user">
            {user.name}
            {role ? ` · ${role}` : ''}
          </span>
        )}
        <button type="button" className="bo-topbar__logout" onClick={logout}>
          Salir
        </button>
        <span className="bo-topbar__version">v{APP_VERSION}</span>
      </div>
    </header>
  );
}
