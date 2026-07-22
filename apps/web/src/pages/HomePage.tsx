import { Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { visibleSections, SECTION_GROUPS } from '../config/sections';
import './home.css';

/** Primer nombre para un saludo mas humano. */
function firstName(fullName: string | undefined): string {
  if (!fullName) return '';
  return fullName.trim().split(/\s+/)[0];
}

/**
 * Inicio: tarjetas de las secciones que el rol puede usar. Reemplaza la pantalla
 * vacia de "elegí una sección": aca cada tarjeta es la puerta de entrada.
 */
export function HomePage() {
  const { user, role } = useAuth();
  const sections = visibleSections(role);

  return (
    <>
      <h1 className="bo-page__title">
        Hola{firstName(user?.name) ? `, ${firstName(user?.name)}` : ''}
      </h1>
      <p className="bo-page__subtitle">
        {user?.name} · {role}. Elegí una sección para empezar.
      </p>

      {sections.length === 0 ? (
        <div className="bo-card">
          <p style={{ margin: 0, color: 'var(--bo-text-muted)' }}>
            Tu usuario todavía no tiene secciones habilitadas. Pedí que te asignen un
            rol de BackOffice en ITManager.
          </p>
        </div>
      ) : (
        SECTION_GROUPS.map((group) => {
          const items = sections.filter((s) => s.group === group);
          if (items.length === 0) return null;
          return (
            <section key={group} className="bo-home__group">
              <h2 className="bo-home__grouptitle">{group}</h2>
              <div className="bo-home__grid">
                {items.map((s) => (
                  <Link key={s.key} to={s.path} className="bo-home__card">
                    <span className="bo-home__cardicon">{s.icon}</span>
                    <span className="bo-home__cardbody">
                      <span className="bo-home__cardtitle">
                        {s.label}
                        {s.status === 'soon' && (
                          <span className="bo-home__badge">Próximamente</span>
                        )}
                      </span>
                      <span className="bo-home__carddesc">{s.description}</span>
                    </span>
                    <span className="bo-home__cardchev" aria-hidden>
                      ›
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
