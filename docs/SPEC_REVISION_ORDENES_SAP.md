# Órdenes rechazadas por SAP — Spec

> Última actualización: 2026-09-16 · Versión: 2.28.0
> Estado: **bandeja, detalle, centro y destino por ítem y órdenes SAP conectados**
> (requiere Middleware ≥ 1.348.0, PR #646). **El reenvío a SAP todavía no.**

## Qué resuelve

Cuando MobilityIA envía una orden a SAP y SAP la rechaza (o la crea sin entrega), el
Middleware deja `ProcessedBackoffice = 0`: la orden pasa a **revisión de BackOffice**,
MobilityIA la deja en solo lectura y el vendedor ya no puede reenviarla. BackOffice:

1. ve la cabecera y los ítems de la orden **sin precios, descuentos ni totales**;
2. ve el motivo del rechazo de SAP, con los intentos anteriores;
3. corrige **por ítem** el centro de distribución y el destino de entrega *(conectado)*;
4. ve en cuántas órdenes SAP salió la orden y el estado de cada una *(conectado)*;
5. reenvía la orden a SAP *(pendiente)*.

## Respuestas del jefe (2026-09-15)

| # | Tema | Definición | Estado |
|---|---|---|---|
| 1 | División por centro | El Middleware parte la orden en **una orden SAP por centro** (no por destino). Cada una es una fila de `SAPOrders` con `GuidBusinessOrders`. Si una sale y otra se rechaza, la orden se ve "procesada"; MobilityIA y BackOffice muestran las órdenes SAP y su estado | Lo programa **Gustavo**. BackOffice ya guarda el centro por ítem y muestra la pestaña |
| 2 | Stock | El reenvío de BackOffice avisa los ítems sin stock y pregunta antes de enviar, igual que MobilityIA | Pendiente, con el reenvío. ⚠️ En MobilityIA la pregunta llega **después** de crear el pedido en SAP (ver abajo) |
| 3 | Duplicados | Reenviar una orden que ya existe en SAP devuelve error | **Parcial**: `SAP_ORDER_ALREADY_EXISTS` existe solo para el envío de BackOffice (ver abajo) |
| 4 | Estado `PendingBackofficeReview` | Lo asigna el Middleware cuando SAP rechaza | Lo termina **Silvina** |
| 5 | Crédito 24 h | El reenvío de BackOffice saltea el vencimiento; la orden no vuelve a Créditos | **Hecho** en el Middleware (PR #646) |
| 6 | Rechazar / anular | BackOffice no rechaza ni anula; "se rechaza desde SAP" | Falta aclarar qué pasa con una orden que BackOffice no puede corregir |
| 7 | Correo a BackOffice | Sí debe llegar | Casilla a definir |

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
| 5 | Rol propio: `MOBILITYBO_REVISION_SAP` (`RevisionSap`). `Usuario` no lo recibe. |
| 6 | Por ahora BackOffice solo **reasigna**: no rechaza ni anula. |

## Pantallas

**Bandeja** (`/ordenes-rechazadas-sap`): orden y fecha del rechazo, cliente, área de venta,
vendedor, motivo e intentos. Búsqueda, orden y paginación en el servidor.

**Detalle:**
- Cabecera sin precios: cliente, vendedor, área de venta con nombres, fecha, centro de
  cabecera y **si agrupa factura** (con factura agrupada la orden no puede salir parcial).
- Motivo del rechazo **separado en tipo y mensaje**: el Middleware lo manda como
  `[E] texto` y une varias líneas con ` | `. El tipo cambia qué hacer (`E` hay que
  corregirla, `W` es un aviso), así que se muestra como etiqueta, no entre corchetes.
- Ítems:
  - **Destino:** selector con los destinos del área de venta de la orden. Se guarda con
    **Guardar cambios**, línea por línea; si una falla, su error queda en la línea y el
    cambio sigue pendiente.
  - **Centro:** selector con los centros permitidos del cliente. Una línea sin centro
    propio sale con el de cabecera.
- **Dos pestañas**, con papeles distintos:
  - **Productos** — los ítems de la orden, que es como se va a volver a enviar. Se corrige
    el **centro** y el **destino** de cada línea, esté aceptada o rechazada la orden SAP en
    la que cayó. **"Ver stock"** por producto abre un modal con el stock por centro y
    almacén (disponible, en inspección, en tránsito), marcando los almacenes habilitados
    para el cliente; sale de la misma fuente que ve el vendedor en MobilityIA.
  - **Órdenes SAP** — **solo consulta**: cada fila de `SAPOrders` con su **centro**, su
    estado (aceptada, aceptada sin entrega, rechazada, sin respuesta), número de pedido y
    entrega, motivo y sus productos. Es el historial de cómo salió cada intento.
  - **Reenviar es por orden SAP**, no por la orden entera: cada orden SAP es lo que SAP
    acepta o rechaza. El botón vive en cada rechazada, en esa pestaña *(deshabilitado
    hasta que el Middleware parta la orden por centro)*.
- Stock: la pantalla pide primero centros y destinos (inmediato) y después el stock de
  SAP, que puede tardar o fallar sin trabar el resto.
- **Reenviar a SAP:** abre la confirmación con el botón de confirmar deshabilitado. No se
  habilita con cambios sin guardar.
- Una orden que ya salió de revisión se muestra en solo lectura.

**Avisos por línea** (`revision-sap.logic.ts`):

| Aviso | ¿Bloquea guardar y reenviar? |
|---|---|
| Sin destino | Sí |
| Destino fuera del área de venta de la orden | Sí (el Middleware también lo rechaza) |
| Centro **elegido** fuera de los permitidos del cliente | Sí (el Middleware también lo rechaza) |
| Centro **heredado de la cabecera** fuera de los permitidos | No: avisa, puede ser el motivo del rechazo |
| Centro sin stock / stock menor a lo pedido | No (decisión 4b) |

## Arquitectura

```
web  revision-sap.api.ts ──> api  /api/revision-sap/*  (rol RevisionSap)
                                   RevisionSapController → Service (auditoría) → Client
                                   └──> Middleware /api/mobility/backoffice-review/*  (x-api-key)
```

| Endpoint BackOffice | Middleware | Qué hace |
|---|---|---|
| `GET /api/revision-sap/orders` | `GET /orders` | Bandeja |
| `GET /api/revision-sap/orders/:guid` | `GET /orders/:guid` | Detalle sin precios |
| `GET /api/revision-sap/orders/:guid/options?includeStock=1` | `GET /orders/:guid/options` | Centros, destinos y stock |
| `PUT /api/revision-sap/orders/:guid/items/:itemGuid/destination` | `PUT …/destination` | Cambia el destino de una línea |
| `PUT /api/revision-sap/orders/:guid/items/:itemGuid/center` | `PUT …/center` | Cambia el centro de una línea |
| `GET /api/revision-sap/orders/:guid/sap-orders` | `GET …/sap-orders` | Órdenes SAP de la orden |

- Quién hace el cambio sale **del token**, nunca del body.
- **Auditoría:**
  - BackOffice registra `REVISION_SAP_DESTINATION_CHANGE`, categoría `SapReview`.
  - El Middleware deja `BackofficeItemDestinationChange`, con antes y después, más un comentario en el hilo de la orden.
- Contrato del Middleware: `MobilityMiddleWare/docs/API_BACKOFFICE_REVIEW.md` (PR #646).

## Archivos

`apps/api/src/revision-sap/`: `revision-sap.controller.ts`, `.service.ts`, `.client.ts`,
`.types.ts`, `.module.ts`, y sus `*.spec.ts`.

`apps/web/src/components/revision-sap/`:

| Archivo | Qué hace |
|---|---|
| `RevisionSapPanel.tsx` | Contenedor: bandeja o detalle |
| `ReviewQueueList.tsx` | Tabla de la bandeja, con el motivo separado en tipo y mensaje |
| `ReviewOrderDetail.tsx` | Cabecera, motivo, las dos pestañas, guardado y acciones |
| `ReviewItemsTable.tsx` | Pestaña **Productos**: centro, destino y "Ver stock" por línea |
| `SapOrdersPanel.tsx` | Pestaña **Órdenes SAP**: estado y productos de cada una, solo consulta |
| `SapErrorMessage.tsx` | El motivo de SAP: tipo como etiqueta y mensaje |
| `ProductStockModal.tsx` | Stock por centro y almacén de un producto |
| `PreviewNotice.tsx` | Aviso de lo que todavía no está conectado |
| `revision-sap.api.ts` | Llamadas a la API |
| `revision-sap.logic.ts` | Reglas puras: cambios, avisos, stock |
| `revision-sap.types.ts` | Tipos |

## Deploy

1. **Middleware ≥ 1.348.0** (PR #646) con `MIDDLEWARE_API_KEY` configurada.
2. **SQL 008** (`008_AddRevisionSapRole.sql`) en la base del entorno, y asignar
   `MOBILITYBO_REVISION_SAP` en ITManager a quien opere la sección.
3. BackOffice 2.27.0.

Con un Middleware anterior, la bandeja responde 503 ("no está disponible").

## Pendiente

- **División por centro** (Gustavo): el envío tiene que partir la orden en una orden SAP
  por centro y guardar el centro en cada fila de `SAPOrders`. MobilityIA tiene que guardar
  el centro por línea (hoy queda vacío).
- **Stock — verificado en el código:** MobilityIA pregunta por los faltantes, pero
  **después** de `businessorders2sap`, que ya creó el pedido en SAP con los ítems con stock.
  Si el vendedor confirma, el envío se repite y puede crear un segundo pedido. En el
  reenvío de BackOffice el Middleware saca los ítems sin stock sin avisar.
- **Duplicados — verificado en el código:** `SAP_ORDER_ALREADY_EXISTS`
  (`orderBusiness2Sap.js`) frena solo el envío de BackOffice y mira un único
  `SapOrderNumber`. No cubre el envío del vendedor, un timeout con pedido creado, dos envíos
  a la vez ni una orden partida en varias órdenes SAP.
- **Estado `PendingBackofficeReview`** (Silvina).
- **Orden que BackOffice no puede corregir** (ej. cliente bloqueado): ¿se cierra la revisión
  sin enviar (`backoffice/close`)?
- **Casilla del correo** a BackOffice.
- **Guardado de MobilityIA:** su upsert reescribe los destinos de las líneas. Hoy no pisa
  el cambio de BackOffice porque la orden en revisión está en solo lectura.
