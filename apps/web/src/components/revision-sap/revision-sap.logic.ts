import {
  CenterOption,
  ItemWarning,
  LineChange,
  LineDraft,
  LineDrafts,
  ProductStockRow,
  ResendPlan,
  ReviewCatalogs,
  ReviewItem,
  SalesArea,
  SapSendAttempt,
  SapErrorLine,
  SapOrder,
  SapOrderSource,
  StockByCenter,
  StockCenterOption,
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

/**
 * El stock de un producto, agrupado POR CENTRO, para poder elegir uno desde el modal.
 *
 * El stock viene por centro + almacén, pero lo que se elige es el **centro** (decisión
 * 4c: el almacén no viaja a SAP), así que hay que sumar los almacenes de cada uno.
 *
 * `elegible` sale de los centros permitidos del cliente (decisión 4a), NO del stock: un
 * centro sin stock se puede elegir igual, con aviso, porque SAP revalida al enviar
 * (decisión 4b). Y un centro con stock al que el cliente no accede no se puede elegir,
 * aunque el stock esté ahí — por eso las dos cosas se calculan por separado.
 */
export function stockByCenter(
  rows: ProductStockRow[],
  centers: CenterOption[],
): StockCenterOption[] {
  const permitidos = new Map(centers.map((c) => [c.centerCode, c.centerName]));
  const porCentro = new Map<string, StockCenterOption>();

  for (const row of rows) {
    const code = row.centerCode?.trim();
    if (!code) continue;
    const previo = porCentro.get(code);
    if (previo) {
      previo.available += row.available;
      previo.warehouses += 1;
      continue;
    }
    porCentro.set(code, {
      centerCode: code,
      centerName: permitidos.get(code) ?? row.centerName,
      available: row.available,
      warehouses: 1,
      elegible: permitidos.has(code),
    });
  }

  // Un centro permitido SIN ninguna fila de stock también es elegible: que no aparezca
  // en el stock significa cero, no que no exista. Esconderlo dejaría al operador sin la
  // opción de mandarlo igual.
  for (const [code, name] of permitidos) {
    if (!porCentro.has(code)) {
      porCentro.set(code, {
        centerCode: code, centerName: name, available: 0, warehouses: 0, elegible: true,
      });
    }
  }

  // Primero los que se pueden elegir, y dentro de esos, los que más stock tienen.
  return [...porCentro.values()].sort((a, b) => {
    if (a.elegible !== b.elegible) return a.elegible ? -1 : 1;
    if (a.available !== b.available) return b.available - a.available;
    return a.centerCode.localeCompare(b.centerCode);
  });
}

/** ¿Alcanza el stock de ese centro para lo que pide la línea? `null` si no se sabe. */
export function cubreLaCantidad(available: number, quantity: number | null): boolean | null {
  if (quantity == null) return null;
  return available >= quantity;
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

/**
 * Los drafts DESPUÉS de recargar la orden, conservando lo que el usuario venía editando.
 *
 * El problema que resuelve (reportado 2026-09-23): cancelar o reactivar una línea recarga
 * la orden entera, y hasta ahora eso hacía `initialDrafts(frescos)` — que **descartaba en
 * silencio** los cambios sin guardar de TODAS las demás líneas. Cambiabas el centro de un
 * producto, cancelabas otro, y el primero volvía solo a su centro original. Pasaba igual
 * con el destino.
 *
 * La regla: un draft se conserva sólo si el usuario lo había CAMBIADO —difiere de lo que
 * la línea tenía guardada antes de recargar—. Si no lo tocó, se toma el valor fresco del
 * servidor. Esa distinción importa: sin ella, un draft "sin tocar" pisaría un cambio que
 * otra persona guardó mientras tanto, con un valor que este usuario nunca eligió.
 */
export function draftsTrasRecarga(
  frescos: ReviewItem[],
  previos: ReviewItem[],
  drafts: LineDrafts,
): LineDrafts {
  const antes = new Map(previos.map((item) => [item.guid, item]));

  return Object.fromEntries(
    frescos.map((item) => {
      const inicial: LineDraft = {
        centerCode: item.centerCode,
        destinationCode: item.deliveryDestinationCode,
      };
      const draft = drafts[item.guid];
      const previo = antes.get(item.guid);
      // Línea nueva, o sin draft: no hay nada que conservar.
      if (!draft || !previo) return [item.guid, inicial];

      const pendiente =
        draft.centerCode !== previo.centerCode ||
        draft.destinationCode !== previo.deliveryDestinationCode;

      return [item.guid, pendiente ? draft : inicial];
    }),
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

  // SIN CENTRO PROPIO: la línea sale con el de la cabecera. Avisa, no bloquea.
  //
  // Historia corta, porque el aviso cambió de sentido en el mismo día. El envío de
  // BackOffice exigía CenterCode en cada línea y rebotaba la orden entera sin él, así que
  // esto empezó siendo BLOQUEANTE. Pero el 68% de las líneas llega sin centro —MobilityIA
  // no lo guarda por línea—, con lo cual el aviso saltaba casi siempre y pedía un trabajo
  // manual que el envío del vendedor no pide.
  //
  // Desde el Middleware 1.374.0 el envío HEREDA el centro de la cabecera, igual que el
  // camino del vendedor. Entonces ya no es un error: es un dato, y el operador tiene que
  // poder verlo —qué centro va a usar esa línea— sin que le trabe el trabajo.
  //
  // Sin centro en la línea NI en la cabecera sí sigue bloqueando: ahí no hay de dónde
  // heredar y el envío lo rechaza.
  if (!draft.centerCode) {
    warnings.push(
      headerCenterCode
        ? {
            kind: 'sin-centro-propio',
            blocking: false,
            message: `Sale con el centro ${headerCenterCode} de la cabecera. Elegí uno si tiene que salir de otro.`,
          }
        : {
            kind: 'sin-centro-propio',
            blocking: true,
            message:
              'Elegí el centro de distribución: la línea no tiene uno y la cabecera tampoco, así que el envío no tiene de dónde tomarlo.',
          },
    );
  }

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
  yaEnSap?: Map<number, string>,
): number {
  // Sólo las que van a VIAJAR. Una línea cancelada —o una que ya tiene su pedido en SAP—
  // no se manda, así que su destino vacío o su centro no permitido no pueden hacer
  // rebotar el envío: sería un bloqueo sobre algo que no se manda, y cancelar la línea
  // problemática dejaría de destrabar la orden, que es justamente para lo que sirve.
  return activeItems(items, yaEnSap).filter((item) =>
    itemWarnings(item, draftFor(item, drafts), headerCenterCode, catalogs).some((w) => w.blocking),
  ).length;
}

/** Cómo se nombra cada app en pantalla. */
const APP: Record<SapOrderSource, string> = {
  mobilityia: 'MobilityIA',
  backoffice: 'BackOffice',
};

/**
 * De qué app viene una orden SAP, tolerando que el middleware no lo mande.
 *
 * `source` existe desde el Middleware **1.368.0**. Contra uno anterior llega `undefined`,
 * y ahí se cae al **centro**, que es la misma huella vista desde el otro lado:
 *
 *   - el envío del vendedor (`businessorders2sap`) manda la orden entera y **no guarda
 *     `CenterCode`** en la fila de `SAPOrders`;
 *   - el de BackOffice crea una fila POR CENTRO y lo guarda en cada una.
 *
 * Verificado en el repositorio del middleware: el insert clásico no incluye la columna y
 * `updateSapResult` no la toca. Así que "tiene centro" equivale a "salió de BackOffice"
 * mientras la fila venga de este circuito.
 *
 * El respaldo no es cosmético: sin él, contra un middleware anterior TODAS las órdenes
 * SAP se leen como del vendedor —que nunca agrupa— y cada una aparece como un intento
 * suelto. Que es justo lo que esta pantalla vino a evitar.
 */
function sourceOf(orden: SapOrder): SapOrderSource {
  if (orden.source === 'backoffice' || orden.source === 'mobilityia') return orden.source;
  return orden.centerCode ? 'backoffice' : 'mobilityia';
}

/** El nombre de la app que hizo el envío, para el encabezado del intento. */
export function sourceLabel(source: SapOrderSource): string {
  return APP[source] ?? APP.mobilityia;
}

/**
 * Margen para considerar que dos órdenes SAP salieron en el MISMO envío.
 *
 * El envío de BackOffice llama a SAP **una vez por centro, en serie**, y el middleware le
 * da hasta 120 s a cada llamada. Así que dos órdenes SAP del mismo envío pueden quedar
 * separadas por un par de minutos si SAP estuvo lento. Cinco minutos deja holgura sin
 * llegar a fusionar dos envíos distintos, que siempre tienen una persona mirando el
 * resultado en el medio.
 */
const MISMO_ENVIO_MS = 5 * 60 * 1000;

const enMilisegundos = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/**
 * ¿Esta orden SAP salió en el mismo envío que las del intento que venimos armando?
 *
 * Tres condiciones, y cada una tapa un agujero distinto:
 *
 * 1. **Misma app.** Un envío es de una sola.
 * 2. **Sólo BackOffice agrupa.** El envío del vendedor manda la orden entera en UNA orden
 *    SAP, así que dos filas suyas son siempre dos intentos distintos — aunque caigan
 *    seguidas.
 * 3. **El centro no se repite.** El envío de BackOffice crea una orden SAP POR CENTRO: si
 *    el centro ya está en el grupo, esta fila es de otro envío. Es la señal más fuerte,
 *    porque no depende del reloj.
 * 4. **Y dentro de la ventana de tiempo**, como respaldo para el caso en que dos envíos
 *    usen centros distintos (por ejemplo, si entre uno y otro se corrigió el centro).
 */
function esDelMismoEnvio(intento: SapSendAttempt, orden: SapOrder): boolean {
  const source = sourceOf(orden);
  if (intento.source !== source) return false;
  if (source !== 'backoffice') return false;
  if (intento.orders.some((o) => o.centerCode === orden.centerCode)) return false;

  const nuevo = enMilisegundos(orden.attemptAt);
  const grupo = enMilisegundos(intento.attemptAt);
  // Sin fecha en alguno de los dos no se puede comparar: se agrupa igual, porque las
  // otras tres condiciones ya se cumplieron.
  if (nuevo === null || grupo === null) return true;
  return Math.abs(grupo - nuevo) <= MISMO_ENVIO_MS;
}

/**
 * Separa las órdenes SAP en INTENTOS: las que salieron juntas, en un mismo envío.
 *
 * Es lo que permite mostrar la pestaña con una línea divisoria por intento, diciendo
 * cuándo fue y desde qué app. Sin esto, una orden con tres órdenes SAP —una del vendedor
 * y dos de un reenvío de BackOffice— se lee como una sola tanda de tres.
 *
 * Espera la lista como la manda el servidor: **de la más reciente a la más vieja**. Se
 * respeta ese orden, así que el intento más nuevo queda primero, que es el que se mira.
 */
export function groupSapOrdersByAttempt(sapOrders: SapOrder[]): SapSendAttempt[] {
  const intentos: SapSendAttempt[] = [];
  for (const orden of sapOrders) {
    const actual = intentos[intentos.length - 1];
    if (actual && esDelMismoEnvio(actual, orden)) {
      actual.orders.push(orden);
      // La fecha del intento es la más reciente de sus órdenes SAP.
      const previo = enMilisegundos(actual.attemptAt);
      const nuevo = enMilisegundos(orden.attemptAt);
      if (previo === null || (nuevo !== null && nuevo > previo)) actual.attemptAt = orden.attemptAt;
      continue;
    }
    intentos.push({ attemptAt: orden.attemptAt, source: sourceOf(orden), orders: [orden] });
  }
  return intentos;
}

/** Un número de pedido real: vacío o todo ceros no cuenta (SAP devuelve `0000000000`). */
function tienePedido(value: string | null): boolean {
  const v = (value ?? '').trim();
  return v !== '' && !/^0+$/.test(v);
}

/**
 * Las líneas que YA salieron en una orden SAP con pedido creado, y en cuál.
 * Devuelve `lineNumber -> número de pedido`.
 *
 * Se calcula con las órdenes SAP que el detalle ya trae, sin pedirle nada nuevo al
 * servidor: el dato está en pantalla, sólo había que leerlo.
 *
 * POR QUÉ IMPORTA (ORD00000487, 2026-09-23): el envío parte la orden por centro y cada
 * uno se acepta o se rechaza por su cuenta. Tras un envío parcial, las líneas que
 * salieron tienen pedido REAL en SAP — y la pantalla las seguía ofreciendo como si nada,
 * así que el siguiente reenvío las mandaba otra vez. Un pedido creado dos veces es una
 * venta facturada dos veces.
 *
 * Por LÍNEA y no por producto: el mismo producto puede estar en dos líneas (en la 487, el
 * 1230904 está en la 1 y en la 2) y sólo una salió.
 */
export function lineasYaEnSap(sapOrders: SapOrder[]): Map<number, string> {
  const porLinea = new Map<number, string>();
  for (const orden of sapOrders) {
    if (!tienePedido(orden.sapOrderNumber)) continue;
    const pedido = (orden.sapOrderNumber ?? '').trim();
    for (const item of orden.items ?? []) {
      if (item.lineNumber == null) continue;
      // El primero que la reclama se queda: si por algún motivo apareciera en dos
      // pedidos, el más viejo es el que la sacó de circulación.
      if (!porLinea.has(item.lineNumber)) porLinea.set(item.lineNumber, pedido);
    }
  }
  return porLinea;
}

/** La línea está cancelada por BackOffice: no viaja a SAP. */
export function isCancelled(item: ReviewItem): boolean {
  return Boolean(item.cancelledAt);
}

/**
 * Las líneas que SÍ van a viajar. Es lo único que el envío toma en cuenta.
 *
 * Quedan afuera por DOS motivos distintos, y conviene no confundirlos:
 *   - **cancelada** por BackOffice, con su motivo de no venta — una decisión;
 *   - **ya tiene pedido** en SAP — un hecho consumado: mandarla otra vez lo duplicaría.
 *
 * `yaEnSap` es opcional para no obligar a cada llamador a tenerlo; sin él sólo se
 * descartan las canceladas, que es el comportamiento de antes.
 */
export function activeItems(items: ReviewItem[], yaEnSap?: Map<number, string>): ReviewItem[] {
  return items.filter((item) => !isCancelled(item) && !yaEnSap?.has(item.lineNumber));
}

/**
 * Cuántas órdenes SAP saldrían: una por cada centro distinto de las líneas ACTIVAS.
 *
 * Las canceladas quedan fuera a propósito. Contarlas haría aparecer un centro que no va
 * a salir, y con todas las líneas de un centro canceladas ese centro directamente no
 * existe en el envío.
 */
export function sapOrdersByCenter(
  items: ReviewItem[],
  drafts: LineDrafts,
  headerCenterCode: string | null,
  yaEnSap?: Map<number, string>,
): { centerCode: string | null; lines: number[] }[] {
  const groups = new Map<string, number[]>();
  for (const item of activeItems(items, yaEnSap)) {
    const code = effectiveCenter(draftFor(item, drafts).centerCode, headerCenterCode).code ?? '';
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code)?.push(item.lineNumber);
  }
  return [...groups.entries()].map(([code, lines]) => ({ centerCode: code || null, lines }));
}

/**
 * Arma CÓMO VA A SALIR el próximo envío: una orden SAP por centro, con sus productos.
 *
 * Se calcula en el navegador y no se le pide al servidor, porque no hay nada que
 * preguntar: el envío parte por centro y excluye las canceladas, y las dos reglas ya
 * están acá. Pedirlo sería inventar un endpoint para repetir lo que la pantalla sabe.
 *
 * Toma los DRAFTS, no lo guardado: si el usuario movió una línea de centro y todavía no
 * guardó, la previsualización tiene que mostrar el centro que eligió. Mostrarle el viejo
 * convertiría la confirmación en una trampa.
 *
 * `attemptsSoFar` son los envíos que ya se hicieron: el próximo es el siguiente número.
 */
export function planResend(
  items: ReviewItem[],
  drafts: LineDrafts,
  headerCenterCode: string | null,
  centers: CenterOption[],
  attemptsSoFar: number,
  yaEnSap?: Map<number, string>,
): ResendPlan {
  const nombres = new Map(centers.map((c) => [c.centerCode, c.centerName]));
  const porCentro = new Map<string, ReviewItem[]>();

  for (const item of activeItems(items, yaEnSap)) {
    const code = effectiveCenter(draftFor(item, drafts).centerCode, headerCenterCode).code ?? '';
    if (!porCentro.has(code)) porCentro.set(code, []);
    porCentro.get(code)?.push(item);
  }

  const orders = [...porCentro.entries()].map(([code, lines]) => ({
    centerCode: code || null,
    centerName: code ? (nombres.get(code) ?? null) : null,
    // Dentro de cada orden SAP, por número de línea: es el orden en que el usuario las
    // ve en la tabla de arriba.
    items: [...lines].sort((a, b) => a.lineNumber - b.lineNumber),
    // Las que caen acá por HERENCIA de la cabecera y no por centro propio. El envío no
    // hereda: con una sola de éstas la orden entera rebota.
    heredados: lines.filter((item) => !draftFor(item, drafts).centerCode).length,
  }));

  const enviables = activeItems(items, yaEnSap);

  return {
    // Por centro, para que dos previsualizaciones seguidas no bailen.
    orders: orders.sort((a, b) => (a.centerCode ?? '').localeCompare(b.centerCode ?? '')),
    attemptNumber: Math.max(0, attemptsSoFar) + 1,
    // Las canceladas se cuentan SIN mezclar con las que ya salieron: son dos motivos
    // distintos de quedar afuera y el modal los explica por separado.
    cancelledCount: items.filter(isCancelled).length,
    // Las que ya tienen pedido: no se van a mandar, y el operador tiene que saber que no
    // es un olvido sino que ya están en SAP.
    alreadyInSapCount: items.filter((i) => !isCancelled(i) && yaEnSap?.has(i.lineNumber)).length,
    itemCount: enviables.length,
  };
}
