import { describe, it, expect } from 'vitest';
import { NAV_SECTIONS, visibleSections } from './sections';
import type { BackOfficeRole } from '../types';

/**
 * Esta es la tabla "Qué ve cada rol" de `docs/ROLES_Y_PERMISOS.md`, escrita como
 * assertion.
 *
 * Existe porque esa tabla es lo que lee alguien que asigna roles en ITManager, y una
 * documentación de permisos que miente es peor que no tenerla: se decide en base a
 * ella sin volver a mirar el código. Si el código cambia y la tabla no, esto falla.
 */
const MATRIZ: Record<string, string[]> = {
  SuperAdmin: ['regiones', 'templates', 'rag', 'soporte', 'autorizadores'],
  Soporte: ['soporte'],
  Usuario: ['regiones', 'templates', 'rag'],
  Administrador: ['regiones'],
  Marketing: ['templates', 'rag'],
};

describe('visibleSections — la matriz documentada', () => {
  for (const [rol, esperadas] of Object.entries(MATRIZ)) {
    it(`${rol} ve exactamente: ${esperadas.join(', ')}`, () => {
      const vistas = visibleSections(rol as BackOfficeRole).map((s) => s.key);
      expect(vistas.sort()).toEqual([...esperadas].sort());
    });
  }

  it('sin rol no ve ninguna sección', () => {
    expect(visibleSections(null)).toHaveLength(0);
  });

  it('la matriz cubre TODAS las secciones declaradas', () => {
    // Si alguien agrega una sección y no la suma acá, este test avisa: es la forma de
    // que la documentación no se quede vieja en silencio.
    const declaradas = NAV_SECTIONS.map((s) => s.key).sort();
    const cubiertas = [...new Set(Object.values(MATRIZ).flat())].sort();
    expect(cubiertas).toEqual(declaradas);
  });

  it('Usuario ve lo de SuperAdmin salvo soporte y lo exclusivo de SuperAdmin', () => {
    // La regla del rol, verificada contra las secciones reales y no contra una lista.
    const superAdmin = visibleSections('SuperAdmin').map((s) => s.key);
    const usuario = visibleSections('Usuario').map((s) => s.key);
    const soporte = NAV_SECTIONS.filter((s) => s.roles.includes('Soporte')).map((s) => s.key);
    const soloSuperAdmin = NAV_SECTIONS.filter((s) =>
      s.roles.includes('SuperAdmin'),
    ).map((s) => s.key);

    expect(usuario.sort()).toEqual(
      superAdmin
        .filter((k) => !soporte.includes(k) && !soloSuperAdmin.includes(k))
        .sort(),
    );
    expect(soporte.length).toBeGreaterThan(0);
    expect(soloSuperAdmin.length).toBeGreaterThan(0);
  });
});
