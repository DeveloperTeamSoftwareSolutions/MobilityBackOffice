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

/** Si META permite editar la plantilla ahora mismo. Lo resuelve WABA. */
export interface EditPolicy {
  canEdit: boolean;
  reason?: string | null;
  warnings?: string[];
  [key: string]: unknown;
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
export interface TemplateFormState {
  name: string;
  language: string;
  category: string;
  headerType: string;
  headerContent: string;
  bodyText: string;
  footerText: string;
  buttons: TemplateButton[];
  // Solo AUTHENTICATION: META escribe el texto y solo se configuran estas opciones.
  addSecurityRecommendation: boolean;
  codeExpirationMinutes: string;
  otpType: string;
}

/** Lo que se manda al crear. */
export interface CreateTemplatePayload {
  name: string;
  language: string;
  category: string;
  headerType?: string;
  headerContent?: string | null;
  bodyText?: string;
  footerText?: string | null;
  buttons?: TemplateButton[];
  addSecurityRecommendation?: boolean;
  codeExpirationMinutes?: number | null;
  otpType?: string;
}

/** Lo que se manda al editar. Sin `name` ni `language`: META no los deja cambiar. */
export type UpdateTemplatePayload = Omit<CreateTemplatePayload, 'name' | 'language'>;
