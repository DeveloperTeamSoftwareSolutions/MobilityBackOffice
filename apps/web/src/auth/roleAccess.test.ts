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
