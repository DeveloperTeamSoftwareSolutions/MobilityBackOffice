import {
  DestinationChange,
  DestinationDrafts,
  ItemWarning,
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

/** Destinos de partida: los que la orden tenía guardados. */
export function initialDrafts(items: ReviewItem[]): DestinationDrafts {
  return Object.fromEntries(items.map((item) => [item.guid, item.deliveryDestinationCode]));
}

/** Líneas cuyo destino elegido difiere del guardado, en el orden de la orden. */
export function destinationChanges(
  items: ReviewItem[],
  drafts: DestinationDrafts,
): DestinationChange[] {
  return items.flatMap((item) => {
    const before = item.deliveryDestinationCode;
    const after = item.guid in drafts ? drafts[item.guid] : before;
    return before === after ? [] : [{ item, before, after }];
  });
}

/**
 * Centro con el que sale la línea. Hoy MobilityIA no guarda centro por línea, así que
 * casi siempre es el de la cabecera, que es además el único que llega a SAP.
 */
export function effectiveCenter(
  item: ReviewItem,
  headerCenterCode: string | null,
): { code: string | null; inherited: boolean } {
  if (item.centerCode) return { code: item.centerCode, inherited: false };
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
 * Bloquean el destino vacío o de otra área de venta: SAP los rechaza seguro y el
 * servidor tampoco los acepta. El centro y el stock solo avisan: el centro no se edita
 * todavía, y el stock lo revalida SAP (el equipo decidió permitir centros sin stock).
 */
export function itemWarnings(
  item: ReviewItem,
  destinationCode: string | null,
  headerCenterCode: string | null,
  catalogs: ReviewCatalogs,
): ItemWarning[] {
  const warnings: ItemWarning[] = [];

  if (!destinationCode) {
    warnings.push({ kind: 'sin-destino', blocking: true, message: 'Elegí un destino de entrega.' });
  } else if (!catalogs.destinations.some((d) => d.destinationCode === destinationCode)) {
    warnings.push({
      kind: 'destino-fuera-del-area',
      blocking: true,
      message: `El destino ${destinationCode} no corresponde al área de venta de la orden. Elegí otro.`,
    });
  }

  const center = effectiveCenter(item, headerCenterCode).code;
  if (center && catalogs.centers.length > 0 && !catalogs.centers.some((c) => c.centerCode === center)) {
    warnings.push({
      kind: 'centro-no-permitido',
      blocking: false,
      message: `El centro ${center} no está entre los permitidos para el cliente. Puede ser el motivo del rechazo.`,
    });
  } else {
    const available = stockFor(catalogs.stock, item.productCode, center);
    const unit = item.unitOfMeasure ?? '';
    if (available !== null && available <= 0) {
      warnings.push({
        kind: 'sin-stock',
        blocking: false,
        message: `Sin stock en el centro ${center}. SAP puede volver a rechazarla.`,
      });
    } else if (available !== null && item.quantity != null && available < item.quantity) {
      warnings.push({
        kind: 'stock-insuficiente',
        blocking: false,
        message: `El centro ${center} tiene ${formatQuantity(available)} ${unit} y la línea pide ${formatQuantity(item.quantity)}. SAP puede volver a rechazarla.`,
      });
    }
  }

  return warnings;
}

/** Cantidad de líneas con al menos un aviso que impide guardar o reenviar. */
export function blockingItemCount(
  items: ReviewItem[],
  drafts: DestinationDrafts,
  headerCenterCode: string | null,
  catalogs: ReviewCatalogs,
): number {
  return items.filter((item) =>
    itemWarnings(
      item,
      item.guid in drafts ? drafts[item.guid] : item.deliveryDestinationCode,
      headerCenterCode,
      catalogs,
    ).some((w) => w.blocking),
  ).length;
}
