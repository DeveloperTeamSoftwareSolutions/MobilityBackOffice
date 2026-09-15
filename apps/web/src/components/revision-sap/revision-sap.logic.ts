import {
  Assignments,
  ItemAssignment,
  ItemChange,
  ItemWarning,
  ReviewCatalogs,
  ReviewItem,
  ReviewQueueEntry,
  SalesArea,
} from './revision-sap.types';

export function formatSalesArea(area: SalesArea): string {
  return `${area.companyCode} / ${area.channelCode} / ${area.sectorCode}`;
}

export function formatQuantity(quantity: number): string {
  return quantity.toLocaleString('es-AR', { maximumFractionDigits: 3 });
}

/** Asignación de partida: lo que la orden tenía cuando SAP la rechazó. */
export function initialAssignments(items: ReviewItem[]): Assignments {
  return Object.fromEntries(
    items.map((item) => [
      item.guid,
      { centerCode: item.centerCode, destinationCode: item.destinationCode },
    ]),
  );
}

function sameAssignment(a: ItemAssignment, b: ItemAssignment): boolean {
  return a.centerCode === b.centerCode && a.destinationCode === b.destinationCode;
}

/** Líneas cuyo centro o destino difiere del original, en el orden de la orden. */
export function changedItems(
  items: ReviewItem[],
  assignments: Assignments,
): ItemChange[] {
  return items.flatMap((item) => {
    const before = { centerCode: item.centerCode, destinationCode: item.destinationCode };
    const after = assignments[item.guid] ?? before;
    return sameAssignment(before, after) ? [] : [{ item, before, after }];
  });
}

/**
 * Stock de un producto en un centro. `null` sin centro elegido; 0 si el centro no
 * tiene registro de ese producto.
 */
export function stockFor(
  stock: ReviewCatalogs['stock'],
  productCode: string,
  centerCode: string | null,
): number | null {
  if (!centerCode) return null;
  return stock[productCode]?.[centerCode] ?? 0;
}

/**
 * Qué hay que avisar de una línea con su asignación vigente.
 *
 * Bloquean el reenvío los datos que SAP rechaza seguro: sin centro o destino, un
 * centro que no está permitido para el cliente o un destino de otra área de venta.
 * El stock solo avisa: SAP lo revalida con el stock real, y el equipo decidió que
 * se pueda elegir un centro sin stock.
 */
export function itemWarnings(
  item: ReviewItem,
  assignment: ItemAssignment,
  catalogs: ReviewCatalogs,
): ItemWarning[] {
  const warnings: ItemWarning[] = [];
  const { centerCode, destinationCode } = assignment;

  if (!centerCode) {
    warnings.push({
      kind: 'sin-centro',
      blocking: true,
      message: 'Elegí un centro de distribución.',
    });
  } else if (!catalogs.centers.some((c) => c.centerCode === centerCode)) {
    warnings.push({
      kind: 'centro-no-permitido',
      blocking: true,
      message: `El centro ${centerCode} no está permitido para este cliente. Elegí otro.`,
    });
  } else {
    const available = stockFor(catalogs.stock, item.productCode, centerCode) ?? 0;
    if (available <= 0) {
      warnings.push({
        kind: 'sin-stock',
        blocking: false,
        message: `Sin stock en el centro ${centerCode}. Se puede reenviar, pero SAP puede volver a rechazarla.`,
      });
    } else if (available < item.quantity) {
      warnings.push({
        kind: 'stock-insuficiente',
        blocking: false,
        message: `El centro ${centerCode} tiene ${formatQuantity(available)} ${item.unitOfMeasure} y la línea pide ${formatQuantity(item.quantity)}. SAP puede volver a rechazarla.`,
      });
    }
  }

  if (!destinationCode) {
    warnings.push({
      kind: 'sin-destino',
      blocking: true,
      message: 'Elegí un destino de entrega.',
    });
  } else if (!catalogs.destinations.some((d) => d.destinationCode === destinationCode)) {
    warnings.push({
      kind: 'destino-fuera-del-area',
      blocking: true,
      message: `El destino ${destinationCode} no corresponde al área de venta de la orden. Elegí otro.`,
    });
  }

  return warnings;
}

/** Cantidad de líneas con al menos un aviso que impide reenviar. */
export function blockingItemCount(
  items: ReviewItem[],
  assignments: Assignments,
  catalogs: ReviewCatalogs,
): number {
  return items.filter((item) =>
    itemWarnings(item, assignments[item.guid], catalogs).some((w) => w.blocking),
  ).length;
}

/** Filtro de la bandeja por número de orden, cliente o vendedor. */
export function filterQueue(
  entries: ReviewQueueEntry[],
  search: string,
): ReviewQueueEntry[] {
  const term = search.trim().toLocaleLowerCase('es');
  if (!term) return entries;
  return entries.filter((e) =>
    [e.orderNumber, e.customerCode, e.customerName, e.sellerEmail].some((value) =>
      value.toLocaleLowerCase('es').includes(term),
    ),
  );
}
