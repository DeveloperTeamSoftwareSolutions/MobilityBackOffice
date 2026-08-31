/**
 * Tipos de las plantillas de WhatsApp.
 *
 * Las plantillas viven en el panel WABA (`WhatsAppApiCloud-META-WABA`), tabla
 * `MessageTemplates`. BackOffice las consume por HTTP contra su API REST — mismo criterio
 * que MobilityManager con las conversaciones: se consumen los DATOS, no la pantalla.
 * Ver `docs/SPEC_PLANTILLAS_WHATSAPP.md`.
 */

/**
 * Estado de aprobacion en META.
 *
 * Una plantilla no se "guarda": se **envia a META para aprobacion**, y META decide. Por
 * eso el estado no lo controla ni WABA ni BackOffice.
 */
export const TEMPLATE_STATUSES = [
  'APPROVED',
  'PENDING',
  'REJECTED',
  'PAUSED',
  'DISABLED',
  'DRAFT',
] as const;

export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export function isTemplateStatus(value: string): value is TemplateStatus {
  return (TEMPLATE_STATUSES as readonly string[]).includes(value);
}

/** Categoria de META. Define las reglas que aplica al aprobar. */
export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | string;

/** Boton de una plantilla, tal como lo guarda WABA en `ButtonsJson`. */
export interface TemplateButton {
  type: string | null;
  text: string | null;
  url: string | null;
  phoneNumber: string | null;
}

/** Fila cruda tal como la publica la API de WABA. */
export interface WabaTemplateRow {
  Id?: number | null;
  Name?: string | null;
  Language?: string | null;
  Category?: string | null;
  Status?: string | null;
  HeaderType?: string | null;
  HeaderContent?: string | null;
  BodyText?: string | null;
  FooterText?: string | null;
  ButtonsJson?: string | null;
  ComponentsJson?: string | null;
  VariablesJson?: string | null;
  /** Cuando se creo en WABA. ISO. */
  CreatedAt?: string | null;
}

/** Plantilla ya normalizada para la UI. */
export interface Template {
  id: number | null;
  name: string;
  language: string | null;
  category: TemplateCategory | null;
  status: TemplateStatus | null;
  headerType: string | null;
  headerContent: string | null;
  bodyText: string | null;
  footerText: string | null;
  buttons: TemplateButton[];
  /** Cuando se creo, en ISO. `null` en las viejas que WABA sincronizo de META. */
  createdAt: string | null;
  /**
   * Nombres de las variables del cuerpo (`{{1}}`, `{{nombre}}`).
   *
   * Salen de `VariablesJson` cuando WABA las tiene cargadas; si no, se deducen del
   * propio `BodyText`. Importan porque una plantilla con variables no se puede enviar
   * sin completarlas.
   */
  variables: string[];
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Cuantas plantillas hay en cada estado. Es el encabezado de la pantalla. */
export type StatusSummary = Record<string, number>;

export interface TemplatesPage {
  data: Template[];
  pagination: Pagination;
  summary: StatusSummary;
  /**
   * `true` cuando la fuente solo devuelve las aprobadas.
   *
   * Hoy la API de WABA expone `findAllApproved` (`WHERE Status = 'APPROVED'`), asi que
   * las PENDING y REJECTED **no llegan** — justo las que habria que atender. La UI lo
   * avisa en vez de dar a entender que no existen.
   */
  onlyApproved: boolean;
}

/**
 * Lo que devuelve WABA en `editPolicy` (`services/templateEditPolicy.js`).
 *
 * Se declara tal cual viaja —con `allowed`, no `canEdit`, y con claves i18n en `reason`
 * y `warnings`— para que el mapeo sea explicito. Suponer otra forma es lo que hacia que
 * la pantalla **nunca** bloqueara: leia un `canEdit` que no existe, daba `undefined`, y
 * `undefined === false` es falso.
 */
export interface WabaEditPolicy {
  allowed?: boolean;
  /** Clave i18n del motivo cuando no se puede. Ej. `templates.edit.blockedInReview`. */
  reason?: string | null;
  /** `false` en un borrador: no vive en META, se edita sin llamarla. */
  requiresMeta?: boolean;
  /** Solo las APROBADAS tienen cupo. Rechazadas y pausadas son ilimitadas. */
  limited?: boolean;
  /** Ediciones en los ultimos 30 dias. */
  used?: number;
  /** Ediciones restantes, o `null` si no hay limite. */
  remaining?: number | null;
  /** ISO hasta cuando dura la espera de 24 h entre ediciones. */
  cooldownUntil?: string | null;
  /** Claves i18n de avisos que NO bloquean. */
  warnings?: string[];
}

/**
 * La politica de edicion, ya legible.
 *
 * Las reglas las decide META y las evalua WABA; aca solo se traducen sus claves i18n a
 * texto, porque la pantalla no tiene por que conocer ese vocabulario.
 *
 * Los numeros de limite (10 ediciones cada 30 dias, 1 por dia) **no estan en la
 * documentacion de META**: WABA los toma de terceros que integran la misma API. Por eso
 * viajan como aviso y nunca como bloqueo — la ultima palabra la tiene META.
 */
export interface EditPolicy {
  canEdit: boolean;
  /** Motivo cuando `canEdit` es `false`, ya en castellano. */
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
  /** Avisos que no bloquean, ya en castellano. */
  warnings: string[];
}


/**
 * Lo que devuelve WABA en `GET /api/templates/drafts/:id`.
 *
 * Es **mas** que el detalle de la plantilla: trae el titulo amigable, el handle del
 * archivo y las variables **con su nombre y su ejemplo**. Ese detalle es el que reabre un
 * borrador donde quedo, en vez de con los campos a medias.
 *
 * OJO: WABA completa `otpType`, `expirationEnabled`, `codeExpirationMinutes` y
 * `addSecurityRecommendation` con valores por defecto **aunque la plantilla no sea de
 * autenticacion**. Aplicarlos sin mirar la categoria le prende opciones a un borrador de
 * marketing que nunca las tuvo.
 */
export interface WabaDraftRow {
  id?: number;
  name?: string | null;
  language?: string | null;
  category?: string | null;
  headerType?: string | null;
  headerContent?: string | null;
  /** Handle del archivo de ejemplo, ya subido a META. */
  headerHandle?: string | null;
  bodyText?: string | null;
  footerText?: string | null;
  /** JSON dentro de una columna de texto, como el resto de las colecciones de WABA. */
  buttonsJson?: string | null;
  variables?: unknown;
  friendlyTitle?: string | null;
  otpType?: string | null;
  expirationEnabled?: boolean;
  codeExpirationMinutes?: number | null;
  addSecurityRecommendation?: boolean;
}

/** El borrador, listo para rehidratar el formulario. */
export interface TemplateDraft {
  id: number | null;
  name: string;
  language: string;
  category: string;
  headerType: string;
  headerContent: string | null;
  headerHandle: string | null;
  bodyText: string | null;
  footerText: string | null;
  buttons: TemplateButton[];
  variables: TemplateVariable[];
  friendlyTitle: string;
  otpType: string;
  /** `null` = el codigo no vence. Solo aplica a AUTHENTICATION. */
  codeExpirationMinutes: number | null;
  addSecurityRecommendation: boolean;
}

/** Detalle de una plantilla + si se puede editar. */
export interface TemplateDetail {
  template: Template;
  editPolicy: EditPolicy | null;
}

/**
 * Datos para crear una plantilla.
 *
 * `name` y `language` solo se usan al crear: META los toma como identidad de la
 * plantilla y **no se pueden cambiar despues**.
 *
 * **AUTHENTICATION es otra cosa.** En esa categoria META **escribe el texto** y lo
 * traduce: no se manda `bodyText`, ni encabezado, ni botones normales. Solo se
 * configuran las tres opciones de abajo. Mandar un cuerpo ahi es un rechazo seguro.
 */
/**
 * Un dato variable del mensaje.
 *
 * **META exige un `example` por cada variable**: es lo que mira el revisor para saber
 * que va a ir ahi. Sin ejemplos rechaza la plantilla, y es de los motivos de rechazo
 * mas frecuentes. El `label` no viaja a META — es para quien arma la plantilla.
 */
export interface TemplateVariable {
  index: number;
  target: 'body' | 'header';
  label?: string;
  example: string;
}

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: string;
  headerType?: string | null;
  headerContent?: string | null;
  /** Obligatorio salvo en AUTHENTICATION, donde lo genera META. */
  bodyText?: string;
  footerText?: string | null;
  buttons?: TemplateButton[];
  /** Handle del archivo de ejemplo, cuando el encabezado es multimedia. */
  headerHandle?: string | null;
  /** Titulo para reconocerla. No va a META: solo se guarda en el borrador. */
  friendlyTitle?: string | null;
  /** Nombre y ejemplo de cada `{{n}}`. Sin los ejemplos, META rechaza. */
  variables?: TemplateVariable[];

  // ---- Solo AUTHENTICATION ----
  /** Suma la frase de META que recomienda no compartir el codigo. */
  addSecurityRecommendation?: boolean;
  /** Minutos de validez del codigo (1 a 90). META arma la frase del pie. */
  codeExpirationMinutes?: number | null;
  /**
   * Tipo de boton OTP.
   *
   * Solo `COPY_CODE`: `ONE_TAP` y `ZERO_TAP` exigen el package name y la firma de una
   * app Android, que un administrador de negocio no tiene a mano.
   */
  otpType?: string | null;
}

/** Minutos de expiracion que acepta META para un codigo OTP. */
export const OTP_EXPIRATION_MIN = 1;
export const OTP_EXPIRATION_MAX = 90;

/** Datos para editar. Sin `name` ni `language`: META no los deja cambiar. */
export interface UpdateTemplateInput {
  category?: string | null;
  headerType?: string | null;
  headerContent?: string | null;
  bodyText?: string | null;
  footerText?: string | null;
  buttons?: TemplateButton[];
}

/**
 * Limites y valores que acepta META, replicados de `templateValidator.js` de WABA.
 *
 * Estan aca para poder avisar en el formulario **antes** de mandar: un rechazo de META
 * cuesta horas o dias de revision. La validacion de verdad la sigue haciendo WABA — esto
 * es para no llegar hasta alla con algo que ya se sabe que esta mal.
 */
export const META_LIMITS = {
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
} as const;

/** Solo minusculas, numeros y guion bajo. Es la regla de META, no una preferencia. */
export const NAME_PATTERN = /^[a-z0-9_]+$/;

export const VALID_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;
export const VALID_HEADER_TYPES = ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'] as const;
export const VALID_BUTTON_TYPES = ['QUICK_REPLY', 'URL', 'PHONE_NUMBER'] as const;

export const SORTABLE_FIELDS = ['createdAt', 'name', 'language', 'category', 'status'] as const;
export type SortableField = (typeof SORTABLE_FIELDS)[number];

export function isSortableField(value: string): value is SortableField {
  return (SORTABLE_FIELDS as readonly string[]).includes(value);
}

export interface TemplatesQuery {
  page: number;
  limit: number;
  search: string;
  sortBy: SortableField;
  sortDir: 'ASC' | 'DESC';
  /** `null` = todos los estados. */
  status: TemplateStatus | null;
}
