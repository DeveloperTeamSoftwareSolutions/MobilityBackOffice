# Órdenes rechazadas por SAP — Spec

> Última actualización: 2026-09-15 · Versión: 2.26.0
> Estado: **vista previa con datos de ejemplo** (solo front). Sin integración con la API.

## Qué resuelve

Cuando MobilityIA envía una orden a SAP y SAP la rechaza, la orden pasa a **revisión de
BackOffice**: MobilityIA la deja en solo lectura y el control pasa a BackOffice. BackOffice:

1. ve la cabecera y los ítems de la orden **sin precios, descuentos ni totales**;
2. ve el motivo del rechazo de SAP, con los intentos anteriores;
3. cambia **por ítem** el centro de distribución y el destino de entrega;
4. reenvía la orden a SAP. Si SAP la acepta, queda procesada; si la rechaza, se ve el
   motivo nuevo.

## Decisiones del equipo (2026-09-15)

| # | Decisión |
|---|---|
| 1 | Una orden con varios centros se divide en varios pedidos de SAP, uno por centro. Lo programa MobilityIA. |
| 2 | Todo rechazo de SAP va a BackOffice, con su motivo. |
| 3 | BackOffice reenvía directo a SAP con el envío de BackOffice del Middleware. |
| 4a | Solo se ofrecen los **centros permitidos del cliente**. |
| 4b | Se puede elegir un centro **sin stock**, con aviso: SAP revalida con el stock real. |
| 4c | Se elige solo el **centro**, no el almacén. |
| 4d | Destinos filtrados por **sociedad + canal + sector** de la orden, desde `CustomerDeliveryDestinations`. |
| 4e | El Middleware valida centro y destino, no solo la pantalla. |
| 6 | Por ahora BackOffice solo **reasigna**: no rechaza ni anula. |

Sin decidir: el **rol** que opera la sección (hoy solo SuperAdmin), si BackOffice podrá
rechazar o anular, y el aviso por correo a BackOffice cuando llega una orden.

## Pantallas (vista previa)

**Bandeja** (`/ordenes-rechazadas-sap`): orden y fecha del rechazo, cliente, área de venta,
vendedor, motivo del rechazo e intentos. Búsqueda por orden, cliente o vendedor.

**Detalle:**
- Cabecera: cliente, vendedor, área de venta, fecha, centro y destino de cabecera.
- Motivo del rechazo: el último intento a la vista, los anteriores plegados.
- Ítems: producto, cantidad y dos selectores por línea. El de centro muestra el stock de
  ese producto en cada centro; el de destino, los del área de venta de la orden.
- Barra de acciones fija: cantidad de ítems modificados, **Descartar cambios** y
  **Reenviar a SAP**, que abre una confirmación con cada cambio (antes → después).

**Avisos por línea** (`revision-sap.logic.ts`):

| Aviso | ¿Bloquea el reenvío? |
|---|---|
| Sin centro o sin destino | Sí |
| Centro fuera de los permitidos del cliente | Sí |
| Destino fuera del área de venta de la orden | Sí |
| Centro sin stock del producto | No (decisión 4b) |
| Stock menor que la cantidad pedida | No (decisión 4b) |

Si la orden trae un centro o destino que ya no está en las listas, se muestra igual como
opción marcada ("no permitido para el cliente" / "fuera del área de venta").

## Archivos

`apps/web/src/components/revision-sap/`:

| Archivo | Qué hace |
|---|---|
| `RevisionSapPanel.tsx` | Contenedor: bandeja o detalle |
| `ReviewQueueList.tsx` | Tabla de la bandeja |
| `ReviewOrderDetail.tsx` | Cabecera, motivo del rechazo, ítems y acciones |
| `ReviewItemsTable.tsx` | Ítems con los selectores de centro y destino |
| `ResendConfirmModal.tsx` | Confirmación con el resumen de cambios |
| `PreviewNotice.tsx` | Aviso de datos de ejemplo |
| `revision-sap.api.ts` | Acceso a datos. Hoy lee los de ejemplo; mismas firmas que la integración |
| `revision-sap.ejemplo.ts` | Datos de ejemplo (clientes y direcciones inventados) |
| `revision-sap.logic.ts` | Reglas puras: cambios, avisos, filtro |
| `revision-sap.types.ts` | Tipos |

Tests: `revision-sap.logic.test.ts`, `ReviewOrderDetail.test.tsx`.

## Para conectarla — qué falta en el Middleware

| Necesidad | Estado |
|---|---|
| Destinos por área de venta | **Hecho**: `GET /api/v2/mobility/customer-delivery-destinations` (MW PR #642, 1.347.0) |
| Reenvío de BackOffice | **Existe**: `POST /api/v2/mobility/businessorders2sap` con `x-api-key` y `{ guidBusinessOrders, asBackoffice: true, actorEmail }` |
| Bandeja: órdenes con `ProcessedBackoffice = 0`, con el último `SapLastError` | Falta |
| Detalle sin precios, con centro y destino por línea e intentos de SAP | Falta |
| Centros permitidos de un cliente (regla de `warehouseCustomers.getAllowedWarehousesForCustomer`, agrupada por centro) con stock por producto | Falta |
| Guardar centro y destino por línea, validando contra las listas (4e) y registrando `BackofficeDecidedBy/At` | Falta |

## Bloqueos a resolver con el equipo

- **Nadie divide la orden por centro todavía.** A SAP viaja un solo pedido con el centro y
  el destino de **cabecera**, y MobilityIA no manda centro por línea. Hasta que exista la
  división, cambiar el centro o destino de un ítem no llega a SAP.
- Riesgo de **pedidos duplicados** en SAP en un reenvío (sin bloqueo por orden y con
  timeouts distintos entre MobilityIA y el Middleware).
- La liberación de crédito **vence a las 24 h**: una revisión más larga hace fallar el reenvío.
