import { mapEditPolicy } from './templates.util';

/**
 * La política de edición, traducida.
 *
 * Dos cosas se fijan acá porque cada una, sola, rompe la pantalla de una forma que no
 * se ve hasta que alguien intenta editar:
 *
 * 1. WABA manda `allowed`, no `canEdit`. Leer la propiedad equivocada daba `undefined`,
 *    y `undefined === false` es falso: la pantalla dejaba editar una plantilla en
 *    revisión y el rechazo aparecía recién al guardar.
 * 2. `reason` y `warnings` son claves i18n, no frases. Sin traducir, al usuario le queda
 *    `templates.edit.blockedInReview` en la cara.
 */
describe('mapEditPolicy', () => {
  it('traduce `allowed` a `canEdit`', () => {
    expect(mapEditPolicy({ allowed: true }).canEdit).toBe(true);
    expect(mapEditPolicy({ allowed: false }).canEdit).toBe(false);
  });

  it('sin política no se puede editar', () => {
    // Lo único honesto cuando no se sabe: evita el formulario que va a fallar.
    expect(mapEditPolicy(null).canEdit).toBe(false);
    expect(mapEditPolicy(undefined).canEdit).toBe(false);
  });

  it('una respuesta sin `allowed` tampoco habilita', () => {
    // Es el caso que rompía: la propiedad ausente no puede leerse como permiso.
    expect(mapEditPolicy({}).canEdit).toBe(false);
  });

  it('traduce el motivo del bloqueo', () => {
    const p = mapEditPolicy({
      allowed: false,
      reason: 'templates.edit.blockedInReview',
    });

    expect(p.reason).toContain('META está revisando esta plantilla');
    expect(p.reason).not.toContain('templates.edit');
  });

  it('traduce los avisos', () => {
    const p = mapEditPolicy({
      allowed: true,
      warnings: ['templates.edit.warnBackToReview', 'templates.edit.warnQuotaLow'],
    });

    expect(p.warnings).toHaveLength(2);
    expect(p.warnings[0]).toContain('vuelve a revisión de META');
    expect(p.warnings[1]).toContain('pocas ediciones');
  });

  it('una clave que no conocemos se muestra tal cual', () => {
    // Si WABA agrega un aviso nuevo, es mejor mostrar algo que tragárselo en silencio.
    const p = mapEditPolicy({ allowed: true, warnings: ['templates.edit.warnNueva'] });
    expect(p.warnings).toEqual(['templates.edit.warnNueva']);
  });

  it('conserva el cupo de ediciones', () => {
    // Los números son de META y hay que mostrarlos: son la diferencia entre "no anduvo"
    // y "ya usaste las 10 del mes".
    const p = mapEditPolicy({
      allowed: true,
      limited: true,
      used: 7,
      remaining: 3,
      cooldownUntil: '2026-09-01T10:00:00.000Z',
    });

    expect(p).toMatchObject({
      limited: true,
      used: 7,
      remaining: 3,
      cooldownUntil: '2026-09-01T10:00:00.000Z',
    });
  });

  it('sin límite, `remaining` es null y no cero', () => {
    // Cero significaría "no te quedan"; las rechazadas y pausadas son ilimitadas.
    const p = mapEditPolicy({ allowed: true, limited: false });
    expect(p.remaining).toBeNull();
    expect(p.limited).toBe(false);
  });

  it('un borrador no requiere llamar a META', () => {
    expect(mapEditPolicy({ allowed: true, requiresMeta: false }).requiresMeta).toBe(false);
  });

  it('ante la duda, se asume que sí requiere META', () => {
    // Es el caso caro de equivocarse: guardar solo local algo que vive en META lo deja
    // distinto de lo que ve el cliente.
    expect(mapEditPolicy({ allowed: true }).requiresMeta).toBe(true);
  });
});
