import { Template, TemplateStatus } from './plantillas.types';

/** Un tono por estado: ninguno se confunde con otro en la lista. */
export type StatusTone =
  | 'ok'
  | 'review'
  | 'draft'
  | 'rejected'
  | 'paused'
  | 'disabled'
  | 'neutral';

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

/**
 * Tono visual del estado. **Uno distinto por estado**: si dos comparten color, la
 * columna deja de responder de un vistazo la unica pregunta que importa —si la
 * plantilla se puede usar, si hay que esperar, o si hay algo que corregir.
 */
export function statusTone(status: TemplateStatus | null): StatusTone {
  switch (status) {
    case 'APPROVED':
      return 'ok';
    case 'PENDING':
      return 'review';
    case 'DRAFT':
      return 'draft';
    case 'REJECTED':
      return 'rejected';
    case 'PAUSED':
      return 'paused';
    case 'DISABLED':
      return 'disabled';
    default:
      return 'neutral';
  }
}

/**
 * Si la plantilla se puede editar, mirando solo el estado.
 *
 * Espeja `templateEditPolicy.js` de WABA (`EDITABLE_STATUSES` / `IN_REVIEW_STATUSES`) y
 * sirve para **no ofrecer** un boton que va a fallar. No decide: la autoridad es la
 * politica que devuelve el detalle, que ademas sabe del cupo y del identificador de META.
 */
export function editableSegunEstado(status: TemplateStatus | null): boolean {
  return status === 'APPROVED' || status === 'REJECTED' || status === 'PAUSED'
    || status === 'DISABLED' || status === 'DRAFT';
}

/** Por que no se ofrece editar. Va en el `title` del boton apagado. */
export function motivoNoEditable(status: TemplateStatus | null): string {
  if (status === 'PENDING') {
    return 'META está revisando esta plantilla. Hasta que termine no acepta cambios.';
  }
  return 'META no permite editar una plantilla en este estado.';
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
 * Cuantos datos variables tiene la plantilla.
 *
 * Dice **cuantos hay**, no que falte algo: decia "a completar" y se leia como que la
 * plantilla estaba incompleta. Los ejemplos ya se cargaron al crearla; lo que se
 * completa es el valor real, y eso pasa al enviar cada mensaje, no aca.
 */
export function variablesLabel(template: Template): string {
  const n = template.variables.length;
  if (n === 0) return 'Sin variables';
  if (n === 1) return '1 variable';
  return `${n} variables`;
}

/** Texto del botón para la lista. */
export function buttonLabel(button: Template['buttons'][number]): string {
  const texto = button.text ?? 'Sin texto';
  if (button.url) return `${texto} → ${button.url}`;
  if (button.phoneNumber) return `${texto} → ${button.phoneNumber}`;
  return texto;
}

/**
 * La fecha, corta y legible.
 *
 * La lista viene ordenada por esta columna, así que tiene que poder compararse de un
 * vistazo. El ISO completo va en el `title` para quien necesite la hora exacta.
 *
 * Las plantillas viejas —las que WABA sincronizó de META antes de guardar la columna— no
 * tienen fecha. Se muestra un guion en vez de inventar una.
 */
export function fechaCorta(iso: string | null): string {
  if (!iso) return '—';

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';

  return d.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
