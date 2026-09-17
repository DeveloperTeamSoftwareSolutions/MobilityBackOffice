import {
  ItemWarning,
  LineChange,
  LineDraft,
  LineDrafts,
  ReviewCatalogs,
  ReviewItem,
  SalesArea,
  SapErrorLine,
  StockByCenter,
} from './revision-sap.types';

/**
 * El motivo que manda SAP viene como `[E] mensaje`, y con varias líneas unidas por ` | `.
 * Separarlo importa porque el tipo cambia qué hacer: una `E` hay que corregirla, una `W`
 * es un aviso que puede acompañar a un pedido creado.
 */
export function parseSapError(error: string | null): SapErrorLine[] {
  if (!error) return [];
  return error
    .split('|')
    .map((parte) => parte.trim())
    .filter(Boolean)
    .map((parte) => {
      const m = /^\[([^\]]{1,8})\]\s*(.*)$/.exec(parte);
      if (!m) return { type: null, message: parte };
      return { type: m[1].trim().toUpperCase(), message: m[2].trim() || parte };
    });
}

/**
 * Etiquetas de los estados de una orden, con los textos de la tabla `Status`.
 *
 * BackOffice no tenía ninguna: Soporte muestra el código crudo (`SentToSAP`). Se define
 * acá, que es donde hizo falta primero, para que el día que Soporte quiera traducirlos
 * haya un solo lugar. Un código desconocido se muestra tal cual en vez de esconderse:
 * es preferible ver `LoQueSea` a ver un guión.
 */
const ESTADOS: Record<string, string> = {
  Draft: 'Borrador',
  ReadyForApprove: 'Pendiente de aprobación',
  Rejected: 'Rechazada',
  PendingDocumentation: 'Pendiente de documentación',
  Processed: 'Procesada',
  PendingBackofficeReview: 'Pendiente revisión Backoffice',
  SentToSAP: 'Enviado a SAP',
  PendingDispatch: 'Pendiente despacho',
  Dispatched: 'Despachada',
  Invoiced: 'Facturada',
  Annulled: 'Anulada',
};

export function statusLabel(statusCode: string | null): string {
  if (!statusCode) return 'Sin estado';
  return ESTADOS[statusCode] ?? statusCode;
}

/** Tono de la píldora del estado. `ok` sólo para los que ya salieron a SAP. */
export function statusTone(statusCode: string | null): 'ok' | 'warn' | 'danger' | 'muted' {
  switch (statusCode) {
    case 'SentToSAP':
    case 'Dispatched':
    case 'Invoiced':
      return 'ok';
    case 'PendingBackofficeReview':
      return 'danger';
    case 'Rejected':
    case 'Annulled':
      return 'danger';
    case 'Processed':
    case 'PendingDispatch':
    case 'ReadyForApprove':
    case 'PendingDocumentation':
      return 'warn';
    default:
      return 'muted';
  }
}

/**
 * Cómo se resolvió una orden que salió de la bandeja.
 *
 * Con número de pedido salió a SAP; sin número, la revisión se cerró sin enviar. Es lo
 * mismo que distingue el middleware, y no siempre coincide con el estado de hoy: por
 * eso se muestran las dos cosas por separado.
 */
export function resolutionOf(entry: {
  sapOrderNumber: string | null;
  sapDispatchNumber: string | null;
}): { label: string; tone: 'ok' | 'warn' | 'muted'; hint: string | null } {
  if (entry.sapOrderNumber) {
    return entry.sapDispatchNumber
      ? { label: 'Enviada a SAP', tone: 'ok', hint: null }
      : {
          label: 'Sin entrega',
          tone: 'warn',
          hint: 'SAP creó el pedido pero no la entrega: se resuelve en SAP.',
        };
  }
  return { label: 'Cerrada sin enviar', tone: 'muted', hint: null };
}

/** Qué significa cada tipo de SAP, para no mostrar solo una letra suelta. */
export function sapErrorTypeLabel(type: string | null): string | null {
  if (!type) return null;
  const labels: Record<string, string> = {
    E: 'Error',
    A: 'Cancelación',
    W: 'Aviso',
    I: 'Información',
    S: 'Correcto',
  };
  return labels[type] ?? type;
}

export function formatSalesArea(area: SalesArea): string {
  return [area.companyCode, area.channelCode, area.sectorCode]
    .map((code) => code ?? '—')
    .join(' / ');
}

/** Las tres partes del área de venta con su nombre: "2800 · Duwest Cafesa, S.A.". */
export function salesAreaParts(area: SalesArea): { label: string; value: string }[] {
  const part = (code: string | null, name: string | null) =>
    code ? (name ? `${code} · ${name}` : code) : '—';
  return [
    { label: 'Sociedad', value: part(area.companyCode, area.companyName) },
    { label: 'Canal', value: part(area.channelCode, area.channelName) },
    { label: 'Sector', value: part(area.sectorCode, area.sectorName) },
  ];
}

/** Nombres del área en una línea, para mostrar debajo de los códigos. */
export function salesAreaNames(area: SalesArea): string {
  return [area.companyName, area.channelName, area.sectorName].filter(Boolean).join(' · ');
}

export function formatQuantity(quantity: number | null): string {
  if (quantity == null) return '—';
  return quantity.toLocaleString('es-AR', { maximumFractionDigits: 3 });
}

/** Lo de partida: el centro y el destino que la línea tiene guardados. */
export function initialDrafts(items: ReviewItem[]): LineDrafts {
  return Object.fromEntries(
    items.map((item) => [
      item.guid,
      { centerCode: item.centerCode, destinationCode: item.deliveryDestinationCode },
    ]),
  );
}

/** Lo elegido para una línea; si no se tocó, lo guardado. */
export function draftFor(item: ReviewItem, drafts: LineDrafts): LineDraft {
  return (
    drafts[item.guid] ?? {
      centerCode: item.centerCode,
      destinationCode: item.deliveryDestinationCode,
    }
  );
}

/**
 * Cambios pendientes, en el orden de la orden: primero el centro y después el destino
 * de cada línea.
 */
export function lineChanges(items: ReviewItem[], drafts: LineDrafts): LineChange[] {
  return items.flatMap((item) => {
    const draft = draftFor(item, drafts);
    const changes: LineChange[] = [];
    if (draft.centerCode !== item.centerCode) {
      changes.push({ item, field: 'center', before: item.centerCode, after: draft.centerCode });
    }
    if (draft.destinationCode !== item.deliveryDestinationCode) {
      changes.push({
        item,
        field: 'destination',
        before: item.deliveryDestinationCode,
        after: draft.destinationCode,
      });
    }
    return changes;
  });
}

/**
 * Centro con el que sale la línea: el elegido, o si no tiene, el de la cabecera. El
 * middleware va a partir la orden en una orden SAP por cada centro.
 */
export function effectiveCenter(
  centerCode: string | null,
  headerCenterCode: string | null,
): { code: string | null; inherited: boolean } {
  if (centerCode) return { code: centerCode, inherited: false };
  return { code: headerCenterCode, inherited: true };
}

/**
 * Stock de un producto en un centro. `null` si no se sabe: el stock no se consultó,
 * SAP no respondió para ese producto o no hay centro.
 */
export function stockFor(
  stock: StockByCenter | null,
  productCode: string,
  centerCode: string | null,
): number | null {
  if (!stock || !centerCode) return null;
  const byCenter = stock[productCode];
  if (!byCenter) return null;
  return byCenter[centerCode] ?? 0;
}

/**
 * Qué hay que avisar de una línea.
 *
 * Bloquean lo que SAP rechaza seguro y el servidor tampoco acepta: destino vacío o de
 * otra área, y un centro elegido que no está permitido para el cliente (decisión 4a).
 * Avisan sin bloquear: un centro de cabecera no permitido (la línea hereda algo que no
 * eligió BackOffice) y el stock, que SAP revalida (decisión 4b).
 */
export function itemWarnings(
  item: ReviewItem,
  draft: LineDraft,
  headerCenterCode: string | null,
  catalogs: ReviewCatalogs,
): ItemWarning[] {
  const warnings: ItemWarning[] = [];
  const { destinationCode } = draft;

  if (!destinationCode) {
    warnings.push({ kind: 'sin-destino', blocking: true, message: 'Elegí un destino de entrega.' });
  } else if (
    // SIN LISTA NO HAY OPINIÓN. Si los destinos no se pudieron traer —la vista no está
    // en esa base, SAP no respondió, el cliente no tiene ninguno cargado— la lista llega
    // vacía, y entonces CUALQUIER destino parece "fuera del área". Eso acusaba a todas
    // las líneas de un problema inexistente y, como el aviso bloquea, ni siquiera dejaba
    // guardar el centro, que sí funciona.
    //
    // La lista vacía no prueba que el destino esté mal: prueba que no sabemos. Lo que
    // falta se informa aparte, con el error real de `catalogs.errors`.
    catalogs.destinations.length > 0 &&
    !catalogs.destinations.some((d) => d.destinationCode === destinationCode)
  ) {
    warnings.push({
      kind: 'destino-fuera-del-area',
      blocking: true,
      message: `El destino ${destinationCode} no corresponde al área de venta de la orden. Elegí otro.`,
    });
  }

  const center = effectiveCenter(draft.centerCode, headerCenterCode);
  const allowed = catalogs.centers.some((c) => c.centerCode === center.code);
  if (center.code && catalogs.centers.length > 0 && !allowed) {
    warnings.push(
      center.inherited
        ? {
            kind: 'centro-de-cabecera-no-permitido',
            blocking: false,
            message: `Hereda el centro ${center.code} de la cabecera, que no está permitido para el cliente. Puede ser el motivo del rechazo: elegí un centro.`,
          }
        : {
            kind: 'centro-no-permitido',
            blocking: true,
            message: `El centro ${center.code} no está permitido para el cliente. Elegí otro.`,
          },
    );
  } else {
    const available = stockFor(catalogs.stock, item.productCode, center.code);
    const unit = item.unitOfMeasure ?? '';
    if (available !== null && available <= 0) {
      warnings.push({
        kind: 'sin-stock',
        blocking: false,
        message: `Sin stock en el centro ${center.code}. SAP puede volver a rechazarla.`,
      });
    } else if (available !== null && item.quantity != null && available < item.quantity) {
      warnings.push({
        kind: 'stock-insuficiente',
        blocking: false,
        message: `El centro ${center.code} tiene ${formatQuantity(available)} ${unit} y la línea pide ${formatQuantity(item.quantity)}. SAP puede volver a rechazarla.`,
      });
    }
  }

  return warnings;
}

/** Cantidad de líneas con al menos un aviso que impide guardar o reenviar. */
export function blockingItemCount(
  items: ReviewItem[],
  drafts: LineDrafts,
  headerCenterCode: string | null,
  catalogs: ReviewCatalogs,
): number {
  return items.filter((item) =>
    itemWarnings(item, draftFor(item, drafts), headerCenterCode, catalogs).some((w) => w.blocking),
  ).length;
}

/** Cuántas órdenes SAP saldrían: una por cada centro distinto de las líneas. */
export function sapOrdersByCenter(
  items: ReviewItem[],
  drafts: LineDrafts,
  headerCenterCode: string | null,
): { centerCode: string | null; lines: number[] }[] {
  const groups = new Map<string, number[]>();
  for (const item of items) {
    const code = effectiveCenter(draftFor(item, drafts).centerCode, headerCenterCode).code ?? '';
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code)?.push(item.lineNumber);
  }
  return [...groups.entries()].map(([code, lines]) => ({ centerCode: code || null, lines }));
}
