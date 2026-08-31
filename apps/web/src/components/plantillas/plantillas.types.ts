/** Espejo de `apps/api/src/templates/templates.types.ts`. */

export type TemplateStatus =
  | 'APPROVED'
  | 'PENDING'
  | 'REJECTED'
  | 'PAUSED'
  | 'DISABLED'
  | 'DRAFT';

export interface TemplateButton {
  type: string | null;
  text: string | null;
  url: string | null;
  phoneNumber: string | null;
}

export interface Template {
  id: number | null;
  name: string;
  language: string | null;
  category: string | null;
  status: TemplateStatus | null;
  headerType: string | null;
  headerContent: string | null;
  bodyText: string | null;
  footerText: string | null;
  buttons: TemplateButton[];
  /** Variables del cuerpo (`{{1}}`). Sin completarlas, la plantilla no se puede enviar. */
  variables: string[];
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type StatusSummary = Record<string, number>;

export interface TemplatesPage {
  data: Template[];
  pagination: Pagination;
  summary: StatusSummary;
  /** `true` = la fuente solo devolvió aprobadas; hay estados que no estamos viendo. */
  onlyApproved: boolean;
}

export type SortableField = 'name' | 'language' | 'category' | 'status';

export interface TemplatesQuery {
  page: number;
  limit: number;
  search: string;
  sortBy: SortableField;
  sortDir: 'ASC' | 'DESC';
  status: TemplateStatus | null;
}

/**
 * Si META permite editar la plantilla ahora mismo.
 *
 * Las reglas las decide META, las evalua WABA (`templateEditPolicy.js`) y el API las
 * traduce. La pantalla solo las muestra: no vuelve a decidir.
 *
 * Los numeros del cupo (10 ediciones cada 30 dias, 1 por dia) **no estan en la
 * documentacion de META** — WABA los toma de terceros que integran la misma API. Por
 * eso se avisan y nunca bloquean: la ultima palabra la tiene META.
 */
export interface EditPolicy {
  canEdit: boolean;
  /** Motivo cuando `canEdit` es `false`. Ya viene en castellano. */
  reason: string | null;
  /** `false` en un borrador: no vive en META. */
  requiresMeta: boolean;
  /** Si aplica el cupo de ediciones (solo las aprobadas). */
  limited: boolean;
  /** Ediciones usadas en los ultimos 30 dias. */
  used: number;
  /** Ediciones restantes, o `null` si no hay limite. */
  remaining: number | null;
  /** ISO hasta cuando dura la espera entre ediciones, o `null`. */
  cooldownUntil: string | null;
  /** Avisos que no bloquean. Ya vienen en castellano. */
  warnings: string[];
}
export interface TemplateDetail {
  template: Template;
  editPolicy: EditPolicy | null;
}

/**
 * Estado del formulario.
 *
 * Todo string (incluida la expiración del OTP) porque es lo que devuelven los inputs;
 * la conversión a número se hace al enviar, en un solo lugar.
 */
/**
 * Un dato variable del mensaje.
 *
 * META **exige un ejemplo** por cada variable: es lo que mira el revisor para entender
 * qué va a ir ahí. Sin ejemplos, rechaza. El `label` es solo para quien arma la
 * plantilla — no viaja a META, pero hace legible el formulario cuando hay varias.
 */
export interface TemplateVariable {
  /** Número de la variable: el `1` de `{{1}}`. */
  index: number;
  /** Dónde aparece. El encabezado admite una sola. */
  target: 'body' | 'header';
  /** Nombre para reconocerla (ej. "nombre del cliente"). No va a META. */
  label: string;
  /** Valor de ejemplo. **META lo usa para revisar.** */
  example: string;
}

export interface TemplateFormState {
  /**
   * Título para reconocerla en la lista. No va a META: de acá sale el nombre técnico.
   */
  friendlyTitle: string;
  name: string;
  language: string;
  category: string;
  headerType: string;
  headerContent: string;
  /**
   * Handle del archivo de ejemplo del encabezado multimedia.
   *
   * META exige ver el medio para revisar la plantilla. Lo devuelve la subida; el
   * archivo en si no vuelve a viajar.
   */
  headerHandle: string;
  /** Nombre del archivo subido. Solo para mostrarlo: no va a META. */
  headerFileName: string;
  bodyText: string;
  footerText: string;
  buttons: TemplateButton[];
  // Solo AUTHENTICATION: META escribe el texto y solo se configuran estas opciones.
  addSecurityRecommendation: boolean;
  codeExpirationMinutes: string;
  otpType: string;
  /** Nombre y ejemplo de cada `{{n}}` del mensaje. */
  variables: TemplateVariable[];
}

/** Lo que se manda al crear. */
export interface CreateTemplatePayload {
  name: string;
  language: string;
  category: string;
  headerType?: string;
  headerContent?: string | null;
  headerHandle?: string | null;
  bodyText?: string;
  footerText?: string | null;
  buttons?: TemplateButton[];
  addSecurityRecommendation?: boolean;
  codeExpirationMinutes?: number | null;
  otpType?: string;
  variables?: TemplateVariable[];
}

/** Lo que se manda al editar. Sin `name` ni `language`: META no los deja cambiar. */
export type UpdateTemplatePayload = Omit<CreateTemplatePayload, 'name' | 'language'>;
