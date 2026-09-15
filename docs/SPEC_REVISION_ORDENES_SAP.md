# Órdenes rechazadas por SAP — Spec

> Última actualización: 2026-09-15 · Versión: 2.27.0
> Estado: **bandeja, detalle y destino por ítem conectados** (requiere Middleware ≥ 1.348.0).
> **El reenvío a SAP y el centro por ítem todavía no.**

## Qué resuelve

Cuando MobilityIA envía una orden a SAP y SAP la rechaza (o la crea sin entrega), el
Middleware deja `ProcessedBackoffice = 0`: la orden pasa a **revisión de BackOffice**,
MobilityIA la deja en solo lectura y el vendedor ya no puede reenviarla. BackOffice:

1. ve la cabecera y los ítems de la orden **sin precios, descuentos ni totales**;
2. ve el motivo del rechazo de SAP, con los intentos anteriores;
3. corrige **por ítem** el destino de entrega *(conectado)* y el centro *(pendiente)*;
4. reenvía la orden a SAP *(pendiente)*.

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
- Cabecera sin precios: cliente, vendedor, área, fecha, centro y destino de cabecera.
- Motivo del rechazo: el último a la vista, los anteriores plegados.
- Ítems:
  - **Destino:** selector con los destinos del área de venta de la orden. Se guarda con
    **Guardar cambios**, línea por línea; si una falla, su error queda en la línea y el
    cambio sigue pendiente.
  - **Centro:** se muestra el efectivo (el de la línea o, si no tiene, el de cabecera) y
    el stock en cada centro permitido. **No se edita**: hoy SAP recibe solo el centro de
    cabecera.
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
| Centro fuera de los permitidos del cliente | No: avisa, puede ser el motivo del rechazo |
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
| `ReviewQueueList.tsx` | Tabla de la bandeja, con orden y paginación |
| `ReviewOrderDetail.tsx` | Cabecera, motivo, ítems, guardado y acciones |
| `ReviewItemsTable.tsx` | Ítems: centro con stock y selector de destino |
| `ResendConfirmModal.tsx` | Confirmación del reenvío (deshabilitada) |
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

## Pendiente — definiciones del equipo

- **División por centro** *(bloquea el centro por ítem y el reenvío)*: hoy a SAP viaja un
  solo pedido con centro y destino de cabecera, y MobilityIA no guarda centro por línea.
  ¿Quién la programa? ¿Dónde se guardan varios números de SAP? ¿Qué pasa si SAP acepta
  un pedido y rechaza otro?
- **Ítems sin stock en el reenvío:** hoy el Middleware los saca del pedido sin avisar.
- **Pedidos duplicados:** sin bloqueo por orden ni consulta previa a SAP.
- **Vencimiento de 24 h de la liberación de crédito** en el reenvío de BackOffice.
- **Estado `PendingBackofficeReview`:** nadie lo asigna; la marca real es `ProcessedBackoffice = 0`.
- **Rechazar o anular** desde BackOffice, y **aviso por correo** a BackOffice.
- **Guardado de MobilityIA:** su upsert reescribe los destinos de las líneas. Hoy no pisa
  el cambio de BackOffice porque la orden en revisión está en solo lectura.
