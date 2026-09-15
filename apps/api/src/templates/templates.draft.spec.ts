import { mapDraft } from './templates.util';

/**
 * El borrador que devuelve WABA, listo para rehidratar el formulario.
 *
 * Lo que se fija acá es lo que se perdía al reabrir un borrador por el detalle de la
 * plantilla: el título, el archivo del encabezado y —lo más caro— el nombre y el ejemplo
 * de cada variable. META exige los ejemplos, así que perderlos convierte "seguir mañana"
 * en "escribir todo de nuevo".
 */
describe('mapDraft', () => {
  const base = {
    id: 62,
    name: 'promo_navidad',
    language: 'es_MX',
    category: 'MARKETING',
    headerType: 'NONE',
    bodyText: 'Hola {{1}}',
  };

  it('conserva el título, que no viaja a META', () => {
    // Por eso el detalle de la plantilla no lo tiene: solo vive en el borrador.
    expect(mapDraft({ ...base, friendlyTitle: 'Promo de navidad' })?.friendlyTitle).toBe(
      'Promo de navidad',
    );
  });

  it('conserva el nombre y el ejemplo de cada variable', () => {
    const d = mapDraft({
      ...base,
      variables: [
        { index: 1, target: 'body', label: 'nombre', example: 'María' },
        { index: 2, target: 'body', label: 'fecha', example: '12 de marzo' },
      ],
    });

    expect(d?.variables).toEqual([
      { index: 1, target: 'body', label: 'nombre', example: 'María' },
      { index: 2, target: 'body', label: 'fecha', example: '12 de marzo' },
    ]);
  });

  it('conserva el handle del archivo del encabezado', () => {
    // El archivo está en META; esto es la referencia. Sin ella hay que volver a subirlo.
    const d = mapDraft({ ...base, headerType: 'IMAGE', headerHandle: '4::aW1h:abc' });
    expect(d?.headerHandle).toBe('4::aW1h:abc');
  });

  it('parsea los botones, que viajan como texto', () => {
    const d = mapDraft({
      ...base,
      buttonsJson: '[{"type":"URL","text":"Ver","url":"https://duwest.com"}]',
    });
    expect(d?.buttons).toHaveLength(1);
    expect(d?.buttons[0].url).toBe('https://duwest.com');
  });

  it('un JSON de botones roto no tumba el borrador', () => {
    // Lo escribió otra aplicación y puede venir de una versión anterior.
    const d = mapDraft({ ...base, buttonsJson: '{no es json' });
    expect(d?.buttons).toEqual([]);
    expect(d?.bodyText).toBe('Hola {{1}}');
  });

  it('una variable rota se descarta sin perder las demás', () => {
    const d = mapDraft({
      ...base,
      variables: [
        { index: 1, target: 'body', label: 'nombre', example: 'María' },
        { target: 'body', example: 'sin índice' },
        null,
      ],
    });
    expect(d?.variables).toHaveLength(1);
    expect(d?.variables[0].example).toBe('María');
  });

  it('una variable sin ejemplo queda vacía, no se inventa', () => {
    // El asistente la va a marcar como pendiente, que es lo correcto.
    const d = mapDraft({ ...base, variables: [{ index: 1, target: 'body' }] });
    expect(d?.variables[0]).toEqual({ index: 1, target: 'body', label: '', example: '' });
  });

  describe('las opciones del código OTP', () => {
    /*
     * WABA las completa con valores por defecto en TODOS los borradores, sea cual sea la
     * categoría. Copiarlas sin mirar le prende la advertencia de seguridad y un
     * vencimiento de 10 minutos a un borrador de marketing que nunca los tuvo.
     */
    it('se ignoran cuando la plantilla no es de autenticación', () => {
      const d = mapDraft({
        ...base,
        category: 'MARKETING',
        expirationEnabled: true,
        codeExpirationMinutes: 10,
        addSecurityRecommendation: true,
      });

      expect(d?.codeExpirationMinutes).toBeNull();
      expect(d?.addSecurityRecommendation).toBe(false);
    });

    it('se aplican cuando sí lo es', () => {
      const d = mapDraft({
        ...base,
        category: 'AUTHENTICATION',
        expirationEnabled: true,
        codeExpirationMinutes: 15,
        addSecurityRecommendation: true,
      });

      expect(d?.codeExpirationMinutes).toBe(15);
      expect(d?.addSecurityRecommendation).toBe(true);
    });

    it('sin vencimiento activo, no hay minutos', () => {
      const d = mapDraft({
        ...base,
        category: 'AUTHENTICATION',
        expirationEnabled: false,
        codeExpirationMinutes: 10,
      });
      expect(d?.codeExpirationMinutes).toBeNull();
    });
  });

  it('sin borrador devuelve null', () => {
    expect(mapDraft(null)).toBeNull();
    expect(mapDraft(undefined)).toBeNull();
  });

  it('un borrador casi vacío no rompe', () => {
    // Se guardan incompletos a propósito: ese es el punto de un borrador.
    const d = mapDraft({ id: 1 });
    expect(d?.category).toBe('MARKETING');
    expect(d?.headerType).toBe('NONE');
    expect(d?.variables).toEqual([]);
    expect(d?.buttons).toEqual([]);
  });
});
