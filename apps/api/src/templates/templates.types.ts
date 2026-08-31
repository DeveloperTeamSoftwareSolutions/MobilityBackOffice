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

export const SORTABLE_FIELDS = ['name', 'language', 'category', 'status'] as const;
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
