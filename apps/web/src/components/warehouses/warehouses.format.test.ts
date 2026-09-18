import { describe, it, expect } from 'vitest';
import {
  countLabel,
  reservationsLabel,
  removalFreesWarehouse,
} from './warehouses.format';

describe('etiquetas de reservas', () => {
  it('singulariza el conteo', () => {
    expect(countLabel(1, 'cliente', 'clientes')).toBe('1 cliente');
    expect(countLabel(0, 'grupo', 'grupos')).toBe('0 grupos');
  });

  it('junta clientes y grupos, y omite lo que vale cero', () => {
    expect(reservationsLabel(3, 2)).toBe('3 clientes · 2 grupos');
    expect(reservationsLabel(3, 0)).toBe('3 clientes');
    expect(reservationsLabel(0, 1)).toBe('1 grupo');
  });

  it('sin ninguna reserva no hay etiqueta', () => {
    expect(reservationsLabel(0, 0)).toBeNull();
  });
});

describe('quitar la última reserva libera el almacén', () => {
  // Esta es la regla que dispara la confirmación en la pantalla. El middleware libera el
  // almacén sólo cuando no le queda NI un cliente NI un grupo: por eso se suman los dos y
  // no se miran por separado — quitar el único cliente con un grupo activo no libera nada.
  it('la última reserva lo libera, sea cliente o grupo', () => {
    expect(removalFreesWarehouse(1, 0)).toBe(true);
    expect(removalFreesWarehouse(0, 1)).toBe(true);
  });

  it('con otra reserva viva, quitar una no lo libera', () => {
    expect(removalFreesWarehouse(1, 1)).toBe(false);
    expect(removalFreesWarehouse(5, 0)).toBe(false);
  });
});
