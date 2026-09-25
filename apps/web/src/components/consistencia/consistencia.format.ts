import { Category, GapType, Resolution, Severity } from './consistencia.types';

/** Pestañas de hallazgos, en el orden en que se muestran. */
export const CATEGORY_TABS: { key: Category; label: string }[] = [
  { key: 'JERARQUIA', label: 'Jerarquía comercial' },
  { key: 'CARTERA', label: 'Carteras' },
  { key: 'USUARIOS_SAP', label: 'Usuarios vs SAP' },
];

/** Nombre del archivo exportado por categoría: legible, sin claves internas. */
export const CATEGORY_FILE: Record<Category, string> = {
  JERARQUIA: 'jerarquia',
  CARTERA: 'carteras',
  USUARIOS_SAP: 'usuarios-sap',
};

export const RESOLUTION_LABEL: Record<Resolution, string> = {
  BACKOFFICE: 'Se corrige acá',
  ITMANAGER: 'Resolver en ITManager',
  REVISAR: 'Revisar',
};

export const RESOLUTION_OPTIONS: Resolution[] = ['BACKOFFICE', 'ITMANAGER', 'REVISAR'];

export const SEVERITY_LABEL: Record<Severity, string> = {
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
};

export const GAP_LABEL: Record<GapType, string> = {
  CLIENTE_NO_SINCRONIZADO: 'Cliente asignado por SAP que no está en el maestro de clientes',
  VE_SIN_CARTERA: 'Cliente que SAP asigna al vendedor y no está en su cartera',
  SIN_AREA_DE_VENTA: 'Cliente de cartera sin área de venta en la sociedad',
  CARTERA_SIN_VE: 'Cliente de cartera que SAP no asigna a ese vendedor',
};

/** De dónde sale el usuario SAP sugerido, dicho para quien corrige. */
const SUGGESTION_SOURCE_LABEL: Record<string, string> = {
  CARTERA: 'es el de su cartera',
  USUARIO: 'es el de su usuario de Mobility',
  GUID_USERS: 'es el del usuario de Mobility vinculado al miembro',
  NOMBRE: 'es el de un usuario de Mobility con el mismo nombre; confirmalo antes de usarlo',
  PORTFOLIOS_OWNER: 'es el que figura en la ficha de la cartera',
};

export function suggestionSourceLabel(source: string): string {
  return SUGGESTION_SOURCE_LABEL[source] ?? 'sugerido por el cruce de datos';
}

/** Largo máximo de un usuario SAP: el mismo tope que valida el servidor. */
export const SAP_USER_MAX = 20;

export const GAP_TYPES: GapType[] = [
  'CLIENTE_NO_SINCRONIZADO',
  'VE_SIN_CARTERA',
  'SIN_AREA_DE_VENTA',
  'CARTERA_SIN_VE',
];

/** Prefijos técnicos de los roles de Mobility que no le dicen nada a quien lee. */
const ROLE_PREFIXES = ['MOBILITY_2.0IA_WEB_', 'MOBILITYMGR_'];

/** `MOBILITYMGR_GERENTE_COMERCIAL` → `Gerente comercial`. */
export function humanizeRole(role: string): string {
  let clean = role.trim();
  for (const prefix of ROLE_PREFIXES) {
    if (clean.toUpperCase().startsWith(prefix)) {
      clean = clean.slice(prefix.length);
      break;
    }
  }
  clean = clean.replace(/_/g, ' ').trim();
  if (!clean) return role;
  const lower = clean.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** "hace 5 minutos", a partir de un timestamp en milisegundos. */
export function formatAgo(timestamp: number | null | undefined, now: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '—';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'hace instantes';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? 'hace 1 minuto' : `hace ${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'hace 1 hora' : `hace ${hours} horas`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}

/** Fecha local `aaaa-mm-dd` para el nombre del archivo. */
export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Filas que entran en el viewport, con el mismo criterio que las demás bandejas: no
 * hace falta que sea exacto, sólo evita pedir 50 filas en una pantalla que muestra 12.
 */
export function pageSizeForViewport(rowHeight = 56, chromeHeight = 560): number {
  const rows = Math.floor((window.innerHeight - chromeHeight) / rowHeight);
  return Math.min(100, Math.max(10, rows));
}

// ---- CSV ------------------------------------------------------------------

/**
 * Separador `;`: es el que Excel en castellano abre directo en columnas. Con `,` todo
 * queda en la columna A.
 */
export const CSV_SEPARATOR = ';';

/**
 * Una celda del CSV. Se escapan comillas y, además, se neutraliza lo que Excel
 * interpretaría como fórmula (`=`, `+`, `-`, `@`): los datos vienen de SAP y de la
 * base, no de acá, y una celda así ejecutaría al abrir el archivo.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = Array.isArray(value) ? value.join(', ') : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/["\r\n]/.test(text) || text.includes(CSV_SEPARATOR)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/** Marca de orden de bytes UTF-8: sin ella Excel abre el archivo como ANSI. */
export const BOM = String.fromCharCode(0xfeff);

/** CSV completo con BOM (para que Excel lea bien los acentos) y fin de línea CRLF. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [
    columns.map((c) => csvCell(c.header)).join(CSV_SEPARATOR),
    ...rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(CSV_SEPARATOR)),
  ];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** Descarga el texto como archivo en el navegador. */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ---- Validación de formularios --------------------------------------------

export const REASON_MIN = 5;
export const REASON_MAX = 500;

/** Mensaje de error del motivo, o `null` si es válido. */
export function reasonError(reason: string): string | null {
  const len = reason.trim().length;
  if (len === 0) return 'Escribí el motivo de la corrección.';
  if (len < REASON_MIN) return `El motivo debe tener al menos ${REASON_MIN} caracteres.`;
  if (len > REASON_MAX) return `El motivo no puede superar los ${REASON_MAX} caracteres.`;
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}
