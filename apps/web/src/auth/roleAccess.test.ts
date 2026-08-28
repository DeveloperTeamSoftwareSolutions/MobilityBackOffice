import { describe, it, expect } from 'vitest';
import { roleAllows } from './roleAccess';

describe('roleAllows', () => {
  it('SuperAdmin accede a cualquier seccion', () => {
    expect(roleAllows('SuperAdmin', ['Administrador'])).toBe(true);
    expect(roleAllows('SuperAdmin', ['Marketing'])).toBe(true);
    expect(roleAllows('SuperAdmin', [])).toBe(true);
  });

  it('un rol accede si esta en la lista permitida', () => {
    expect(roleAllows('Administrador', ['Administrador'])).toBe(true);
    expect(roleAllows('Marketing', ['Marketing', 'Administrador'])).toBe(true);
  });

  it('un rol no accede si no esta en la lista', () => {
    expect(roleAllows('Marketing', ['Administrador'])).toBe(false);
    expect(roleAllows('Administrador', ['Marketing'])).toBe(false);
  });

  it('sin rol no accede a nada', () => {
    expect(roleAllows(null, ['Administrador'])).toBe(false);
    expect(roleAllows(null, [])).toBe(false);
  });
});

describe('roleAllows — rol Soporte', () => {
  it('Soporte accede a la consola de soporte', () => {
    expect(roleAllows('Soporte', ['Soporte'])).toBe(true);
  });

  it('SuperAdmin tambien entra a la consola de soporte (decision D5)', () => {
    expect(roleAllows('SuperAdmin', ['Soporte'])).toBe(true);
  });

  it('Soporte no accede a Regiones ni a Marketing', () => {
    expect(roleAllows('Soporte', ['Administrador'])).toBe(false);
    expect(roleAllows('Soporte', ['Marketing'])).toBe(false);
  });

  it('ningun otro rol entra a la consola de soporte', () => {
    expect(roleAllows('Administrador', ['Soporte'])).toBe(false);
    expect(roleAllows('Marketing', ['Soporte'])).toBe(false);
    expect(roleAllows(null, ['Soporte'])).toBe(false);
  });
});

describe('roleAllows — rol Usuario', () => {
  /**
   * La regla del rol es una sola: TODO menos la consola de soporte. Se expresa como
   * exclusión (`!allow.includes('Soporte')`) y no listando 'Usuario' en cada sección,
   * justamente para que una sección nueva quede visible sin que nadie se acuerde de
   * sumarlo. Estos tests fijan esa regla.
   */
  it('accede a lo que piden Administrador y Marketing', () => {
    expect(roleAllows('Usuario', ['Administrador'])).toBe(true);
    expect(roleAllows('Usuario', ['Marketing'])).toBe(true);
    expect(roleAllows('Usuario', ['Administrador', 'Marketing'])).toBe(true);
  });

  it('NO accede a la consola de soporte: es lo unico que lo distingue', () => {
    expect(roleAllows('Usuario', ['Soporte'])).toBe(false);
  });

  it('tampoco si Soporte aparece junto a otros roles', () => {
    // Una seccion mixta sigue siendo de soporte: basta que lo pida.
    expect(roleAllows('Usuario', ['Soporte', 'Administrador'])).toBe(false);
  });

  it('una seccion NUEVA le queda visible sin tocar nada', () => {
    // Es la razon de ser de la exclusion: un rol futuro que no existe todavia.
    expect(roleAllows('Usuario', ['UnRolQueNoExisteAun' as never])).toBe(true);
    expect(roleAllows('Usuario', [])).toBe(true);
  });

  it('no le da acceso a los demas roles por rebote', () => {
    expect(roleAllows('Administrador', ['Usuario'])).toBe(false);
    expect(roleAllows('Marketing', ['Usuario'])).toBe(false);
    expect(roleAllows('Soporte', ['Usuario'])).toBe(false);
  });
});

describe('roleAllows — secciones exclusivas de SuperAdmin', () => {
  /**
   * Una seccion que lista `SuperAdmin` como unico rol permitido no la ve nadie mas.
   * El caso que importa es `Usuario`: como su regla es por exclusion, sin excluir
   * tambien `SuperAdmin` una seccion asi le quedaria visible por defecto.
   */
  it('SuperAdmin entra', () => {
    expect(roleAllows('SuperAdmin', ['SuperAdmin'])).toBe(true);
  });

  it('Usuario NO entra, aunque su regla sea por exclusion', () => {
    expect(roleAllows('Usuario', ['SuperAdmin'])).toBe(false);
  });

  it('ningun otro rol entra', () => {
    expect(roleAllows('Administrador', ['SuperAdmin'])).toBe(false);
    expect(roleAllows('Marketing', ['SuperAdmin'])).toBe(false);
    expect(roleAllows('Soporte', ['SuperAdmin'])).toBe(false);
    expect(roleAllows(null, ['SuperAdmin'])).toBe(false);
  });

  it('una seccion mixta con SuperAdmin sigue tapada para Usuario', () => {
    expect(roleAllows('Usuario', ['SuperAdmin', 'Administrador'])).toBe(false);
    expect(roleAllows('Administrador', ['SuperAdmin', 'Administrador'])).toBe(true);
  });
});
