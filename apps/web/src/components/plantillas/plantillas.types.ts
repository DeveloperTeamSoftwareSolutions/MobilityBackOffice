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
