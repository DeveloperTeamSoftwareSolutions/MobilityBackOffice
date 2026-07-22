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
