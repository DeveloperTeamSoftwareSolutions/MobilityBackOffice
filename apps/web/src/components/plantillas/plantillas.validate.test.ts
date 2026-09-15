import { describe, it, expect } from 'vitest';
import { validateForm, variableNumbers, LIMITS } from './plantillas.validate';
import { TemplateFormState } from './plantillas.types';

function form(over: Partial<TemplateFormState> = {}): TemplateFormState {
  return {
    friendlyTitle: 'Saludo de Navidad',
    name: 'saludo_navidad',
    language: 'es_MX',
    category: 'MARKETING',
    headerType: 'NONE',
    headerContent: '',
    headerHandle: '',
    headerFileName: '',
    bodyText: 'Hola {{1}}, felices fiestas.',
    footerText: '',
    buttons: [],
    addSecurityRecommendation: false,
    codeExpirationMinutes: '',
    otpType: 'COPY_CODE',
    variables: [],
    ...over,
  };
}

/** Un formulario válido no debe tener errores: si no, los demás tests no prueban nada. */
describe('validateForm — caso válido', () => {
  it('no reporta errores', () => {
    expect(validateForm(form(), false)).toEqual([]);
  });
});

describe('validateForm — nombre', () => {
  it('rechaza mayúsculas, espacios y tildes', () => {
    // Es la regla de META, no una preferencia: el nombre identifica la plantilla.
    expect(validateForm(form({ name: 'Saludo Navidad' }), false).join()).toMatch(/minúsculas/);
    expect(validateForm(form({ name: 'saludo-navidad' }), false).join()).toMatch(/minúsculas/);
    expect(validateForm(form({ name: 'saludó' }), false).join()).toMatch(/minúsculas/);
  });

  it('acepta minúsculas, números y guión bajo', () => {
    expect(validateForm(form({ name: 'promo_2026_v2' }), false)).toEqual([]);
  });

  it('lo exige al crear', () => {
    expect(validateForm(form({ name: '' }), false).join()).toMatch(/nombre es obligatorio/);
  });

  it('NO lo valida al editar: META no lo deja cambiar', () => {
    // En edición el campo viene bloqueado; validarlo solo produciría ruido.
    expect(validateForm(form({ name: 'Nombre Inválido' }), true)).toEqual([]);
  });
});

describe('validateForm — variables', () => {
  /**
   * META numera los ejemplos por posición: un salto le deja un hueco y rechaza. Es de
   * los rechazos más comunes, y cuesta un ciclo de revisión enterarse.
   */
  it('rechaza variables con saltos', () => {
    const errores = validateForm(form({ bodyText: 'Hola {{1}} y {{3}}' }), false);
    expect(errores.join()).toMatch(/en orden y sin saltos/);
  });

  it('rechaza que no empiecen en 1', () => {
    expect(validateForm(form({ bodyText: 'Hola {{2}}' }), false).join()).toMatch(/sin saltos/);
  });

  it('acepta la secuencia correcta', () => {
    expect(validateForm(form({ bodyText: '{{1}} {{2}} {{3}}' }), false)).toEqual([]);
  });

  it('acepta un mensaje sin variables', () => {
    expect(validateForm(form({ bodyText: 'Mensaje fijo' }), false)).toEqual([]);
  });

  it('el pie no admite variables', () => {
    expect(validateForm(form({ footerText: 'Hola {{1}}' }), false).join()).toMatch(
      /pie no admite variables/,
    );
  });

  it('el encabezado admite una sola', () => {
    const errores = validateForm(
      form({ headerType: 'TEXT', headerContent: '{{1}} y {{2}}' }),
      false,
    );
    expect(errores.join()).toMatch(/una sola variable/);
  });
});

describe('validateForm — largos', () => {
  it('corta el mensaje que excede el límite de META', () => {
    const largo = 'x'.repeat(LIMITS.BODY_MAX + 1);
    expect(validateForm(form({ bodyText: largo }), false).join()).toMatch(/mensaje no puede superar/);
  });

  it('corta el pie que excede', () => {
    const largo = 'x'.repeat(LIMITS.FOOTER_MAX + 1);
    expect(validateForm(form({ footerText: largo }), false).join()).toMatch(/pie no puede superar/);
  });

  it('corta el encabezado que excede', () => {
    const largo = 'x'.repeat(LIMITS.HEADER_TEXT_MAX + 1);
    const errores = validateForm(form({ headerType: 'TEXT', headerContent: largo }), false);
    expect(errores.join()).toMatch(/encabezado no puede superar/);
  });
});

describe('validateForm — encabezado', () => {
  it('con tipo TEXT exige el texto', () => {
    expect(validateForm(form({ headerType: 'TEXT', headerContent: '' }), false).join()).toMatch(
      /escribí el texto o quitá el encabezado/,
    );
  });

  it('los de multimedia no exigen texto', () => {
    // El archivo lo elige quien envía; la plantilla solo declara el hueco.
    expect(validateForm(form({ headerType: 'IMAGE' }), false)).toEqual([]);
  });
});

describe('validateForm — botones', () => {
  const btn = (over = {}) => ({
    type: 'QUICK_REPLY',
    text: 'Sí',
    url: null,
    phoneNumber: null,
    ...over,
  });

  it('exige texto en cada botón', () => {
    expect(validateForm(form({ buttons: [btn({ text: '' })] }), false).join()).toMatch(
      /botón 1 necesita un texto/,
    );
  });

  it('el de enlace exige la URL', () => {
    expect(
      validateForm(form({ buttons: [btn({ type: 'URL', url: '' })] }), false).join(),
    ).toMatch(/necesita un enlace/);
  });

  it('el de llamada exige el teléfono', () => {
    expect(
      validateForm(form({ buttons: [btn({ type: 'PHONE_NUMBER', phoneNumber: '' })] }), false).join(),
    ).toMatch(/necesita un número de teléfono/);
  });

  it('respeta el tope de cada tipo', () => {
    const cuatro = Array.from({ length: 4 }, () => btn());
    expect(validateForm(form({ buttons: cuatro }), false).join()).toMatch(/máximo 3 botones/);

    const tresUrl = Array.from({ length: 3 }, () => btn({ type: 'URL', url: 'https://x.com' }));
    expect(validateForm(form({ buttons: tresUrl }), false).join()).toMatch(/máximo 2 botones/);

    const dosTel = Array.from({ length: 2 }, () => btn({ type: 'PHONE_NUMBER', phoneNumber: '+502' }));
    expect(validateForm(form({ buttons: dosTel }), false).join()).toMatch(/máximo 1 botón/);
  });

  it('acepta una combinación dentro de los topes', () => {
    const mix = [
      btn(),
      btn({ type: 'URL', text: 'Ver', url: 'https://duwest.com' }),
      btn({ type: 'PHONE_NUMBER', text: 'Llamar', phoneNumber: '+50212345678' }),
    ];
    expect(validateForm(form({ buttons: mix }), false)).toEqual([]);
  });
});

describe('validateForm — AUTHENTICATION', () => {
  const auth = (over = {}) => form({ category: 'AUTHENTICATION', bodyText: '', ...over });

  it('NO exige mensaje: META escribe el texto', () => {
    expect(validateForm(auth(), false)).toEqual([]);
  });

  it('acepta una expiración dentro del rango', () => {
    expect(validateForm(auth({ codeExpirationMinutes: '10' }), false)).toEqual([]);
  });

  it('rechaza una expiración fuera de rango', () => {
    expect(validateForm(auth({ codeExpirationMinutes: '0' }), false).join()).toMatch(/entre 1 y 90/);
    expect(validateForm(auth({ codeExpirationMinutes: '999' }), false).join()).toMatch(/entre 1 y 90/);
  });

  it('rechaza una expiración que no es entera', () => {
    expect(validateForm(auth({ codeExpirationMinutes: '10.5' }), false).join()).toMatch(/entero/);
  });

  it('la expiración es opcional', () => {
    expect(validateForm(auth({ codeExpirationMinutes: '' }), false)).toEqual([]);
  });

  it('ignora los campos de contenido: ahí no aplican', () => {
    // Un cuerpo vacío y sin botones no es un error en esta categoría.
    expect(validateForm(auth({ footerText: '', buttons: [] }), false)).toEqual([]);
  });
});

describe('variableNumbers', () => {
  it('devuelve los números ordenados y sin repetir', () => {
    expect(variableNumbers('{{2}} {{1}} {{2}}')).toEqual([1, 2]);
  });

  it('sin variables devuelve vacío', () => {
    expect(variableNumbers('sin nada')).toEqual([]);
  });
});
