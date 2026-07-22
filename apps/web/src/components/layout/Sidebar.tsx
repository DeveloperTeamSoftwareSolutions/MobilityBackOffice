import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { visibleSections, SECTION_GROUPS } from '../../config/sections';
import { IconDashboard } from './icons';

function Item({
  to,
  end,
  icon,
  label,
}: {
  to: string;
  end?: boolean;
  icon: ReactNode;
  label: string;
}) {
  return (
    <NavLink to={to} end={end} className="bo-sidebar__link">
      <span className="bo-sidebar__icon">{icon}</span>
      <span className="bo-sidebar__label">{label}</span>
    </NavLink>
  );
}

/**
 * Panel izquierdo. Las secciones salen de la config compartida (`config/sections`)
 * filtradas por el rol, de modo que sidebar e inicio nunca se desincronizan. Solo se
 * dibuja un grupo si tiene al menos una seccion visible.
 */
export function Sidebar() {
  const { role } = useAuth();
  const sections = visibleSections(role);

  return (
    <aside className="bo-sidebar">
      <div className="bo-sidebar__brand">
        <div className="bo-sidebar__appname">Mobility BackOffice</div>
      </div>
      <nav className="bo-sidebar__nav">
        <Item to="/" end icon={<IconDashboard />} label="Inicio" />

        {SECTION_GROUPS.map((group) => {
          const items = sections.filter((s) => s.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group}>
              <div className="bo-sidebar__section">{group}</div>
              {items.map((s) => (
                <Item key={s.key} to={s.path} icon={s.icon} label={s.label} />
              ))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
