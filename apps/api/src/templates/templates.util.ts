import {
  isTemplateStatus,
  Template,
  TemplateButton,
  WabaTemplateRow,
} from './templates.types';

/**
 * Normalizacion de las plantillas que publica WABA.
 *
 * Todo lo de este archivo es puro: no toca red ni base, y por eso se puede fijar en
 * tests. Lo que resuelve es que WABA guarda varias cosas como **JSON dentro de una
 * columna de texto** (`ButtonsJson`, `VariablesJson`), y ese texto puede venir vacio,
 * nulo o mal formado. Un `JSON.parse` suelto tumbaria la pantalla entera por una fila
 * con un dato viejo.
 */

/** Texto recortado, o `null` si queda vacio. */
function text(value: string | null | undefined): string | null {
  const t = (value ?? '').trim();
  return t === '' ? null : t;
}

/**
 * `JSON.parse` que nunca tira.
 *
 * Devuelve `null` ante cualquier problema: columna vacia, `"null"`, JSON invalido. El
 * llamador decide el default.
 */
export function parseJsonSafe<T>(raw: string | null | undefined): T | null {
  const t = (raw ?? '').trim();
  if (t === '' || t === 'null') return null;
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

/** Botones de la plantilla. Siempre un array: una plantilla sin botones es lo normal. */
export function parseButtons(raw: string | null | undefined): TemplateButton[] {
  const parsed = parseJsonSafe<unknown>(raw);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
    .map((b) => ({
      type: text(b.type as string),
      text: text((b.text ?? b.title) as string),
      url: text(b.url as string),
      // META lo llama `phone_number`; se expone en camelCase como el resto del DTO.
      phoneNumber: text((b.phone_number ?? b.phoneNumber) as string),
    }));
}

/**
 * Variables del cuerpo: `{{1}}`, `{{nombre}}`.
 *
 * Se usa `VariablesJson` cuando WABA lo tiene cargado; si viene vacio o roto, se deducen
 * del propio texto. El fallback importa porque las plantillas viejas —las que se
 * sincronizaron de META antes de que WABA guardara esa columna— no lo traen, y sin
 * variables la pantalla daria a entender que se pueden enviar tal cual.
 */
export function parseVariables(
  rawVariables: string | null | undefined,
  bodyText: string | null | undefined,
): string[] {
  const parsed = parseJsonSafe<unknown>(rawVariables);

  if (Array.isArray(parsed)) {
    const desdeJson = parsed
      .map((v) => (typeof v === 'string' ? v : (v as { name?: string })?.name))
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .map((v) => v.trim());
    if (desdeJson.length) return dedupe(desdeJson);
  }

  return extractPlaceholders(bodyText);
}

/** Los `{{...}}` del texto, en orden de aparicion y sin repetir. */
export function extractPlaceholders(bodyText: string | null | undefined): string[] {
  const body = bodyText ?? '';
  const found = [...body.matchAll(/\{\{\s*([^}\s][^}]*?)\s*\}\}/g)].map((m) => m[1].trim());
  return dedupe(found.filter((v) => v !== ''));
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

/** Fila de WABA -> DTO de la UI. `null` si la fila no tiene nombre: no es una plantilla. */
export function mapTemplate(row: WabaTemplateRow): Template | null {
  const name = text(row.Name);
  if (!name) return null;

  const status = text(row.Status)?.toUpperCase() ?? null;

  return {
    id: row.Id ?? null,
    name,
    language: text(row.Language),
    category: text(row.Category)?.toUpperCase() ?? null,
    // Un estado que META agregue y todavia no este en la lista se deja pasar como null
    // en vez de inventarlo: la UI lo muestra como "sin estado".
    status: status && isTemplateStatus(status) ? status : null,
    headerType: text(row.HeaderType)?.toUpperCase() ?? null,
    headerContent: text(row.HeaderContent),
    bodyText: text(row.BodyText),
    footerText: text(row.FooterText),
    buttons: parseButtons(row.ButtonsJson),
    variables: parseVariables(row.VariablesJson, row.BodyText),
  };
}

/** Cuantas plantillas hay por estado. Las que no tienen estado van a `SIN_ESTADO`. */
export function summarizeByStatus(templates: Template[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of templates) {
    const key = t.status ?? 'SIN_ESTADO';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
