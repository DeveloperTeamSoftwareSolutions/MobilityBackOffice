import { Template, TemplateStatus } from './plantillas.types';

/** Cómo se lee una plantilla en pantalla. Una sola redacción para toda la sección. */

/** Etiqueta del estado de aprobación de META. */
export function statusLabel(status: TemplateStatus | null): string {
  switch (status) {
    case 'APPROVED':
      return 'Aprobada';
    case 'PENDING':
      return 'En revisión';
    case 'REJECTED':
      return 'Rechazada';
    case 'PAUSED':
      return 'Pausada';
    case 'DISABLED':
      return 'Deshabilitada';
    case 'DRAFT':
      return 'Borrador';
    default:
      return 'Sin estado';
  }
}

/**
 * Qué significa el estado para quien lo lee.
 *
 * El estado lo decide META, no la empresa: una plantilla se envía a aprobación y se
 * espera. Sin esta aclaración, "En revisión" parece algo que se puede destrabar desde acá.
 */
export function statusHint(status: TemplateStatus | null): string | null {
  switch (status) {
    case 'APPROVED':
      return 'Se puede enviar';
    case 'PENDING':
      return 'META todavía no la revisó';
    case 'REJECTED':
      return 'META la rechazó: no se puede enviar';
    case 'PAUSED':
      return 'Pausada por baja calidad; no se puede enviar';
    case 'DISABLED':
      return 'Deshabilitada por META';
    case 'DRAFT':
      return 'Todavía no se envió a aprobación';
    default:
      return null;
  }
}

/** Tono visual del estado. Separa lo que se puede usar de lo que no. */
export function statusTone(status: TemplateStatus | null): 'ok' | 'warn' | 'bad' | 'neutral' {
  switch (status) {
    case 'APPROVED':
      return 'ok';
    case 'PENDING':
    case 'DRAFT':
      return 'warn';
    case 'REJECTED':
    case 'PAUSED':
    case 'DISABLED':
      return 'bad';
    default:
      return 'neutral';
  }
}

/** Categoría de META, en castellano. */
export function categoryLabel(category: string | null): string {
  switch (category) {
    case 'MARKETING':
      return 'Marketing';
    case 'UTILITY':
      return 'Utilidad';
    case 'AUTHENTICATION':
      return 'Autenticación';
    default:
      return category ?? 'Sin categoría';
  }
}

/** `es_MX` → `Español (MX)`. Si no se reconoce, se muestra el código tal cual. */
export function languageLabel(language: string | null): string {
  if (!language) return 'Sin idioma';

  const [lang, region] = language.split('_');
  const nombres: Record<string, string> = {
    es: 'Español',
    en: 'Inglés',
    pt: 'Portugués',
  };
  const base = nombres[lang.toLowerCase()];
  if (!base) return language;
  return region ? `${base} (${region.toUpperCase()})` : base;
}

/** Tipo de encabezado. `NONE` y vacío se tratan igual: no hay encabezado. */
export function headerLabel(headerType: string | null): string | null {
  if (!headerType || headerType === 'NONE') return null;
  switch (headerType) {
    case 'TEXT':
      return 'Texto';
    case 'IMAGE':
      return 'Imagen';
    case 'VIDEO':
      return 'Video';
    case 'DOCUMENT':
      return 'Documento';
    case 'LOCATION':
      return 'Ubicación';
    default:
      return headerType;
  }
}

/**
 * Resumen de las variables.
 *
 * Importa porque una plantilla con variables **no se puede enviar sin completarlas**, y
 * eso no se ve mirando el cuerpo de reojo.
 */
export function variablesLabel(template: Template): string {
  const n = template.variables.length;
  if (n === 0) return 'Sin variables';
  if (n === 1) return '1 variable a completar';
  return `${n} variables a completar`;
}

/** Texto del botón para la lista. */
export function buttonLabel(button: Template['buttons'][number]): string {
  const texto = button.text ?? 'Sin texto';
  if (button.url) return `${texto} → ${button.url}`;
  if (button.phoneNumber) return `${texto} → ${button.phoneNumber}`;
  return texto;
}
