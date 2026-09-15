import { ReviewCatalogs, ReviewOrderDetail } from './revision-sap.types';

/**
 * Datos de ejemplo para la vista previa de la sección.
 *
 * El Middleware todavía no expone la bandeja de órdenes en revisión, el detalle sin
 * precios ni los centros permitidos de un cliente. Cada orden muestra un motivo de
 * rechazo distinto de los que se ven en el flujo real: material no ampliado en el
 * centro, destino fuera del área de venta, centro reservado y pedido sin entrega.
 * Clientes, vendedores y direcciones son inventados.
 */
export const EXAMPLE_ORDERS: ReviewOrderDetail[] = [
  {
    guid: '7f3c1a52-0b4e-4d8a-9c61-5e2f8a100001',
    orderNumber: 'ORD-00005241',
    customerCode: '10090011',
    customerName: 'Agroservicios del Norte, S.A.',
    sellerEmail: 'vendedor.norte@example.com',
    salesArea: { companyCode: '2100', channelCode: '10', sectorCode: '10' },
    sapError: 'Material 100245: no ampliado para el centro 2102.',
    rejectedAt: '2026-09-15T13:05:00Z',
    attempts: 1,
    itemCount: 3,
    orderDate: '2026-09-14T15:20:00Z',
    headerCenterCode: '2102',
    headerDestinationCode: '30001187',
    sapAttempts: [
      {
        attemptAt: '2026-09-15T13:05:00Z',
        message: 'Material 100245: no ampliado para el centro 2102.',
      },
    ],
    items: [
      {
        guid: 'item-5241-1',
        lineNumber: 1,
        productCode: '100245',
        productName: 'Glifosato 48% SL — bidón 20 L',
        quantity: 40,
        unitOfMeasure: 'UN',
        centerCode: '2102',
        destinationCode: '30001187',
      },
      {
        guid: 'item-5241-2',
        lineNumber: 2,
        productCode: '100312',
        productName: 'Mancozeb 80% WP — saco 25 kg',
        quantity: 25,
        unitOfMeasure: 'UN',
        centerCode: '2102',
        destinationCode: '30001187',
      },
      {
        guid: 'item-5241-3',
        lineNumber: 3,
        productCode: '100518',
        productName: 'Clorpirifos 48% EC — galón 3.78 L',
        quantity: 60,
        unitOfMeasure: 'UN',
        centerCode: '2102',
        destinationCode: '30001190',
      },
    ],
  },
  {
    guid: '7f3c1a52-0b4e-4d8a-9c61-5e2f8a100002',
    orderNumber: 'ORD-00005238',
    customerCode: '10090027',
    customerName: 'Finca La Esperanza',
    sellerEmail: 'vendedora.altiplano@example.com',
    salesArea: { companyCode: '2100', channelCode: '10', sectorCode: '11' },
    sapError:
      'Destinatario de mercancías 30000877 no definido para el área de ventas 2100/10/11.',
    rejectedAt: '2026-09-15T11:42:00Z',
    attempts: 2,
    itemCount: 2,
    orderDate: '2026-09-15T09:55:00Z',
    headerCenterCode: '2101',
    headerDestinationCode: '30000877',
    sapAttempts: [
      {
        attemptAt: '2026-09-15T11:42:00Z',
        message:
          'Destinatario de mercancías 30000877 no definido para el área de ventas 2100/10/11.',
      },
      {
        attemptAt: '2026-09-15T10:10:00Z',
        message:
          'Destinatario de mercancías 30000877 no definido para el área de ventas 2100/10/11.',
      },
    ],
    items: [
      {
        guid: 'item-5238-1',
        lineNumber: 1,
        productCode: '200118',
        productName: 'Semilla maíz híbrido — bolsa 60 mil semillas',
        quantity: 120,
        unitOfMeasure: 'BOL',
        centerCode: '2101',
        destinationCode: '30000877',
      },
      {
        guid: 'item-5238-2',
        lineNumber: 2,
        productCode: '200140',
        productName: 'Semilla sorgo — saco 22.7 kg',
        quantity: 30,
        unitOfMeasure: 'SAC',
        centerCode: '2101',
        destinationCode: '30000877',
      },
    ],
  },
  {
    guid: '7f3c1a52-0b4e-4d8a-9c61-5e2f8a100003',
    orderNumber: 'ORD-00005229',
    customerCode: '10090043',
    customerName: 'Distribuidora Agrícola Oriental',
    sellerEmail: 'vendedor.oriente@example.com',
    salesArea: { companyCode: '2800', channelCode: '10', sectorCode: '10' },
    sapError: 'Centro 2803 bloqueado para el cliente 10090043 (almacén reservado).',
    rejectedAt: '2026-09-14T21:18:00Z',
    attempts: 1,
    itemCount: 2,
    orderDate: '2026-09-14T19:40:00Z',
    headerCenterCode: '2803',
    headerDestinationCode: '30004410',
    sapAttempts: [
      {
        attemptAt: '2026-09-14T21:18:00Z',
        message: 'Centro 2803 bloqueado para el cliente 10090043 (almacén reservado).',
      },
    ],
    items: [
      {
        guid: 'item-5229-1',
        lineNumber: 1,
        productCode: '100245',
        productName: 'Glifosato 48% SL — bidón 20 L',
        quantity: 80,
        unitOfMeasure: 'UN',
        centerCode: '2803',
        destinationCode: '30004410',
      },
      {
        guid: 'item-5229-2',
        lineNumber: 2,
        productCode: '100701',
        productName: 'Paraquat 20% SL — galón 3.78 L',
        quantity: 50,
        unitOfMeasure: 'UN',
        centerCode: '2803',
        destinationCode: '30004410',
      },
    ],
  },
  {
    guid: '7f3c1a52-0b4e-4d8a-9c61-5e2f8a100004',
    orderNumber: 'ORD-00005217',
    customerCode: '10090058',
    customerName: 'Agropecuaria Santa Lucía',
    sellerEmail: 'vendedor.norte@example.com',
    salesArea: { companyCode: '2100', channelCode: '10', sectorCode: '10' },
    sapError: 'SAP creó el pedido pero no devolvió número de entrega.',
    rejectedAt: '2026-09-14T16:02:00Z',
    attempts: 1,
    itemCount: 1,
    orderDate: '2026-09-14T14:30:00Z',
    headerCenterCode: '2101',
    headerDestinationCode: '30000215',
    sapAttempts: [
      {
        attemptAt: '2026-09-14T16:02:00Z',
        message: 'SAP creó el pedido pero no devolvió número de entrega.',
      },
    ],
    items: [
      {
        guid: 'item-5217-1',
        lineNumber: 1,
        productCode: '100312',
        productName: 'Mancozeb 80% WP — saco 25 kg',
        quantity: 10,
        unitOfMeasure: 'UN',
        centerCode: '2101',
        destinationCode: '30000215',
      },
    ],
  },
];

const CENTROS_GUATEMALA = [
  { centerCode: '2101', centerName: 'CD Villa Nueva' },
  { centerCode: '2102', centerName: 'CD Escuintla' },
  { centerCode: '2104', centerName: 'CD Quetzaltenango' },
];

/** Catálogos por orden (guid): centros del cliente y destinos de su área de venta. */
export const EXAMPLE_CATALOGS: Record<string, ReviewCatalogs> = {
  '7f3c1a52-0b4e-4d8a-9c61-5e2f8a100001': {
    centers: CENTROS_GUATEMALA,
    destinations: [
      {
        destinationCode: '30001187',
        destinationName: 'Bodega central Villa Nueva',
        deliveryAddress: 'Km 17.5 Carretera al Pacífico, Villa Nueva',
      },
      {
        destinationCode: '30001190',
        destinationName: 'Finca San Rafael',
        deliveryAddress: 'Aldea El Rosario, Escuintla',
      },
      {
        destinationCode: '30001204',
        destinationName: 'Sucursal Mazatenango',
        deliveryAddress: '4a calle 3-20 zona 1, Mazatenango',
      },
    ],
    stock: {
      '100245': { '2101': 320, '2102': 0, '2104': 15 },
      '100312': { '2101': 80, '2102': 140, '2104': 0 },
      '100518': { '2101': 200, '2102': 75, '2104': 60 },
    },
  },
  '7f3c1a52-0b4e-4d8a-9c61-5e2f8a100002': {
    centers: [CENTROS_GUATEMALA[0], CENTROS_GUATEMALA[2]],
    destinations: [
      {
        destinationCode: '30000912',
        destinationName: 'Bodega Chimaltenango',
        deliveryAddress: 'Km 54 Carretera Interamericana, Chimaltenango',
      },
      {
        destinationCode: '30000930',
        destinationName: 'Centro de acopio Sololá',
        deliveryAddress: 'Salida a Panajachel, Sololá',
      },
    ],
    stock: {
      '200118': { '2101': 90, '2104': 400 },
      '200140': { '2101': 50, '2104': 0 },
    },
  },
  '7f3c1a52-0b4e-4d8a-9c61-5e2f8a100003': {
    centers: [
      { centerCode: '2801', centerName: 'CD Soyapango' },
      { centerCode: '2802', centerName: 'CD San Miguel' },
    ],
    destinations: [
      {
        destinationCode: '30004410',
        destinationName: 'Bodega San Miguel',
        deliveryAddress: 'Av. Roosevelt Sur 12, San Miguel',
      },
      {
        destinationCode: '30004425',
        destinationName: 'Sucursal Usulután',
        deliveryAddress: 'Calle Dr. Federico Penado, Usulután',
      },
    ],
    stock: {
      '100245': { '2801': 500, '2802': 60 },
      '100701': { '2801': 0, '2802': 120 },
    },
  },
  '7f3c1a52-0b4e-4d8a-9c61-5e2f8a100004': {
    centers: [CENTROS_GUATEMALA[0], CENTROS_GUATEMALA[1]],
    destinations: [
      {
        destinationCode: '30000215',
        destinationName: 'Finca Santa Lucía',
        deliveryAddress: 'Santa Lucía Cotzumalguapa, Escuintla',
      },
    ],
    stock: {
      '100312': { '2101': 80, '2102': 140 },
    },
  },
};
