import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { RoleGuard } from '../../auth/RoleGuard';
import {
  IconDashboard,
  IconRegions,
  IconChatSquare,
  IconFileText,
} from './icons';

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
 * Panel izquierdo. Los ítems restringidos van envueltos en RoleGuard: eso es
 * cosmético (no ofrecer lo que el backend va a rechazar), la barrera real está
 * en el `RolesGuard` de la API.
 */
export function Sidebar() {
  return (
    <aside className="bo-sidebar">
      <div className="bo-sidebar__brand">
        <div className="bo-sidebar__appname">Mobility BackOffice</div>
      </div>
      <nav className="bo-sidebar__nav">
        <Item to="/" end icon={<IconDashboard />} label="Inicio" />

        <div className="bo-sidebar__section">Administración</div>
        <RoleGuard allow={['Administrador']}>
          <Item
            to="/regiones-comerciales"
            icon={<IconRegions />}
            label="Regiones comerciales"
          />
        </RoleGuard>

        <div className="bo-sidebar__section">Marketing</div>
        <RoleGuard allow={['Marketing']}>
          <Item
            to="/templates-whatsapp"
            icon={<IconChatSquare />}
            label="Templates de WhatsApp"
          />
          <Item
            to="/documentacion-rag"
            icon={<IconFileText />}
            label="Documentación del RAG"
          />
        </RoleGuard>
      </nav>
    </aside>
  );
}
