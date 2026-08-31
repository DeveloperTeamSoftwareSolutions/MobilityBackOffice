import { TemplateFormState, TemplateVariable } from './plantillas.types';
import { variableNumbers } from './plantillas.validate';

/** Piezas del asistente que se pueden probar sin montar la interfaz. */

/**
 * Nombre técnico a partir del título.
 *
 * META solo acepta minúsculas, números y guión bajo. En vez de pedirlo aparte —y que
 * alguien pelee con la regla— se genera del título que la persona ya escribió, igual que
 * hace el asistente de WABA. Se puede corregir a mano.
 */
export function nombreTecnico(titulo: string): string {
  return (titulo || '')
    .normalize('NFD')
    // Saca las tildes: `saludó` → `saludo`. META no las admite.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 512);
}

/** El próximo `{{n}}` libre para insertar en el texto. */
export function proximaVariable(bodyText: string): number {
  const usados = variableNumbers(bodyText);
  return usados.length === 0 ? 1 : Math.max(...usados) + 1;
}

/** Inserta `{{n}}` en la posición del cursor y devuelve el texto nuevo. */
export function insertarVariable(texto: string, posicion: number): string {
  const n = proximaVariable(texto);
  const i = Math.max(0, Math.min(posicion, texto.length));
  return `${texto.slice(0, i)}{{${n}}}${texto.slice(i)}`;
}

/**
 * Sincroniza la lista de variables con las que hay realmente en los textos.
 *
 * Es la pieza que mantiene honesto el paso de datos variables: si alguien borra un
 * `{{2}}` del mensaje, su fila desaparece; si agrega un `{{3}}`, aparece vacía. Lo ya
 * cargado (nombre y ejemplo) **se conserva** — perderlo al editar una coma sería
 * exasperante.
 */
export function sincronizarVariables(form: TemplateFormState): TemplateVariable[] {
  const enBody = variableNumbers(form.bodyText).map((index) => ({ index, target: 'body' as const }));
  const enHeader =
    form.headerType === 'TEXT'
      ? variableNumbers(form.headerContent).map((index) => ({ index, target: 'header' as const }))
      : [];

  return [...enHeader, ...enBody].map(({ index, target }) => {
    const previa = form.variables.find((v) => v.index === index && v.target === target);
    return {
      index,
      target,
      label: previa?.label ?? '',
      example: previa?.example ?? '',
    };
  });
}

/**
 * META **exige un ejemplo por variable**: es lo que mira el revisor para entender qué va
 * a ir ahí. Sin ejemplos, rechaza.
 */
export function variablesSinEjemplo(variables: TemplateVariable[]): TemplateVariable[] {
  return variables.filter((v) => !v.example.trim());
}

/** Pasos del asistente. AUTHENTICATION reemplaza los de contenido por el del código. */
export const PASOS_CONTENIDO = [
  'Objetivo',
  'Nombre',
  'Mensaje',
  'Extras',
  'Botones',
  'Revisión',
] as const;

export const PASOS_AUTH = ['Objetivo', 'Nombre', 'Código', 'Revisión'] as const;

export function pasosDe(category: string): readonly string[] {
  return category === 'AUTHENTICATION' ? PASOS_AUTH : PASOS_CONTENIDO;
}

/**
 * Qué falta para poder avanzar del paso actual.
 *
 * Devuelve el motivo, no un booleano: el asistente lo muestra al lado del botón, así no
 * hay un "Siguiente" apagado sin explicación.
 */
export function bloqueoDelPaso(
  form: TemplateFormState,
  paso: number,
): string | null {
  const esAuth = form.category === 'AUTHENTICATION';
  const nombre = pasosDe(form.category)[paso];

  if (nombre === 'Objetivo') {
    return form.category ? null : 'Elegí para qué vas a usar la plantilla.';
  }

  if (nombre === 'Nombre') {
    if (!form.friendlyTitle.trim()) return 'Poné un título para reconocerla.';
    if (!form.name.trim()) return 'Falta el nombre técnico.';
    if (!/^[a-z0-9_]+$/.test(form.name)) {
      return 'El nombre técnico solo admite minúsculas, números y guión bajo.';
    }
    return null;
  }

  if (nombre === 'Mensaje') {
    if (!form.bodyText.trim()) return 'Escribí el mensaje.';
    const sinEjemplo = variablesSinEjemplo(form.variables.filter((v) => v.target === 'body'));
    if (sinEjemplo.length) {
      return `Completá un ejemplo para ${sinEjemplo.map((v) => `{{${v.index}}}`).join(', ')}: META lo usa para revisar.`;
    }
    return null;
  }

  if (nombre === 'Extras') {
    if (form.headerType === 'TEXT' && !form.headerContent.trim()) {
      return 'Escribí el texto del encabezado o elegí "Sin encabezado".';
    }
    const sinEjemplo = variablesSinEjemplo(form.variables.filter((v) => v.target === 'header'));
    if (sinEjemplo.length) {
      return 'Completá el ejemplo de la variable del encabezado.';
    }
    return null;
  }

  if (nombre === 'Código' && esAuth) {
    const mins = form.codeExpirationMinutes.trim();
    if (mins !== '') {
      const n = Number(mins);
      if (!Number.isInteger(n) || n < 1 || n > 90) {
        return 'La validez del código debe ser un entero entre 1 y 90 minutos.';
      }
    }
    return null;
  }

  return null;
}
