import { TemplateButton, TemplateFormState } from './plantillas.types';

/**
 * Validación local del formulario, antes de mandar.
 *
 * NO reemplaza la de WABA — que es la autoridad y usa el mismo validador que su
 * asistente. Existe para avisar en el momento: **un rechazo de META cuesta horas o días
 * de revisión**, y llegar hasta allá con un texto de más o una variable salteada es
 * tiempo perdido que se puede evitar mientras se escribe.
 *
 * Los límites salen de `templateValidator.js` de WABA.
 */

export const LIMITS = {
  NAME_MAX: 512,
  HEADER_TEXT_MAX: 60,
  BODY_MAX: 1024,
  FOOTER_MAX: 60,
  BUTTON_TEXT_MAX: 25,
  BUTTON_URL_MAX: 2000,
  BUTTON_PHONE_MAX: 20,
  MAX_QUICK_REPLY: 3,
  MAX_URL_BUTTONS: 2,
  MAX_PHONE_BUTTONS: 1,
  OTP_MIN: 1,
  OTP_MAX: 90,
} as const;

const NAME_PATTERN = /^[a-z0-9_]+$/;

/** Números de variable de un texto, ordenados y sin repetir: `{{1}} {{3}}` → `[1, 3]`. */
export function variableNumbers(text: string): number[] {
  const found: number[] = [];
  for (const m of (text ?? '').matchAll(/\{\{(\d+)\}\}/g)) {
    const n = parseInt(m[1], 10);
    if (!found.includes(n)) found.push(n);
  }
  return found.sort((a, b) => a - b);
}

/**
 * Las variables tienen que ser `{{1}}, {{2}}, {{3}}…` sin saltos.
 *
 * META rechaza `{{1}} {{3}}`: numera los ejemplos por posición y un salto le deja un
 * hueco. Es de los rechazos más comunes y más fáciles de evitar.
 */
function checkSequential(text: string, campo: string): string | null {
  const vars = variableNumbers(text);
  if (vars.length === 0) return null;

  for (let i = 0; i < vars.length; i++) {
    if (vars[i] !== i + 1) {
      return `Las variables de${campo} deben ir en orden y sin saltos: {{1}}, {{2}}, {{3}}… (encontradas: ${vars.map((v) => `{{${v}}}`).join(', ')})`;
    }
  }
  return null;
}

function countByType(buttons: TemplateButton[], type: string): number {
  return buttons.filter((b) => b.type === type).length;
}

/**
 * Errores del formulario. Vacío = se puede mandar.
 *
 * Devuelve mensajes para leer, no códigos: el que los ve es quien escribe la plantilla.
 */
export function validateForm(form: TemplateFormState, esEdicion: boolean): string[] {
  const errores: string[] = [];
  const esAuth = form.category === 'AUTHENTICATION';

  // ---- Identidad (solo al crear: META no la deja cambiar) ----
  if (!esEdicion) {
    const name = form.name.trim();
    if (!name) errores.push('El nombre es obligatorio.');
    else if (!NAME_PATTERN.test(name)) {
      errores.push(
        'El nombre solo admite minúsculas, números y guión bajo. Sin espacios, tildes ni mayúsculas.',
      );
    } else if (name.length > LIMITS.NAME_MAX) {
      errores.push(`El nombre no puede superar los ${LIMITS.NAME_MAX} caracteres.`);
    }

    if (!form.language.trim()) errores.push('El idioma es obligatorio.');
  }

  if (!form.category) errores.push('La categoría es obligatoria.');

  // ---- AUTHENTICATION: META escribe el texto ----
  if (esAuth) {
    const mins = form.codeExpirationMinutes;
    if (mins !== '' && mins !== null) {
      const n = Number(mins);
      if (!Number.isInteger(n) || n < LIMITS.OTP_MIN || n > LIMITS.OTP_MAX) {
        errores.push(
          `La validez del código debe ser un número entero entre ${LIMITS.OTP_MIN} y ${LIMITS.OTP_MAX} minutos.`,
        );
      }
    }
    return errores;
  }

  // ---- Cuerpo ----
  const body = form.bodyText.trim();
  if (!body) errores.push('El mensaje es obligatorio.');
  else if (body.length > LIMITS.BODY_MAX) {
    errores.push(`El mensaje no puede superar los ${LIMITS.BODY_MAX} caracteres.`);
  }
  const bodySeq = checkSequential(form.bodyText, 'l mensaje');
  if (bodySeq) errores.push(bodySeq);

  // ---- Encabezado ----
  if (form.headerType === 'TEXT') {
    const header = form.headerContent.trim();
    if (!header) errores.push('Elegiste encabezado de texto: escribí el texto o quitá el encabezado.');
    else if (header.length > LIMITS.HEADER_TEXT_MAX) {
      errores.push(`El encabezado no puede superar los ${LIMITS.HEADER_TEXT_MAX} caracteres.`);
    }
    // META admite UNA sola variable en el encabezado.
    if (variableNumbers(form.headerContent).length > 1) {
      errores.push('El encabezado admite una sola variable.');
    }
  }

  // ---- Pie ----
  if (form.footerText.trim().length > LIMITS.FOOTER_MAX) {
    errores.push(`El pie no puede superar los ${LIMITS.FOOTER_MAX} caracteres.`);
  }
  if (variableNumbers(form.footerText).length > 0) {
    errores.push('El pie no admite variables.');
  }

  // ---- Botones ----
  const quick = countByType(form.buttons, 'QUICK_REPLY');
  const url = countByType(form.buttons, 'URL');
  const phone = countByType(form.buttons, 'PHONE_NUMBER');

  if (quick > LIMITS.MAX_QUICK_REPLY) {
    errores.push(`Como máximo ${LIMITS.MAX_QUICK_REPLY} botones de respuesta rápida.`);
  }
  if (url > LIMITS.MAX_URL_BUTTONS) {
    errores.push(`Como máximo ${LIMITS.MAX_URL_BUTTONS} botones de enlace.`);
  }
  if (phone > LIMITS.MAX_PHONE_BUTTONS) {
    errores.push(`Como máximo ${LIMITS.MAX_PHONE_BUTTONS} botón de llamada.`);
  }

  form.buttons.forEach((b, i) => {
    const n = i + 1;
    if (!b.text || !b.text.trim()) errores.push(`El botón ${n} necesita un texto.`);
    else if (b.text.length > LIMITS.BUTTON_TEXT_MAX) {
      errores.push(`El texto del botón ${n} no puede superar los ${LIMITS.BUTTON_TEXT_MAX} caracteres.`);
    }

    if (b.type === 'URL') {
      if (!b.url || !b.url.trim()) errores.push(`El botón ${n} necesita un enlace.`);
      else if (b.url.length > LIMITS.BUTTON_URL_MAX) {
        errores.push(`El enlace del botón ${n} es demasiado largo.`);
      }
    }

    if (b.type === 'PHONE_NUMBER') {
      if (!b.phoneNumber || !b.phoneNumber.trim()) {
        errores.push(`El botón ${n} necesita un número de teléfono.`);
      } else if (b.phoneNumber.length > LIMITS.BUTTON_PHONE_MAX) {
        errores.push(`El teléfono del botón ${n} es demasiado largo.`);
      }
    }
  });

  return errores;
}
