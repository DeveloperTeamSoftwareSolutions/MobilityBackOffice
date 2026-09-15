import {
  ItemWarning,
  LineChange,
  LineDraft,
  LineDrafts,
  ReviewCatalogs,
  ReviewItem,
  SalesArea,
  StockByCenter,
} from './revision-sap.types';

export function formatSalesArea(area: SalesArea): string {
  return [area.companyCode, area.channelCode, area.sectorCode]
    .map((code) => code ?? '—')
    .join(' / ');
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
  } else if (!catalogs.destinations.some((d) => d.destinationCode === destinationCode)) {
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
