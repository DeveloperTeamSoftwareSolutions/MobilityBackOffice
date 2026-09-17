# Órdenes rechazadas por SAP — Spec

> Última actualización: 2026-09-17 · Versión: 2.31.0
> Estado: **todo conectado, reenvío a SAP incluido** (requiere Middleware ≥ 1.356.0,
> PR #646, y `MIDDLEWARE_API_KEY` configurada en los dos lados).
> Falta la división por centro (Gustavo): hoy el reenvío sale como una sola orden SAP.

## Qué resuelve

Cuando MobilityIA envía una orden a SAP y SAP la rechaza (o la crea sin entrega), el
Middleware deja `ProcessedBackoffice = 0`: la orden pasa a **revisión de BackOffice**,
MobilityIA la deja en solo lectura y el vendedor ya no puede reenviarla. BackOffice:

1. ve la cabecera y los ítems de la orden **sin precios, descuentos ni totales**;
2. ve el motivo del rechazo de SAP, con los intentos anteriores;
3. corrige **por ítem** el centro de distribución y el destino de entrega *(conectado)*;
4. ve en cuántas órdenes SAP salió la orden y el estado de cada una *(conectado)*;
5. reenvía la orden completa a SAP *(conectado)*.

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
  cabecera y **agrupa factura**, que es lo **único editable de la cabecera**.
  - Cambiarlo **no** va con "Guardar cambios": se confirma aparte, con un aviso que
    enumera qué implica, porque no corrige una línea sino cómo se envía la orden entera.
  - Lo que dice el aviso está verificado en el código, no es interpretación:

    | `GroupInvoice` | Qué pasa si una línea queda sin stock |
    |---|---|
    | **Sí** | La orden **no se envía a SAP**: rebota completa y no se crea ninguna orden SAP (`orderBusiness2Sap.js`). El vendedor tampoco puede elegir seguir sin los faltantes: MobilityIA le bloquea el envío (`sapDispatchFlow` → `blocked_group_invoice`). Si se cae una línea, la orden queda `Rejected` con su comentario |
    | **No** | Las líneas sin stock **se filtran**, el total se recalcula y sale una orden SAP con el resto |

  - El motivo es opcional y queda en la auditoría y en el hilo, donde lo ve el vendedor.
- Motivo del rechazo **separado en tipo y mensaje**: el Middleware lo manda como
  `[E] texto` y une varias líneas con ` | `. El tipo cambia qué hacer (`E` hay que
  corregirla, `W` es un aviso), así que se muestra como etiqueta, no entre corchetes.
- **Dos pestañas**, con papeles distintos:
  - **Productos** — los ítems de la orden, que es como se va a volver a enviar. Se corrige
    el **centro** y el **destino** de cada línea, esté aceptada o rechazada la orden SAP en
    la que cayó, y se guardan con **Guardar cambios**, línea por línea; si una falla, su
    error queda en la línea y el cambio sigue pendiente. El destino se elige entre los del
    área de venta de la orden; el centro, entre los permitidos del cliente, y una línea sin
    centro propio sale con el de cabecera. **"Ver stock"** por producto abre un modal con el
    stock por centro y almacén (disponible, en inspección, en tránsito), marcando los
    almacenes habilitados para el cliente; sale de la misma fuente que ve el vendedor en
    MobilityIA.
  - **Órdenes SAP** — **solo consulta**: cada fila de `SAPOrders` con su **centro**, su
    estado (aceptada, aceptada sin entrega, rechazada, sin respuesta), número de pedido y
    entrega, motivo y sus productos. Es el historial de cómo salió cada intento.
  - **Reenviar es de la orden COMPLETA** (confirmado con el equipo el 2026-09-17): se
    manda la `BusinessOrder` y el Middleware decide en cuántas órdenes SAP sale. El botón
    vive en la barra de acciones, junto a Guardar, y **está conectado**.

**Reenvío a SAP** (`POST /api/revision-sap/orders/:guid/resend`, sin body):

- Una sola llamada al envío del Middleware —el **mismo** que usa el vendedor— con
  `asBackoffice: true` + `x-api-key`. Ese endpoint manda el pedido, estampa el resultado,
  deja el comentario en el hilo del vendedor, mueve la cabecera y **cierra la revisión si
  SAP acepta**: el envío exitoso *es* el cierre, no un trámite aparte.
- **Confirma antes**, porque crea un pedido real en SAP que no se deshace desde acá. El
  aviso dice si hay cambios sin guardar (se reenviaría sin ellos), cuántos productos
  siguen con un aviso que bloquea, y qué implica el valor de agrupa factura.
- **No se bloquea** por cambios sin guardar ni por avisos: se informan y decide el
  operador. Lo único que apaga el botón es que la orden ya no esté en revisión.
- El resultado se muestra **en el mismo modal**, no en un toast: el N° de pedido es lo que
  BackOffice copia, y el motivo del rechazo es lo que hay que leer para corregir.

| Respuesta | Qué se muestra |
|---|---|
| SAP aceptó, con entrega | N° de pedido y de entrega. La orden **sale de la bandeja** |
| SAP aceptó, **sin** entrega | Aviso: el pedido existe pero no se despacha; la entrega se resuelve en SAP y la orden **sigue en revisión** |
| SAP rechazó | El motivo con su tipo (`[E] …`); sigue en revisión |
| No se envió (`skipped`) | Agrupa factura con faltantes, o ningún ítem con stock |
| 409 `SAP_ORDER_ALREADY_EXISTS` | El pedido ya existe: reenviarlo lo duplicaría |
| Sin respuesta | *"Verificá en SAP si el pedido se creó antes de reintentar"* — **no** se reintenta a ciegas |

- Auditoría `REVISION_SAP_RESEND`, **siempre**: acepte o rechace SAP. Un rechazo auditado
  es lo que explica por qué la orden sigue en la bandeja.
- ⚠️ El Middleware sólo reconoce el envío como de BackOffice si **`MIDDLEWARE_API_KEY`
  está configurada en los dos lados** y coincide (`envioDeBackoffice`). Sin eso lo trata
  como un envío común y le aplica el vencimiento de crédito de 24 h.
- Stock: la pantalla pide primero centros y destinos (inmediato) y después el stock de
  SAP, que puede tardar o fallar sin trabar el resto.
- Una orden que ya salió de revisión se muestra en solo lectura.

**Todo cambio de BackOffice queda en el hilo que ve el vendedor.** Los tres —centro,
destino y agrupa factura— crean un comentario con `orderComments.create`, autor
"Backoffice" (rol `manager`: el hilo no tiene rol propio de BackOffice). Verificado
2026-09-17 de punta a punta: el pull de MobilityIA
(`GET /api/mobility/order-comments/by-user`, canal `ordercomments` del SyncEngine) los
baja al vendedor junto con los suyos y los de Créditos. El scope necesita
`guidUsers` / `sellerEmail` / `sellerSapUserId`: con uno solo de esos datos vacío la
consulta devuelve lo mismo, pero sin ninguno devuelve `[]`.

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
| `PUT /api/revision-sap/orders/:guid/group-invoice` | `PUT …/group-invoice` | Agrupa factura (cabecera) |
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
| `GroupInvoiceModal.tsx` | Confirmación de agrupa factura, con lo que implica cada valor |
| `ResendModal.tsx` | Confirmación del reenvío y, después, qué contestó SAP |
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
