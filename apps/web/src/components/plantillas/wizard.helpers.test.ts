import { describe, it, expect } from 'vitest';
import {
  bloqueoDelPaso,
  insertarVariable,
  nombreTecnico,
  pasosDe,
  proximaVariable,
  sincronizarVariables,
  variablesSinEjemplo,
} from './wizard.helpers';
import { TemplateFormState } from './plantillas.types';

function form(over: Partial<TemplateFormState> = {}): TemplateFormState {
  return {
    friendlyTitle: 'Recordatorio de turno',
    name: 'recordatorio_de_turno',
    language: 'es_MX',
    category: 'UTILITY',
    headerType: 'NONE',
    headerContent: '',
    headerHandle: '',
    headerFileName: '',
    bodyText: 'Hola {{1}}',
    footerText: '',
    buttons: [],
    addSecurityRecommendation: false,
    codeExpirationMinutes: '',
    otpType: 'COPY_CODE',
    variables: [{ index: 1, target: 'body', label: 'nombre', example: 'María' }],
    ...over,
  };
}

/**
 * META solo acepta minúsculas, números y guión bajo. Generarlo del título evita que
 * alguien pelee con esa regla escribiéndolo a mano.
 */
describe('nombreTecnico', () => {
  it('convierte un título a un nombre válido', () => {
    expect(nombreTecnico('Saludo de Navidad')).toBe('saludo_de_navidad');
  });

  it('saca las tildes: META no las admite', () => {
    expect(nombreTecnico('Promoción')).toBe('promocion');
    expect(nombreTecnico('Recordatorió de turno')).toBe('recordatorio_de_turno');
  });

  it('saca los signos y no deja guiones sueltos en los bordes', () => {
    expect(nombreTecnico('¡Promo 2026!')).toBe('promo_2026');
    expect(nombreTecnico('  espacios  ')).toBe('espacios');
  });

  it('un título vacío da un nombre vacío, no basura', () => {
    expect(nombreTecnico('')).toBe('');
    expect(nombreTecnico('!!!')).toBe('');
  });
});

describe('proximaVariable e insertarVariable', () => {
  it('la primera es {{1}}', () => {
    expect(proximaVariable('Hola')).toBe(1);
  });

  it('sigue después de la mayor', () => {
    expect(proximaVariable('{{1}} y {{2}}')).toBe(3);
  });

  it('inserta en la posición del cursor', () => {
    expect(insertarVariable('Hola , ¿cómo estás?', 5)).toBe('Hola {{1}}, ¿cómo estás?');
  });

  it('inserta al final si la posición se pasa', () => {
    expect(insertarVariable('Hola', 999)).toBe('Hola{{1}}');
  });
});

/**
 * La lista de variables sigue a los textos. Lo importante: **lo ya cargado se conserva**
 * — perder el ejemplo por editar una coma sería exasperante.
 */
describe('sincronizarVariables', () => {
  it('agrega la fila de una variable nueva', () => {
    const out = sincronizarVariables(form({ bodyText: '{{1}} y {{2}}' }));
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ index: 2, target: 'body', label: '', example: '' });
  });

  it('conserva el nombre y el ejemplo ya cargados', () => {
    const out = sincronizarVariables(form({ bodyText: 'Hola {{1}} de nuevo' }));
    expect(out[0]).toEqual({ index: 1, target: 'body', label: 'nombre', example: 'María' });
  });

  it('quita la fila de una variable borrada del texto', () => {
    expect(sincronizarVariables(form({ bodyText: 'Sin variables' }))).toEqual([]);
  });

  it('toma también la del encabezado', () => {
    const out = sincronizarVariables(
      form({ headerType: 'TEXT', headerContent: 'Hola {{1}}', bodyText: 'Texto {{1}}' }),
    );
    expect(out.filter((v) => v.target === 'header')).toHaveLength(1);
    expect(out.filter((v) => v.target === 'body')).toHaveLength(1);
  });

  it('ignora el encabezado cuando no es de texto', () => {
    const out = sincronizarVariables(
      form({ headerType: 'IMAGE', headerContent: '{{1}}', bodyText: 'Hola' }),
    );
    expect(out).toEqual([]);
  });
});

describe('variablesSinEjemplo', () => {
  it('detecta las que no tienen ejemplo', () => {
    const sin = variablesSinEjemplo([
      { index: 1, target: 'body', label: '', example: 'María' },
      { index: 2, target: 'body', label: '', example: '   ' },
    ]);
    expect(sin.map((v) => v.index)).toEqual([2]);
  });
});

describe('pasosDe', () => {
  it('AUTHENTICATION tiene otros pasos: no hay mensaje que escribir', () => {
    expect(pasosDe('AUTHENTICATION')).toContain('Código');
    expect(pasosDe('AUTHENTICATION')).not.toContain('Mensaje');
  });

  it('las demás categorías siguen el recorrido completo', () => {
    expect(pasosDe('MARKETING')).toEqual([
      'Objetivo',
      'Nombre',
      'Mensaje',
      'Extras',
      'Botones',
      'Revisión',
    ]);
  });
});

/** El motivo se muestra al lado del botón: nada de "Siguiente" apagado sin explicación. */
describe('bloqueoDelPaso', () => {
  it('deja avanzar cuando el paso está completo', () => {
    expect(bloqueoDelPaso(form(), 0)).toBeNull();
    expect(bloqueoDelPaso(form(), 1)).toBeNull();
    expect(bloqueoDelPaso(form(), 2)).toBeNull();
  });

  it('pide el título antes de seguir', () => {
    expect(bloqueoDelPaso(form({ friendlyTitle: '' }), 1)).toMatch(/título/);
  });

  it('rechaza un nombre técnico inválido', () => {
    expect(bloqueoDelPaso(form({ name: 'Con Mayúsculas' }), 1)).toMatch(/minúsculas/);
  });

  it('pide el mensaje', () => {
    expect(bloqueoDelPaso(form({ bodyText: '', variables: [] }), 2)).toMatch(/Escribí el mensaje/);
  });

  it('EXIGE el ejemplo de cada variable: META lo usa para revisar', () => {
    const sinEjemplo = form({
      variables: [{ index: 1, target: 'body', label: 'nombre', example: '' }],
    });
    const motivo = bloqueoDelPaso(sinEjemplo, 2);
    expect(motivo).toMatch(/\{\{1\}\}/);
    expect(motivo).toMatch(/META/);
  });

  it('en Extras pide el texto si el encabezado es de texto', () => {
    const f = form({ headerType: 'TEXT', headerContent: '' });
    expect(bloqueoDelPaso(f, 3)).toMatch(/encabezado/);
  });

  it('valida la expiración del código en AUTHENTICATION', () => {
    const auth = (mins: string) =>
      form({ category: 'AUTHENTICATION', codeExpirationMinutes: mins });
    // En AUTHENTICATION el paso 2 es "Código".
    expect(bloqueoDelPaso(auth('999'), 2)).toMatch(/entre 1 y 90/);
    expect(bloqueoDelPaso(auth('10'), 2)).toBeNull();
    expect(bloqueoDelPaso(auth(''), 2)).toBeNull();
  });
});
