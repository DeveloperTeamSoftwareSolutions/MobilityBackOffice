import { describe, it, expect } from 'vitest';
import {
  buttonLabel,
  categoryLabel,
  headerLabel,
  languageLabel,
  statusHint,
  statusLabel,
  statusTone,
  variablesLabel,
} from './plantillas.format';
import { Template } from './plantillas.types';

function template(over: Partial<Template> = {}): Template {
  return {
    id: 1,
    name: 'template_reminder',
    language: 'es_MX',
    category: 'MARKETING',
    status: 'APPROVED',
    headerType: null,
    headerContent: null,
    bodyText: 'Hola {{1}}',
    footerText: null,
    buttons: [],
    variables: ['1'],
    ...over,
  };
}

describe('statusLabel y statusHint', () => {
  it('traduce los estados de META', () => {
    expect(statusLabel('APPROVED')).toBe('Aprobada');
    expect(statusLabel('PENDING')).toBe('En revisión');
    expect(statusLabel('REJECTED')).toBe('Rechazada');
  });

  it('un estado desconocido no rompe', () => {
    expect(statusLabel(null)).toBe('Sin estado');
  });

  /**
   * El estado lo decide META, no la empresa. Sin la aclaracion, "En revisión" parece
   * algo que se puede destrabar desde esta pantalla.
   */
  it('explica que la revision depende de META', () => {
    expect(statusHint('PENDING')).toMatch(/META/);
    expect(statusHint('REJECTED')).toMatch(/META/);
  });

  it('dice claramente cual se puede enviar y cual no', () => {
    expect(statusHint('APPROVED')).toBe('Se puede enviar');
    expect(statusHint('REJECTED')).toMatch(/no se puede enviar/);
    expect(statusHint('PAUSED')).toMatch(/no se puede enviar/);
  });
});

describe('statusTone', () => {
  it('separa lo usable de lo que no', () => {
    expect(statusTone('APPROVED')).toBe('ok');
    expect(statusTone('PENDING')).toBe('warn');
    expect(statusTone('REJECTED')).toBe('bad');
    expect(statusTone('DISABLED')).toBe('bad');
    expect(statusTone(null)).toBe('neutral');
  });
});

describe('categoryLabel', () => {
  it('traduce las categorias de META', () => {
    expect(categoryLabel('MARKETING')).toBe('Marketing');
    expect(categoryLabel('UTILITY')).toBe('Utilidad');
    expect(categoryLabel('AUTHENTICATION')).toBe('Autenticación');
  });

  it('una categoria nueva se muestra tal cual en vez de perderse', () => {
    expect(categoryLabel('ALGO_NUEVO')).toBe('ALGO_NUEVO');
    expect(categoryLabel(null)).toBe('Sin categoría');
  });
});

describe('languageLabel', () => {
  it('traduce el idioma con su region', () => {
    expect(languageLabel('es_MX')).toBe('Español (MX)');
    expect(languageLabel('en_US')).toBe('Inglés (US)');
  });

  it('sin region muestra solo el idioma', () => {
    expect(languageLabel('es')).toBe('Español');
  });

  it('un idioma desconocido se muestra tal cual', () => {
    expect(languageLabel('zz_ZZ')).toBe('zz_ZZ');
    expect(languageLabel(null)).toBe('Sin idioma');
  });
});

describe('headerLabel', () => {
  it('traduce el tipo de encabezado', () => {
    expect(headerLabel('IMAGE')).toBe('Imagen');
    expect(headerLabel('DOCUMENT')).toBe('Documento');
  });

  it('NONE y vacio se tratan igual: no hay encabezado', () => {
    expect(headerLabel('NONE')).toBeNull();
    expect(headerLabel(null)).toBeNull();
  });
});

describe('variablesLabel', () => {
  /**
   * Importa porque una plantilla con variables NO se puede enviar sin completarlas, y
   * eso no se ve mirando el cuerpo de reojo.
   */
  it('avisa cuantas hay que completar', () => {
    expect(variablesLabel(template({ variables: ['1'] }))).toBe('1 variable a completar');
    expect(variablesLabel(template({ variables: ['1', '2'] }))).toBe('2 variables a completar');
  });

  it('sin variables lo dice', () => {
    expect(variablesLabel(template({ variables: [] }))).toBe('Sin variables');
  });
});

describe('buttonLabel', () => {
  it('muestra el destino del boton', () => {
    expect(buttonLabel({ type: 'URL', text: 'Ver', url: 'https://x.com', phoneNumber: null })).toBe(
      'Ver → https://x.com',
    );
    expect(
      buttonLabel({ type: 'PHONE_NUMBER', text: 'Llamar', url: null, phoneNumber: '+502123' }),
    ).toBe('Llamar → +502123');
  });

  it('un boton sin destino muestra solo su texto', () => {
    expect(buttonLabel({ type: 'QUICK_REPLY', text: 'Sí', url: null, phoneNumber: null })).toBe('Sí');
  });

  it('un boton sin texto no queda vacio', () => {
    expect(buttonLabel({ type: 'URL', text: null, url: null, phoneNumber: null })).toBe('Sin texto');
  });
});
