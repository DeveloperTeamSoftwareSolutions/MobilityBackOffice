import { ReactNode } from 'react';
import {
  IconRegions,
  IconChatSquare,
  IconFileText,
} from '../components/layout/icons';
import type { BackOfficeRole } from '../types';
import { roleAllows } from '../auth/roleAccess';

export type SectionGroup = 'Administración' | 'Marketing';

export interface NavSection {
  key: string;
  label: string;
  /** Descripcion corta para la tarjeta del inicio. */
  description: string;
  path: string;
  group: SectionGroup;
  /** Roles que ven la seccion (SuperAdmin siempre). */
  roles: BackOfficeRole[];
  /** `soon` = declarada pero aun sin construir (muestra "Proximamente"). */
  status: 'ready' | 'soon';
  icon: ReactNode;
}

/**
 * Fuente unica de las secciones de negocio. La consumen el sidebar y las tarjetas
 * del inicio, para que ambos queden siempre sincronizados. "Inicio" no esta aca: es
 * fijo y siempre visible.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    key: 'regiones',
    label: 'Regiones comerciales',
    description:
      'Vinculá centros de beneficio (CEBE) y sociedades a cada región para consolidar los reportes.',
    path: '/regiones-comerciales',
    group: 'Administración',
    roles: ['Administrador'],
    status: 'ready',
    icon: <IconRegions />,
  },
  {
    key: 'templates',
    label: 'Templates de WhatsApp',
    description:
      'Creación y gestión de plantillas de WhatsApp para el equipo de marketing.',
    path: '/templates-whatsapp',
    group: 'Marketing',
    roles: ['Marketing'],
    status: 'soon',
    icon: <IconChatSquare />,
  },
  {
    key: 'rag',
    label: 'Documentación del RAG',
    description: 'Cargá y gestioná la documentación de la base de conocimiento.',
    path: '/documentacion-rag',
    group: 'Marketing',
    roles: ['Marketing'],
    status: 'ready',
    icon: <IconFileText />,
  },
];

/** Orden de los grupos en el sidebar y el inicio. */
export const SECTION_GROUPS: SectionGroup[] = ['Administración', 'Marketing'];

/** Secciones visibles para un rol. */
export function visibleSections(role: BackOfficeRole | null): NavSection[] {
  return NAV_SECTIONS.filter((s) => roleAllows(role, s.roles));
}
