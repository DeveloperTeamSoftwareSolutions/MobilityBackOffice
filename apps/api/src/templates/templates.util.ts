import {
  EditPolicy,
  isTemplateStatus,
  Template,
  TemplateButton,
  TemplateDraft,
  TemplateVariable,
  WabaDraftRow,
  WabaEditPolicy,
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


/**
 * Las variables de un borrador, con su nombre y su ejemplo.
 *
 * Es lo que distingue reabrir un borrador de reabrir una plantilla: el detalle solo tiene
 * los numeros (`["1"]`), y con eso hay que volver a escribir cada ejemplo. **META los
 * exige**, asi que perderlos convierte "seguir manana" en "empezar de nuevo".
 *
 * Se normaliza fila por fila porque el JSON lo escribio otra aplicacion y puede venir de
 * una version anterior: una fila rota se descarta en vez de tumbar el borrador entero.
 */
function parseDraftVariables(raw: unknown): TemplateVariable[] {
  if (!Array.isArray(raw)) return [];

  const out: TemplateVariable[] = [];
  for (const v of raw) {
    const o = (v ?? {}) as Record<string, unknown>;
    const index = Number(o.index);
    if (!Number.isInteger(index) || index < 1) continue;

    out.push({
      index,
      // El encabezado admite una sola y numera aparte del cuerpo.
      target: o.target === 'header' ? 'header' : 'body',
      label: typeof o.label === 'string' ? o.label : '',
      example: typeof o.example === 'string' ? o.example : '',
    });
  }
  return out;
}

/**
 * El borrador de WABA, listo para rehidratar el formulario.
 *
 * Las opciones del codigo OTP solo se aplican si la plantilla **es** de autenticacion:
 * WABA las completa con valores por defecto en todos los borradores, y copiarlas sin
 * mirar la categoria le prende la advertencia de seguridad y un vencimiento de 10 minutos
 * a un borrador de marketing que nunca los tuvo.
 */
export function mapDraft(row: WabaDraftRow | null | undefined): TemplateDraft | null {
  if (!row) return null;

  const category = (row.category ?? '').trim().toUpperCase() || 'MARKETING';
  const esAuth = category === 'AUTHENTICATION';
  const venceElCodigo = esAuth && row.expirationEnabled !== false;

  return {
    id: Number.isFinite(row.id) ? Number(row.id) : null,
    name: (row.name ?? '').trim(),
    language: (row.language ?? '').trim() || 'es_MX',
    category,
    headerType: (row.headerType ?? '').trim().toUpperCase() || 'NONE',
    headerContent: text(row.headerContent),
    headerHandle: text(row.headerHandle),
    bodyText: text(row.bodyText),
    footerText: text(row.footerText),
    buttons: parseButtons(row.buttonsJson),
    variables: parseDraftVariables(row.variables),
    friendlyTitle: (row.friendlyTitle ?? '').trim(),
    otpType: (row.otpType ?? '').trim() || 'COPY_CODE',
    codeExpirationMinutes:
      venceElCodigo && Number.isFinite(row.codeExpirationMinutes)
        ? Number(row.codeExpirationMinutes)
        : null,
    addSecurityRecommendation: esAuth && row.addSecurityRecommendation === true,
  };
}

/**
 * Textos de la politica de edicion.
 *
 * WABA devuelve **claves i18n** (`templates.edit.blockedInReview`), no frases: su panel
 * las resuelve con su propio diccionario. Se copian de `locales/es.json` para que las
 * dos aplicaciones digan lo mismo — que alguien lea una explicacion distinta segun por
 * donde entro seria peor que no explicar nada.
 */
const TEXTOS_POLITICA: Record<string, string> = {
  'templates.edit.blockedInReview':
    'META está revisando esta plantilla. Hasta que termine la revisión no acepta cambios. Suele tardar hasta 24 horas.',
  'templates.edit.blockedStatus': 'META no permite editar una plantilla en este estado.',
  'templates.edit.blockedNoMetaId':
    'Esta plantilla no tiene identificador de META, así que no se puede editar allá. Sincronizá primero para vincularla.',
  'templates.edit.warnBackToReview':
    'Al guardar, la plantilla vuelve a revisión de META. Mientras tanto podría no estar disponible para enviar.',
  'templates.edit.warnQuotaLow': 'Te quedan pocas ediciones este mes.',
  'templates.edit.warnQuotaExhausted':
    'Según nuestro registro ya usaste las 10 ediciones del mes. Podés intentar igual: la última palabra la tiene META.',
  'templates.edit.warnCooldown':
    'Editaste esta plantilla hace menos de 24 horas. META suele permitir una edición por día.',
};

/** Una clave i18n de WABA a su texto. Si no se reconoce, se devuelve tal cual. */
function texto(clave: string | null | undefined): string | null {
  if (!clave) return null;
  return TEXTOS_POLITICA[clave] ?? clave;
}

/**
 * La politica de edicion de WABA, ya legible.
 *
 * Dos cosas que hay que hacer aca y no mas adelante:
 *
 * 1. **`allowed` no es `canEdit`.** Leer la propiedad equivocada daba `undefined`, y
 *    `undefined === false` es falso: la pantalla dejaba editar una plantilla en revision
 *    y el rechazo aparecia recien al guardar, con el formulario ya completo.
 * 2. **`reason` y `warnings` son claves i18n**, no frases. Mostrarlas sin traducir le
 *    pone al usuario `templates.edit.blockedInReview` en la cara.
 *
 * Sin politica (`null`) se asume que **no** se puede editar: es lo unico honesto cuando
 * no se sabe, y evita el formulario que va a fallar.
 */
export function mapEditPolicy(raw: WabaEditPolicy | null | undefined): EditPolicy {
  const p = raw ?? {};

  return {
    canEdit: p.allowed === true,
    reason: texto(p.reason),
    // Un borrador no vive en META: se edita sin llamarla.
    requiresMeta: p.requiresMeta !== false,
    limited: p.limited === true,
    used: Number.isFinite(p.used) ? Number(p.used) : 0,
    remaining: typeof p.remaining === 'number' ? p.remaining : null,
    cooldownUntil: p.cooldownUntil ?? null,
    warnings: Array.isArray(p.warnings)
      ? p.warnings.map((w) => texto(w)).filter((w): w is string => w !== null)
      : [],
  };
}
