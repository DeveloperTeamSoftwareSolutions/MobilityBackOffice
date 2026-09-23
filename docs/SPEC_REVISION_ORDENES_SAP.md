# Órdenes rechazadas por SAP — Spec

> Última actualización: 2026-09-21 · Versión: 2.39.0
> Estado: **la sección completa, conectada** — bandeja, detalle, correcciones, rechazo y
> **reenvío por centro**. Requiere **Middleware ≥ 1.361.1** y `MIDDLEWARE_API_KEY`
> configurada en los dos lados.

## Qué resuelve

Cuando MobilityIA envía una orden a SAP y SAP la rechaza (o la crea sin entrega), el
Middleware deja `ProcessedBackoffice = 0`: la orden pasa a **revisión de BackOffice**,
MobilityIA la deja en solo lectura y el vendedor ya no puede reenviarla. BackOffice:

1. ve la cabecera y los ítems de la orden **sin precios, descuentos ni totales**;
2. ve el motivo del rechazo de SAP, con los intentos anteriores;
3. corrige **por ítem** el centro de distribución y el destino de entrega *(conectado)*;
4. ve en cuántas órdenes SAP salió la orden y el estado de cada una *(conectado)*;
5. **rechaza** la orden si no se puede resolver, con motivo obligatorio *(conectado)*;
6. reenvía la orden a SAP, **partida en una orden SAP por centro** *(conectado)*.

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
| 6 | ~~Por ahora BackOffice solo **reasigna**: no rechaza ni anula.~~ **Revocada el 2026-09-18** (ver abajo). |

### Rechazar una orden — decisión 2026-09-18

El equipo confirmó lo contrario de la decisión 6: BackOffice **sí** puede cerrar una orden que
no se puede resolver. Pedido textual: *"que vuelva al vendedor con su estado y este no pueda
hacer nada más que copiarla, y que quede en los comentarios que fue rechazada desde backoffice
por tal motivo"*.

**Se eligió rechazar (`Rejected`) y no anular (`Annulled`).** Las dos son terminales e
irreversibles, y en las dos el vendedor sólo puede copiar. La diferencia es qué cuenta la orden
después: `Rejected` dice que alguien la evaluó y dijo que no —y se ve en rojo—, mientras que
`Annulled` se lee como una baja del vendedor, igual que si él mismo la hubiera dado de baja.

**No hubo que tocar MobilityIA.** El Middleware traduce `Rejected` al estado legacy
`AuthorizationRejected` (`TO_LEGACY_ORDER`), y MobilityIA ya lo trata como documento cerrado: no
admite pagos ni anulación, y Copiar sigue disponible siempre (directiva 2026-08-19). El
comportamiento pedido ya existía; lo único que faltaba era poder llegar a ese estado desde
BackOffice.

| | Decisión |
|---|---|
| Estado | `Rejected` — el mismo que un rechazo de Créditos. **No se distinguen**: quién y por qué se leen en el comentario |
| Motivo | **Obligatorio.** El estado sólo dice "Rechazada", así que el hilo es lo único que el vendedor puede leer |
| Reversible | No. `Rejected` no tiene transiciones de salida y está en `ORDER_TERMINAL` |
| Dónde | Botón propio en la barra de acciones del detalle, separado y en rojo. Se apaga cuando la orden ya no está en revisión |

El hecho se registra en `BusinessOrders.BackofficeRejectedAt` y la proyección lo traduce a
`Rejected` — mismo patrón que `CancelledAt` y `CreditDeniedAt`. Escribir el estado a mano lo
pisaría el siguiente recompute. Ver `docs/DEPLOY_SQL_PENDIENTE.md`: la migración vive en el repo
del Middleware y **falta aplicarla**.

## Pantallas

**Bandeja** (`/ordenes-rechazadas-sap`), en **dos pestañas**. Las separa el parámetro
`view`, que sale de la misma columna del Middleware (`ProcessedBackoffice`: `0` pendiente,
`1` resuelta). Búsqueda, orden y paginación son del servidor en las dos.

| | **Pendientes** | **Resueltas** |
|---|---|---|
| Qué son | Las que BackOffice tiene que resolver | Las que ya resolvió: el registro de qué pasó |
| Columnas propias | Motivo del rechazo, Intentos | Cómo se resolvió, Estado hoy, Resuelta por, Fecha |
| Orden por defecto | Último rechazo | Última resolución (`decidedAt`) |

Las dos comparten Orden, Cliente, Área de venta y Vendedor. En resueltas se dejan de
mostrar el motivo y los intentos: ya no hay nada que accionar con eso.

**Cómo se resolvió** sale de si el Middleware guardó número de pedido:

| Se muestra | Cuándo |
|---|---|
| **Enviada a SAP** | Hay pedido y entrega |
| **Sin entrega** | Hay pedido pero no entrega: se resuelve en SAP |
| **Cerrada sin enviar** | No hay pedido: la revisión se cerró sin mandar nada |

Se muestra **aparte del estado de hoy**, porque pueden no coincidir: la orden sigue viva
y pudo moverse después de resolverse. Es el mismo criterio que usan las Autorizaciones de
MobilityManager.

> ⚠️ Si `view` dejara de viajar en algún tramo (front → API → Middleware), el servidor
> devuelve pendientes y **las dos pestañas muestran lo mismo sin fallar**. Hay tests en
> los dos lados que lo cubren.

**Detalle:**
- **Estado de la orden**, con la etiqueta de la tabla `Status` ("Enviado a SAP",
  "Pendiente revisión Backoffice", "Procesada"). Se muestra en la cabecera porque es lo
  que cambia al reenviar: si SAP acepta pasa a `SentToSAP`, y si rechaza se queda en
  `PendingBackofficeReview`. El código crudo queda en el `title`.
  - **Una sola etiqueta, nunca dos.**
    - **En revisión:** se muestra **sólo** "En revisión por BackOffice". El `StatusCode`
      no se muestra (queda en el `title`): no agrega nada y confunde. Las órdenes nuevas
      quedan en `PendingBackofficeReview`, que diría lo mismo dos veces; las viejas en
      `Processed`, que se lee como "terminada" cuando es lo contrario — MobilityIA se lo
      muestra al vendedor como *"Pendiente envío a SAP"*.
    - **Fuera de revisión:** el estado es lo único que importa y toma la píldora.
  - Las transiciones las hace el **Middleware**, no BackOffice
    (`markSentToSapAfterBackoffice` / `markPendingBackofficeReview`).
  - El mapa código → etiqueta vive en `revision-sap.logic.ts`: BackOffice no tenía
    ninguno (Soporte muestra el código crudo).
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
    centro propio sale con el de cabecera.
  - **"Ver stock y elegir"** por producto abre el modal de stock, que sirve para las dos
    cosas: mirar y **elegir el centro desde ahí**, viendo cuánto hay en cada uno en vez de
    decidir a ciegas en el selector.
    - Se agrupa **por centro**, sumando sus almacenes, porque el centro es lo que se
      elige (decisión 4c: el almacén no viaja a SAP). El detalle por almacén queda
      debajo —disponible, en inspección, en tránsito— para no perder de dónde sale el
      número.
    - **Elegible ≠ tiene stock.** Lo elegible sale de los centros permitidos del cliente
      (4a); un centro **sin stock se puede elegir igual**, marcado en ámbar con "no
      alcanza para N", porque SAP revalida al enviar (4b). Un centro con stock al que el
      cliente **no accede** se muestra apagado y no se puede elegir: saber que hay stock
      ahí igual sirve.
    - Un centro permitido que no aparece en el stock se lista **en cero**, no se esconde:
      que no tenga filas significa cero, no que no exista.
    - Elegir carga el centro en la línea como cualquier otro cambio: queda **sin
      guardar** hasta apretar "Guardar cambios".
    - El selector de la fila **sigue estando**: el modal es otra vía, para quien necesita
      ver el stock antes de decidir. En una orden en solo lectura, el modal sigue
      sirviendo para mirar.
    - Sale de la misma fuente que ve el vendedor en MobilityIA.
  - **Órdenes SAP** — **solo consulta**. Muestra **todas** las filas de `SAPOrders` con el
    `GuidBusinessOrders` de la orden, aceptadas y rechazadas, con su **centro**, número de
    pedido y entrega, motivo y sus productos. Es el historial de cómo salió cada intento.

    **Las rechazadas sí se guardan** (verificado en la base, 2026-09-17): el Middleware
    inserta en `SAPOrders` **antes** de llamar a SAP y actualiza después con el resultado
    —"deja rastro de todos los intentos"—. Esconderlas ocultaría justamente el motivo por
    el que la orden está en revisión.

    **Se agrupan POR INTENTO** (2026-09-22), con una línea divisoria que dice **cuándo**
    fue el envío y **desde qué app**. Una orden puede tener órdenes SAP del vendedor y de
    uno o más reenvíos de BackOffice —que además crean una por centro—; en una lista
    corrida todas parecen la misma tanda. El intento más reciente va arriba, y se numeran
    desde el más viejo, así el primero siempre es el 1.

    El **origen se deduce**: `SAPOrders` no guarda de qué app salió. La huella es el
    número interno, que compone el propio Middleware — `ORD…S<id>` para BackOffice (una
    fila por centro, y el número no puede repetirse) y el número de la orden tal cual para
    MobilityIA. Detalle y advertencias en `docs/API_BACKOFFICE_REVIEW.md` del Middleware.

    **Qué separa un intento de otro** (`groupSapOrdersByAttempt`): cambia la app, se
    repite un centro —el envío de BackOffice crea una por centro, así que dentro de un
    mismo envío no se repite— o pasan más de 5 minutos. Ese margen no es arbitrario: el
    envío llama a SAP una vez por centro, en serie, con hasta 120 s cada una, así que dos
    órdenes del mismo envío pueden quedar separadas por un par de minutos.

    El estado **se calcula**, no se lee de una columna. El Middleware lo deriva de tres
    campos de la fila, y las etiquetas son **las mismas que usa MobilityIA** para estas
    mismas órdenes SAP: dos pantallas que miran el mismo dato tienen que llamarlo igual.

    | Si la fila… | Se muestra |
    |---|---|
    | tiene `SapLastError` | **Rechazada por SAP** (rojo) + el motivo abajo |
    | tiene pedido pero no entrega | **Aceptada sin entrega** (ámbar) |
    | tiene pedido y entrega | **Aceptada** (verde) |
    | no tiene nada de eso | **Sin respuesta de SAP** (gris) |

    El **`StatusCode` crudo no se muestra** (queda en el `title`): no aporta y engaña —
    una orden SAP rechazada se queda en **`Draft`**, porque SAP no lo actualiza al
    rechazar, y se leería como "borrador".
  - **Reenviar es de la orden COMPLETA** (confirmado con el equipo el 2026-09-17): se
    manda la `BusinessOrder` y el Middleware la parte en una orden SAP por centro. El
    botón vive en la barra de acciones, junto a Guardar. Lo único que lo apaga es que la
    orden ya no esté en revisión.

**Reenvío a SAP** (`POST /api/revision-sap/orders/:guid/resend`, sin body) —
**CONECTADO el 2026-09-21**.

Pega contra `POST /api/v2/mobility/businessorders2sap-from-backoffice` (PR #681 del
Middleware): agrupa los ítems por `CenterCode` y hace **una llamada a SAP por cada centro
distinto**, con un N° de pedido sintético por centro (`ORD…S<id>`).

**Por qué estuvo cortado hasta hoy** — vale dejarlo escrito, porque explica el piso de
versión. Desde el 2026-09-17 el botón estuvo apagado: primero porque el envío por centro
no existía (el del vendedor manda todo junto bajo el centro de la cabecera), y después
porque ese endpoint **rebotaba todas las órdenes con 422**: armaba sus ítems con un `.map`
que no copiaba `centerCode` y luego validaba `it.centerCode` sobre ese mismo objeto, así
que leía `undefined` tuvieran o no centro en la base. Lo arregló el **PR #687**, que de
paso montó la ruta con `requireApiKey`.

⚠️ **Piso: Middleware 1.361.1.** Con una versión anterior el reenvío falla siempre, y el
mensaje que vería el operador además *miente*: le pide asignar centros que ya están
asignados.

### El resultado es POR CENTRO

La orden ya no sale como un pedido: sale como **uno por centro**, y cada uno se acepta o
se rechaza por su cuenta. Un resumen único escondería *cuál* falló, que es justo lo
accionable. Por eso `ResendResult` trae `buckets[]`, y el modal muestra una tarjeta por
centro con su estado, sus números y su motivo.

Tres trampas del contrato del Middleware, resueltas en el cliente para que no se filtren:

| Trampa | Cómo se resuelve |
|---|---|
| El `success` de arriba **miente**: viene `false` en ramas que sólo avisan de ítems sin stock, aunque SAP haya aceptado todo | `accepted` se calcula de los *buckets*, no del `success` |
| Un **fallo parcial** llega como **HTTP 200**, no como error | Se detecta comparando centros con pedido contra centros fallados |
| Los centros que salieron bien **quedan creados en SAP igual** | `partial: true`, y el modal avisa que reenviar la orden entera los duplicaría |

| Respuesta | Qué se muestra |
|---|---|
| Todos los centros aceptados | Una tarjeta por centro con su N° de pedido y de entrega. La orden **sale de la bandeja** |
| **Fallo parcial** | Aviso destacado: *lo que salió ya existe en SAP, corregí sólo los centros que fallaron*. Sigue en revisión |
| Un centro aceptado **sin** entrega | Se marca aparte: el pedido existe pero no se despacha; se resuelve en SAP. El Middleware lo da por bueno, BackOffice **no** |
| Centro rechazado | Su motivo con el tipo (`[E] …`), en su propia tarjeta |
| No se envió (`skipped`) | Agrupa factura con faltantes, o ningún ítem con stock. **No** se muestra como rechazo |
| 409 `SAP_ORDER_ALREADY_EXISTS` | El pedido ya existe: reenviarlo lo duplicaría |
| Sin respuesta | *"Verificá en SAP si el pedido se creó antes de reintentar"* — **no** se reintenta a ciegas |

### La previsualización del envío — 2026-09-22

Antes de confirmar, el modal muestra **cómo va a salir**: una tarjeta por orden SAP, con
su centro, **sus productos** y el **número de intento** que va a ser.

No es decoración. El envío hace dos cosas que **no se ven mirando la orden**: la parte por
centro de distribución, y deja afuera las líneas canceladas. Sin la previsualización,
"Reenviar a SAP" es un botón que crea pedidos reales a ciegas — y un clic sin querer los
crea igual.

- Se calcula **en el navegador** (`planResend`), no se le pide al servidor: las dos reglas
  ya están en la pantalla. Un endpoint para repetir lo que el front sabe sería una fuente
  más de verdad que mantener sincronizada.
- Toma los **drafts**, no lo guardado: si el usuario movió una línea de centro y todavía no
  guardó, tiene que ver el centro que eligió. Mostrarle el viejo convertiría la
  confirmación en una trampa.
- El **número de intento** sale del mismo agrupamiento que muestra la pestaña "Órdenes
  SAP" (`groupSapOrdersByAttempt`), así que los dos números coinciden.
- **Sin líneas activas** el botón de confirmar queda apagado y el modal explica por qué, y
  sugiere rechazar la orden. El servidor lo rechaza igual —es él quien manda— pero ofrecer
  un botón que no funciona y devolver un error donde ya sabíamos la respuesta es peor.

Lo que ya estaba resuelto y sigue valiendo:

- **Confirma antes** de enviar, porque crea pedidos reales — y dice **cuántos**:
  el modal calcula los centros distintos con lo que hay en pantalla, incluidos los cambios
  sin guardar. El aviso también dice si hay cambios sin guardar (se reenviaría sin ellos)
  y cuántos productos siguen con un aviso que bloquea.
- El resultado se muestra **en el mismo modal**, no en un toast.
- El envío exitoso **es** el cierre de la revisión: el Middleware baja
  `ProcessedBackoffice` a `1` solo, sin llamar a `backoffice/close`.
- El comentario en el hilo del vendedor lo deja el propio envío del Middleware: **no hay
  que duplicarlo** desde BackOffice.

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

Una línea **cancelada no genera avisos ni bloquea**: no viaja, así que su destino vacío no
puede frenar el envío — si lo frenara, cancelar la línea problemática dejaría de destrabar
la orden, que es justamente para lo que sirve.

### Cancelar una línea con motivo de no venta — 2026-09-22

Pedido: *"agregar opción para cancelar los items de la business order, con un motivo de no
venta al cancelarlos... al reenviar a SAP no se tienen en cuenta estos items cancelados"*.

La línea cancelada **no viaja a SAP pero no desaparece**: queda en la tabla, apagada, con
su motivo y quién la canceló. Si desapareciera, nadie podría saber por qué el pedido que
llegó a SAP es más chico que el que cargó el vendedor. Por eso en el Middleware es una
marca propia (`CancelledAt`) y no el soft-delete.

| Decisión | Por qué |
|---|---|
| **Motivo obligatorio del catálogo** `NoSaleReasons` + nota opcional | El código hace **comparables** las pérdidas entre órdenes (cuántas por precio, cuántas por stock); la nota explica el caso puntual. Es el mismo catálogo que usa MobilityIA |
| **Reversible sólo si no hubo envío posterior** | Ese envío ya salió sin la línea: las órdenes SAP creadas son un hecho consumado. Lo frena el Middleware, dentro del mismo UPDATE |
| **Se pueden cancelar todas**, pero cancelar la **última** avisa | Sin líneas el envío rebota. El modal lo dice y ofrece *Rechazar orden*, que es lo que cierra el documento y le avisa al vendedor. No lo prohíbe: quien quiera puede, sabiendo |
| **Con todas canceladas el envío no sale** | El botón de confirmar queda apagado, y del lado del Middleware la guarda que ya existía (`422 "has no active items"`) lo corta |
| El botón de la tabla dice **"Cancelar línea"**, no "Cancelar" | En la misma pantalla los modales usan "Cancelar" para cerrarse sin hacer nada. La misma palabra para las dos cosas es lo que hace apretar la equivocada |

- Centro y destino quedan **bloqueados** mientras la línea está cancelada: elegirlos no
  cambiaría nada y haría creer que va a salir.
- **Reactivar no se confirma**: no destruye nada y se puede volver a cancelar. El motivo
  queda en el hilo igual.
- Auditoría `REVISION_SAP_ITEM_CANCEL` / `REVISION_SAP_ITEM_REACTIVATE`, **siempre** — no
  hay cancelación que no cambie nada. El detalle lleva el motivo y cuántas líneas quedaron
  activas: si mañana la orden se rechaza, esa fila lo explica sola.
- El comentario en el hilo del vendedor lo deja el Middleware, con la **etiqueta** del
  motivo y no el código: `SIN_STOCK` no le dice nada a quien lo lee desde el teléfono.

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
| `POST /api/revision-sap/orders/:guid/items/:itemGuid/cancel` | `POST …/cancel` | Cancela una línea con motivo de no venta |
| `POST /api/revision-sap/orders/:guid/items/:itemGuid/reactivate` | `POST …/reactivate` | Deshace la cancelación |
| `GET /api/revision-sap/no-sale-reasons` | `GET /mobility/no-sale-reasons` | Catálogo de motivos, sólo activos |
| `PUT /api/revision-sap/orders/:guid/group-invoice` | `PUT …/group-invoice` | Agrupa factura (cabecera) |
| `GET /api/revision-sap/orders/:guid/sap-orders` | `GET …/sap-orders` | Órdenes SAP de la orden |

- Quién hace el cambio sale **del token**, nunca del body.
- **Auditoría:**
  - BackOffice registra `REVISION_SAP_DESTINATION_CHANGE`, categoría `SapReview`.
  - El Middleware deja `BackofficeItemDestinationChange`, con antes y después, más un comentario en el hilo de la orden.
- Contrato del Middleware: `MobilityMiddleWare/docs/API_BACKOFFICE_REVIEW.md` (PR #646).
- El catálogo de motivos es el único que **no** cuelga de `backoffice-review`: es un
  maestro compartido con MobilityIA, y ése es el punto — los dos tienen que nombrar los
  mismos motivos con los mismos códigos.

## Archivos

`apps/api/src/revision-sap/`: `revision-sap.controller.ts`, `.service.ts`, `.client.ts`,
`.types.ts`, `.module.ts`, y sus `*.spec.ts`.

`apps/web/src/components/revision-sap/`:

| Archivo | Qué hace |
|---|---|
| `RevisionSapPanel.tsx` | Contenedor: bandeja o detalle |
| `ReviewQueueList.tsx` | Tabla de la bandeja, con el motivo separado en tipo y mensaje |
| `ReviewOrderDetail.tsx` | Cabecera, motivo, las dos pestañas, guardado y acciones |
| `ReviewItemsTable.tsx` | Pestaña **Productos**: centro, destino, "Ver stock" y cancelar/reactivar por línea |
| `GroupInvoiceModal.tsx` | Confirmación de agrupa factura, con lo que implica cada valor |
| `RejectOrderModal.tsx` | Confirmación del rechazo: qué implica, y el motivo obligatorio |
| `CancelItemModal.tsx` | Cancelar una línea: motivo del catálogo + nota, y la advertencia de la última |
| `ResendModal.tsx` | **Previsualización** del envío (una orden SAP por centro, con sus productos y el intento) y, después, el resultado **por centro** |
| `SapOrdersPanel.tsx` | Pestaña **Órdenes SAP**: agrupadas por intento, con estado y productos de cada una. Solo consulta |
| `SapErrorMessage.tsx` | El motivo de SAP: tipo como etiqueta y mensaje |
| `ProductStockModal.tsx` | Stock por centro y almacén de un producto |
| `revision-sap.api.ts` | Llamadas a la API |
| `revision-sap.logic.ts` | Reglas puras: cambios, avisos, stock |
| `revision-sap.types.ts` | Tipos |

## Deploy

0. **Cancelar líneas exige Middleware ≥ 1.369.0** (PR #704) **y su migración SQL**
   (`sql/MIGRATION_BusinessOrderItems_CancelacionConMotivo.sql`, aditiva e idempotente).
   Sin las columnas, el detalle de la orden falla con `Invalid column name`.
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
- ~~**Orden que BackOffice no puede corregir** (ej. cliente bloqueado): ¿se cierra la revisión
  sin enviar (`backoffice/close`)?~~ **Resuelto el 2026-09-18**: se rechaza, con motivo
  obligatorio. La orden pasa a `Rejected` y vuelve al vendedor, que sólo puede copiarla.
- **Casilla del correo** a BackOffice.
- **Guardado de MobilityIA:** su upsert reescribe los destinos de las líneas. Hoy no pisa
  el cambio de BackOffice porque la orden en revisión está en solo lectura.
