import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReviewOrderDetail } from './ReviewOrderDetail';
import { ProductStock, ReviewCatalogs, ReviewOrderDetail as Detail, SapOrder } from './revision-sap.types';

/**
 * Lo que se fija acá: el detalle son DOS pestañas con papeles distintos.
 *
 * "Productos" es la orden tal como se va a reenviar: ahí se corrige el centro y el
 * destino de CADA línea, sin importar en qué orden SAP cayó. "Órdenes SAP" es el
 * historial de cada intento y es solo consulta: ningún selector y ningún botón.
 *
 * El reenvío es de la orden COMPLETA (confirmado con el equipo el 2026-09-17), así que
 * su botón vive en la barra de acciones, fuera de las dos pestañas.
 */

const ORDER = '11111111-2222-3333-4444-555555555555';

function order(over: Partial<Detail> = {}): Detail {
  return {
    guid: ORDER,
    orderNumber: 'ORD00005729',
    statusCode: 'Processed',
    customerCode: '10002523',
    customerName: 'CONVENIO DE VENTAS DEMASA',
    sellerEmail: 'vendedor@duwest.com',
    sellerName: 'Vendedor',
    salesArea: {
      companyCode: '2800',
      channelCode: '10',
      sectorCode: '10',
      companyName: 'Duwest Cafesa, S.A.',
      channelName: 'Clientes finales',
      sectorName: 'Protec de Cultivo',
    },
    centerCode: '2801',
    centerName: 'DW Alm. Externo',
    destination: '30000124',
    orderDate: '2026-09-15T15:30:46.046Z',
    cancelledAt: null,
    groupInvoice: false,
    sap: {
      orderNumber: null,
      lastError: '[E] El material 1200135 no está ampliado para el centro 2802. | [W] Verificá la extensión.',
      lastAttemptAt: '2026-09-15T16:00:00Z',
    },
    backoffice: { inReview: true, decidedBy: null, decidedAt: null },
    items: [
      {
        guid: 'item-1',
        lineNumber: 1,
        productCode: '1200183',
        productDescription: 'AMISTAR 50 WG',
        quantity: 1,
        unitOfMeasure: 'PI',
        centerCode: '2801',
        deliveryDestinationCode: '30000124',
        deliveryDestinationName: 'Inversiones',
      },
      {
        guid: 'item-3',
        lineNumber: 3,
        productCode: '1200135',
        productDescription: 'AGROKIN V 200LT',
        quantity: 1,
        unitOfMeasure: 'L',
        centerCode: '2802',
        deliveryDestinationCode: '30000124',
        deliveryDestinationName: 'Inversiones',
      },
    ],
    sapAttempts: [
      { guid: 'a1', attemptAt: '2026-09-15T16:00:00Z', statusCode: 'Draft', error: '[E] El material 1200135 no está ampliado para el centro 2802.' },
    ],
    ...over,
  };
}

const sapOrders: SapOrder[] = [
  {
    guid: 'sap-ok',
    status: 'accepted',
    statusCode: 'Authorized',
    centerCode: '2801',
    centerName: 'DW Alm. Externo',
    attemptAt: '2026-09-15T16:00:00Z',
    sapOrderNumber: '0099900101',
    sapDispatchNumber: '0089900101',
    error: null,
    items: [
      {
        lineNumber: 1,
        productCode: '1200183',
        description: 'AMISTAR 50 WG',
        quantity: 1,
        unitOfMeasure: 'PI',
        itemGuid: 'item-1',
        centerCode: '2801',
        deliveryDestinationCode: '30000124',
        deliveryDestinationName: 'Inversiones',
      },
    ],
  },
  {
    guid: 'sap-rej',
    status: 'rejected',
    statusCode: 'Draft',
    centerCode: '2802',
    centerName: 'DW Cartago',
    attemptAt: '2026-09-15T16:00:00Z',
    sapOrderNumber: null,
    sapDispatchNumber: null,
    error: '[E] El material 1200135 no está ampliado para el centro 2802.',
    items: [
      {
        lineNumber: 3,
        productCode: '1200135',
        description: 'AGROKIN V 200LT',
        quantity: 1,
        unitOfMeasure: 'L',
        itemGuid: 'item-3',
        centerCode: '2802',
        deliveryDestinationCode: '30000124',
        deliveryDestinationName: 'Inversiones',
      },
    ],
  },
];

const catalogs: ReviewCatalogs = {
  centers: [
    { centerCode: '2801', centerName: 'DW Alm. Externo' },
    { centerCode: '2802', centerName: 'DW Cartago' },
  ],
  destinations: [
    { destinationCode: '30000124', destinationName: 'Inversiones', deliveryAddress: 'Cañas' },
    { destinationCode: '10019279', destinationName: 'Lobo Cruz', deliveryAddress: 'Upala' },
  ],
  stock: null,
  errors: [],
};

const stock: ProductStock = {
  productCode: '1200135',
  companyCode: '2800',
  unitOfMeasure: 'L',
  totals: { available: 2000, availableForCustomer: 2000, centers: 1 },
  rows: [
    {
      centerCode: '2802',
      centerName: 'DW Cartago',
      warehouseCode: '0020',
      warehouseName: 'Mat / P. Ter',
      unitOfMeasure: 'L',
      available: 2000,
      inInspection: 0,
      inTransit: 0,
      allowedForCustomer: true,
    },
  ],
  errors: [],
};

const api = vi.hoisted(() => ({
  getReviewOrder: vi.fn(),
  getReviewCatalogs: vi.fn(),
  listSapOrders: vi.fn(),
  changeItemDestination: vi.fn(),
  changeItemCenter: vi.fn(),
  changeGroupInvoice: vi.fn(),
  rejectOrder: vi.fn(),
  resendToSap: vi.fn(),
  getProductStock: vi.fn(),
}));

vi.mock('./revision-sap.api', () => ({
  getReviewOrder: api.getReviewOrder,
  getReviewCatalogs: api.getReviewCatalogs,
  listSapOrders: api.listSapOrders,
  changeItemDestination: api.changeItemDestination,
  changeItemCenter: api.changeItemCenter,
  changeGroupInvoice: api.changeGroupInvoice,
  rejectOrder: api.rejectOrder,
  resendToSap: api.resendToSap,
  getProductStock: api.getProductStock,
  apiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

const envioAceptado = {
  accepted: true,
  skipped: false,
  skippedReason: null,
  sapOrderNumber: '0004500123',
  sapDispatchNumber: '0080001234',
  error: null,
  sapMessages: [],
  filteredItemsCount: 0,
  itemsSent: 2,
  stillInReview: false,
};

beforeEach(() => {
  api.getReviewOrder.mockReset().mockResolvedValue(order());
  api.getReviewCatalogs.mockReset().mockResolvedValue(catalogs);
  api.listSapOrders.mockReset().mockResolvedValue(sapOrders);
  api.changeItemDestination.mockReset().mockResolvedValue({});
  api.changeItemCenter.mockReset().mockResolvedValue({});
  api.changeGroupInvoice.mockReset().mockResolvedValue({ ok: true, unchanged: false, groupInvoice: true });
  api.rejectOrder.mockReset().mockResolvedValue({ ok: true, statusCode: 'Rejected' });
  api.resendToSap.mockReset().mockResolvedValue(envioAceptado);
  api.getProductStock.mockReset().mockResolvedValue(stock);
});

async function renderDetail() {
  render(<ReviewOrderDetail guid={ORDER} onBack={() => undefined} />);
  await screen.findByText('ORD00005729');
}

function button(name: string | RegExp): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

const centerSelect = () => screen.getByLabelText('Centro de distribución de la línea 3') as HTMLSelectElement;
const destinationSelect = () => screen.getByLabelText('Destino de entrega de la línea 3') as HTMLSelectElement;

/**
 * La pestaña de órdenes SAP: el detalle abre en Productos. Se busca por rol `tab`, no
 * `button`: declarar `role="tab"` reemplaza el rol implícito del `<button>`.
 */
function verOrdenesSap() {
  fireEvent.click(screen.getByRole('tab', { name: /Órdenes SAP/ }));
}

describe('ReviewOrderDetail', () => {
  it('muestra el motivo separado en tipo y mensaje, y no muestra precios', async () => {
    await renderDetail();
    expect(screen.getAllByText('Error').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Aviso').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('El material 1200135 no está ampliado para el centro 2802.').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/precio|descuento|total/i)).toBeNull();
  });

  it('dice si la orden agrupa factura', async () => {
    await renderDetail();
    expect(screen.getByText('No')).toBeTruthy();

    api.getReviewOrder.mockResolvedValue(order({ groupInvoice: true }));
    render(<ReviewOrderDetail guid={ORDER} onBack={() => undefined} />);
    expect(await screen.findByText(/no puede salir parcial/)).toBeTruthy();
  });

  it('cada orden SAP muestra su centro y su estado, en su pestaña', async () => {
    await renderDetail();
    // Los estados viven en la otra pestaña: no están hasta abrirla.
    expect(screen.queryByText('Aceptada')).toBeNull();

    verOrdenesSap();
    expect(screen.getByText('Centro 2801 · DW Alm. Externo')).toBeTruthy();
    expect(screen.getByText('Centro 2802 · DW Cartago')).toBeTruthy();
    expect(screen.getByText('Aceptada')).toBeTruthy();
    expect(screen.getByText('Rechazada por SAP')).toBeTruthy();
    expect(screen.getByText('Pedido 0099900101')).toBeTruthy();
  });

  /**
   * El StatusCode crudo NO se muestra: no aporta y engaña — una rechazada se queda en
   * 'Draft' porque SAP no lo actualiza. Queda en el title, para quien lo necesite.
   */
  it('no muestra el StatusCode crudo, que diría "Draft" en una rechazada', async () => {
    await renderDetail();
    verOrdenesSap();
    expect(screen.queryByText('Draft')).toBeNull();
    expect(screen.queryByText('Authorized')).toBeNull();
  });

  /** Las etiquetas son las mismas que usa MobilityIA para estas mismas órdenes SAP. */
  it('los estados se llaman igual que en MobilityIA', async () => {
    api.listSapOrders.mockResolvedValue([
      { ...sapOrders[0], status: 'no_response', sapOrderNumber: null, sapDispatchNumber: null, error: null },
      { ...sapOrders[1], status: 'accepted_no_dispatch', sapOrderNumber: '0099900101', sapDispatchNumber: null, error: null },
    ]);
    await renderDetail();
    verOrdenesSap();

    expect(screen.getByText('Sin respuesta de SAP')).toBeTruthy();
    expect(screen.getByText('Aceptada sin entrega')).toBeTruthy();
  });

  /**
   * Es lo que cambia al reenviar, así que se ve sin salir del detalle. Pero UNA sola
   * etiqueta destacada: en revisión, el estado formal va en chico y no compite con el
   * cartel —si no, una orden en revisión se anuncia como "Procesada", que se lee como
   * lo contrario de lo que pasa.
   */
  it('en revisión: se muestra SOLO el cartel, sin el estado formal', async () => {
    api.getReviewOrder.mockResolvedValue(order({ statusCode: 'Processed' }));
    await renderDetail();

    expect(screen.getByText('En revisión por BackOffice')).toBeTruthy();
    // Nada de "Procesada": no agrega nada y se lee como lo contrario de lo que pasa.
    expect(screen.queryByText(/Procesada/)).toBeNull();
    expect(screen.queryByText(/^Estado: /)).toBeNull();
  });

  it('en revisión tampoco repite el estado nuevo, que diría lo mismo dos veces', async () => {
    api.getReviewOrder.mockResolvedValue(order({ statusCode: 'PendingBackofficeReview' }));
    await renderDetail();

    // Una sola vez, no "En revisión por BackOffice — Pendiente revisión Backoffice".
    expect(screen.getAllByText(/revisión (por )?Backoffice/i)).toHaveLength(1);
  });

  it('fuera de revisión: el estado es lo único que importa y toma la etiqueta', async () => {
    api.getReviewOrder.mockResolvedValue(
      order({
        statusCode: 'SentToSAP',
        backoffice: { inReview: false, decidedBy: 'bo@duwest.com', decidedAt: '2026-09-17T17:00:00Z' },
      }),
    );
    await renderDetail();

    expect(screen.getByText('Enviado a SAP')).toBeTruthy();
    expect(screen.queryByText('En revisión por BackOffice')).toBeNull();
    expect(screen.queryByText(/^Estado: /)).toBeNull();
  });

  it('todas las líneas se corrigen en Productos, esté aceptada o rechazada su orden SAP', async () => {
    await renderDetail();
    expect(centerSelect()).toBeTruthy();
    // La línea 1 salió en la orden SAP aceptada y se edita igual: la corrección es de
    // la orden, no de la orden SAP.
    expect(screen.getByLabelText('Centro de distribución de la línea 1')).toBeTruthy();
    expect(screen.getByLabelText('Destino de entrega de la línea 1')).toBeTruthy();
  });

  it('la pestaña de órdenes SAP es solo consulta', async () => {
    await renderDetail();
    verOrdenesSap();
    expect(screen.queryByLabelText('Centro de distribución de la línea 3')).toBeNull();
    expect(screen.queryByLabelText('Destino de entrega de la línea 3')).toBeNull();
    expect(screen.queryByRole('button', { name: /Ver stock/ })).toBeNull();
  });

  /**
   * El reenvío es de la orden COMPLETA, no de cada orden SAP (confirmado con el equipo
   * el 2026-09-17): se manda la BusinessOrder y el Middleware decide en cuántas órdenes
   * SAP sale. Por eso el botón vive en la barra de acciones y no dentro de una pestaña.
   */
  it('el reenvío es de la orden completa, no por orden SAP', async () => {
    await renderDetail();
    // Que esté apagado lo cubre el test de abajo; acá lo que importa es DÓNDE vive.
    expect(button('Reenviar a SAP')).toBeTruthy();

    verOrdenesSap();
    expect(screen.queryByRole('button', { name: 'Reenviar esta orden SAP' })).toBeNull();
    expect(button('Reenviar a SAP')).toBeTruthy();
  });

  /**
   * El reenvío está DESCONECTADO (2026-09-17): el envío del middleware manda la orden
   * como una sola orden SAP —el camino de MobilityIA— y BackOffice necesita el que la
   * parte por centro, que todavía no existe. El botón queda a la vista para que se sepa
   * que va ahí, pero apagado y explicando por qué.
   */
  it('el reenvío está a la vista pero apagado, con el motivo en el título', async () => {
    await renderDetail();
    const reenviar = button('Reenviar a SAP');
    expect(reenviar.disabled).toBe(true);
    expect(reenviar.title).toMatch(/por centro de distribución/);

    fireEvent.click(reenviar);
    // Ni siquiera abre la confirmación: no hay forma de llegar a SAP desde acá.
    expect(screen.queryByText(/Crea un pedido real en SAP/)).toBeNull();
    expect(api.resendToSap).not.toHaveBeenCalled();
  });

  it('cambiar el centro queda sin guardar y se puede descartar', async () => {
    await renderDetail();
    fireEvent.change(centerSelect(), { target: { value: '2801' } });
    expect(screen.getByText('1 cambio sin guardar')).toBeTruthy();
    expect(screen.getByText('Sin guardar')).toBeTruthy();

    fireEvent.click(button('Descartar cambios'));
    expect(screen.getByText('Sin cambios')).toBeTruthy();
    expect(centerSelect().value).toBe('2802');
  });

  it('guardar manda centro y destino al servidor y recarga las órdenes SAP', async () => {
    await renderDetail();
    fireEvent.change(centerSelect(), { target: { value: '2801' } });
    fireEvent.change(destinationSelect(), { target: { value: '10019279' } });
    expect(screen.getByText('2 cambios sin guardar')).toBeTruthy();

    fireEvent.click(button('Guardar cambios'));
    await screen.findByText('Se guardaron 2 cambios.');
    expect(api.changeItemCenter).toHaveBeenCalledWith(ORDER, 'item-3', '2801');
    expect(api.changeItemDestination).toHaveBeenCalledWith(ORDER, 'item-3', '10019279');
    expect(api.listSapOrders).toHaveBeenCalledTimes(2);
  });

  it('si el servidor rechaza un cambio, el error queda en el producto', async () => {
    await renderDetail();
    fireEvent.change(centerSelect(), { target: { value: '2801' } });
    api.changeItemCenter.mockRejectedValue(new Error('400'));

    fireEvent.click(button('Guardar cambios'));
    await screen.findByText('No se pudo guardar el centro.');
    await waitFor(() => expect(centerSelect().value).toBe('2801'));
  });

  it('el stock de un producto se ve en un modal, por centro y almacén', async () => {
    await renderDetail();
    // "y elegir centro" porque la orden es editable: el modal también sirve para elegir.
    // La línea 3 es el producto 1200135, el que SAP rechazó.
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver stock y elegir centro' })[1]);
    expect(await screen.findByText('Stock de 1200135')).toBeTruthy();
    expect(api.getProductStock).toHaveBeenCalledWith(ORDER, '1200135');
    // El almacén ya no es un nodo suelto: va en una línea con su código y cantidades.
    expect(screen.getByText(/Mat \/ P\. Ter/)).toBeTruthy();
    expect(screen.getByText('Del cliente')).toBeTruthy();

    fireEvent.click(button('Cerrar'));
    await waitFor(() => expect(screen.queryByText('Stock de 1200135')).toBeNull());
  });

  /**
   * Agrupa factura es lo único editable de la cabecera, y no se guarda con el resto:
   * cambia cómo sale la orden ENTERA, así que se confirma aparte y avisando qué implica.
   */
  it('cambiar agrupa factura avisa qué va a pasar antes de guardar', async () => {
    await renderDetail();
    fireEvent.click(button('Cambiar a Sí'));

    expect(screen.getByText(/deja de poder salir parcial/)).toBeTruthy();
    expect(screen.getByText(/no se manda nada a SAP/)).toBeTruthy();
    // Nada se guardó por abrir el aviso.
    expect(api.changeGroupInvoice).not.toHaveBeenCalled();

    fireEvent.click(button('Sí, agrupar factura'));
    await waitFor(() => expect(api.changeGroupInvoice).toHaveBeenCalledWith(ORDER, true, null));
    await screen.findByText(/ya no puede salir parcial/);
  });

  it('el aviso explica lo contrario si la orden ya agrupa factura, y se puede cancelar', async () => {
    api.getReviewOrder.mockResolvedValue(order({ groupInvoice: true }));
    await renderDetail();
    fireEvent.click(button('Cambiar a No'));

    expect(screen.getByText(/va a poder salir parcial/)).toBeTruthy();
    expect(screen.getByText(/deja de coincidir con la orden de compra/)).toBeTruthy();

    fireEvent.click(button('Cancelar'));
    await waitFor(() => expect(screen.queryByText(/va a poder salir parcial/)).toBeNull());
    expect(api.changeGroupInvoice).not.toHaveBeenCalled();
  });

  /**
   * El punto del modal: elegir el centro VIENDO cuánto hay, en vez de a ciegas en el
   * selector. Lo elegido queda como cualquier otro cambio — sin guardar hasta apretar
   * "Guardar cambios".
   */
  it('desde el modal se elige el centro, y queda sin guardar', async () => {
    await renderDetail();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver stock y elegir centro' })[1]);
    await screen.findByText('Stock de 1200135');

    // El stock de prueba está en el 2802, que es el centro que ya tiene la línea 3.
    expect(screen.getByText('Es el actual')).toBeTruthy();

    // 2801 es permitido y no tiene stock: se puede elegir igual (decisión 4b).
    fireEvent.click(screen.getAllByRole('button', { name: 'Elegir' })[0]);

    await waitFor(() => expect(screen.queryByText('Stock de 1200135')).toBeNull());
    expect(screen.getByText('1 cambio sin guardar')).toBeTruthy();
    expect(centerSelect().value).toBe('2801');
  });

  it('en solo lectura el modal sigue sirviendo para mirar, pero no para elegir', async () => {
    api.getReviewOrder.mockResolvedValue(
      order({ backoffice: { inReview: false, decidedBy: 'bo@duwest.com', decidedAt: null } }),
    );
    await renderDetail();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver stock por centro' })[1]);
    await screen.findByText('Stock de 1200135');

    expect(screen.queryByRole('button', { name: 'Elegir' })).toBeNull();
  });

  /**
   * Rechazar cierra la orden y NO se deshace (directiva 2026-09-18). Lo que se fija acá
   * es que no se pueda disparar de un solo clic ni sin motivo: el motivo es lo ÚNICO que
   * el vendedor va a leer, porque el estado sólo dice "Rechazada".
   */
  describe('rechazar la orden', () => {
    /**
     * El campo del motivo. Se busca por su label propio y no por /Motivo del rechazo/:
     * el detalle ya muestra un bloque "Motivo del rechazo de SAP" —lo que contestó SAP—
     * y ese matcher engancharía los dos. Son dos motivos distintos y de autores
     * distintos, así que tampoco se llaman igual en pantalla.
     */
    const motivoInput = () => screen.getByLabelText(/Por qué se rechaza/) as HTMLInputElement;

    it('avisa qué implica antes de rechazar, y no rechaza por abrir el aviso', async () => {
      await renderDetail();
      fireEvent.click(button('Rechazar orden'));

      expect(screen.getByText(/No se puede deshacer/)).toBeTruthy();
      expect(screen.getByText(/sólo puede copiarla|Lo único que va a poder hacer es copiarla/)).toBeTruthy();
      // El vendedor al que le vuelve, por nombre.
      expect(screen.getByText(/vendedor@duwest\.com/)).toBeTruthy();
      expect(api.rejectOrder).not.toHaveBeenCalled();
    });

    it('sin motivo no deja confirmar: es lo único que el vendedor va a leer', async () => {
      await renderDetail();
      fireEvent.click(button('Rechazar orden'));

      const confirmar = button('Sí, rechazar la orden');
      expect(confirmar.disabled).toBe(true);
      // Espacios tampoco alcanzan.
      fireEvent.change(motivoInput(), { target: { value: '   ' } });
      expect(button('Sí, rechazar la orden').disabled).toBe(true);
      expect(api.rejectOrder).not.toHaveBeenCalled();
    });

    it('con motivo rechaza, recarga la orden y avisa dónde quedó el motivo', async () => {
      await renderDetail();
      fireEvent.click(button('Rechazar orden'));
      fireEvent.change(motivoInput(), { target: { value: 'el cliente desistió de la compra' } });

      api.getReviewOrder.mockResolvedValue(
        order({
          statusCode: 'Rejected',
          backoffice: { inReview: false, decidedBy: 'bo@duwest.com', decidedAt: '2026-09-18T12:00:00Z' },
        }),
      );
      fireEvent.click(button('Sí, rechazar la orden'));

      await waitFor(() =>
        expect(api.rejectOrder).toHaveBeenCalledWith(ORDER, 'el cliente desistió de la compra'),
      );
      // El vendedor lee el motivo en el hilo: decirlo cierra el circuito para quien rechazó.
      await screen.findByText(/quedó en el hilo de comentarios/);
      // Y la orden recargada ya es de solo lectura: el estado manda.
      await waitFor(() => expect(screen.getByText('Rechazada')).toBeTruthy());
    });

    it('se puede cancelar sin rechazar', async () => {
      await renderDetail();
      fireEvent.click(button('Rechazar orden'));
      fireEvent.click(button('Cancelar'));

      await waitFor(() => expect(screen.queryByText(/No se puede deshacer/)).toBeNull());
      expect(api.rejectOrder).not.toHaveBeenCalled();
    });

    it('una orden fuera de revisión ya no se puede rechazar', async () => {
      api.getReviewOrder.mockResolvedValue(
        order({ backoffice: { inReview: false, decidedBy: 'bo@duwest.com', decidedAt: null } }),
      );
      await renderDetail();
      expect(button('Rechazar orden').disabled).toBe(true);
    });

    it('si el servidor rechaza la operación, el error queda en el modal', async () => {
      await renderDetail();
      fireEvent.click(button('Rechazar orden'));
      fireEvent.change(motivoInput(), { target: { value: 'sin stock' } });
      api.rejectOrder.mockRejectedValue(new Error('409'));

      fireEvent.click(button('Sí, rechazar la orden'));
      await screen.findByText('No se pudo rechazar la orden.');
      // El modal sigue abierto: el motivo escrito no se pierde.
      expect(button('Sí, rechazar la orden')).toBeTruthy();
    });
  });

  it('una orden que ya no está en revisión se muestra en solo lectura', async () => {
    api.getReviewOrder.mockResolvedValue(
      order({ backoffice: { inReview: false, decidedBy: 'bo@duwest.com', decidedAt: '2026-09-15T17:00:00Z' } }),
    );
    await renderDetail();
    expect(screen.getByText(/ya no está en revisión/)).toBeTruthy();
    expect(centerSelect().disabled).toBe(true);
    expect(destinationSelect().disabled).toBe(true);
  });
});
