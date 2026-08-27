# Spec (SDD) — Consola de Soporte

> Fecha: 2026-08-26 (ultima actualizacion)
> Estado: fases 1 a 4 implementadas. **La fase 4 (§8.quater) cambio los requerimientos y
> revirtio el override libre de la fase 2 y el PATCH de linea de la fase 3.** Las secciones
> §7.1 y §8 quedan como registro historico, no como descripcion del sistema actual.
> Version BackOffice: 2.9.0 · Middleware: v1.248.0
> Branch: `feature/consola-soporte`

---

## 1. Problema

Cuando una orden o cotizacion del flujo Mobility queda trabada en un estado erroneo —o
"desaparece" de la pantalla del vendedor porque su estado no coincide con los hechos que lo
respaldan— hoy la unica salida es **entrar a mano a SQL Server y editar los registros**.

Eso tiene tres costos: es lento, no deja traza de quien lo hizo ni por que, y exige acceso
directo a la base productiva a gente que no deberia tenerlo.

Falta la herramienta que lo reemplace: una **consola de soporte** dentro de BackOffice que
permita auditar la trazabilidad completa de un documento y corregir su estado en caliente,
con acceso restringido al DevelopersTeam.

## 2. Alcance

**Dentro**: ordenes y cotizaciones del **flujo Mobility** (`BusinessOrders` / `BusinessQuotes`).

**Fuera**: las ordenes de SAP (`/api/mobility/sap-orders`, `/api/sap/orders`). Se evaluaran
en una fase posterior si el soporte las necesita.

## 3. Decisiones tomadas

| # | Decision | Razon |
|---|---|---|
| D1 | El bypass va en un **router nuevo y separado** del Middleware, no modificando `PATCH /orders/:guid/status` | El endpoint existente lo usan vendedores y gerentes desde MobilityManager. Tocarlo cambiaria el flujo de negocio para todos |
| D2 | **No se modifican las tablas de transiciones** (`documentStatus.js` — ver §4.bis) | Relajarlas afloja las reglas para TODO el ecosistema, no solo para soporte. El bypass debe ser un camino explicito, no una regla mas permisiva |
| D3 | BackOffice **no escribe a SQL**: todo pasa por el Middleware | Regla dura del proyecto (`CLAUDE.md`). Ademas, escribir directo reproduce el problema que este modulo viene a eliminar |
| D4 | ~~Transiciones **de cualquier estado a cualquier estado**~~ | **REVERTIDA el 2026-08-26** por el equipo del solicitante: generaba demasiadas inconsistencias. Hoy solo se puede **volver atras** o **anular**. Ver §8.quater |
| D5 | El rol de soporte es **exclusivo** (`MOBILITYBO_SUPPORT`), y **SuperAdmin tambien entra** | Decision del solicitante (2026-08-25). Mantiene la regla transversal de que SuperAdmin ve todo |
| D6 | Prioridad del rol: **SuperAdmin > Soporte > Administrador > Marketing** | Soporte es un rol tecnico deliberado del DevelopersTeam; si a alguien se lo asignan, debe ganarle a los roles funcionales. Ver riesgo R2 |
| D7 | Se ofrecen **dos operaciones distintas**: reparacion limpia (corregir los hechos + recalcular) y override duro (estampar el estado) | El estado es un valor DERIVADO, no almacenado. Ver §4 |
| D8 | El router de soporte del Middleware exige **`requireApiKey`** | Es el unico camino del ecosistema que salta el scope de vendedor y la maquina de estados. Sin key seria alterable por cualquiera |
| D9 | El **listado paginado** entra en el alcance de la fase 2 | Sin el, la consola solo sirve si ya se conoce el numero exacto. El ticket pide "al seleccionar o hacer clic en una orden", que implica un listado. Es solo lectura, asi que no agrega riesgo |
| D14 | La consola ofrece **acciones con intencion** (escriben hechos) como camino principal, en vez de dejar elegir el estado | Forzar un valor derivado deja documentos en estados que nadie ve. Ver §8.bis |
| D15 | ~~El **override libre se conserva**, plegado en "Avanzado"~~ | **REVERTIDA el 2026-08-26**. El ticket lo pedia; el equipo lo retiro tras ver las inconsistencias. Ver §8.quater |
| D16 | La consola **marca los documentos desfasados** y ofrece un filtro para juntarlos | Un estado desfasado es invisible: nadie se entera hasta que alguien lo mira de casualidad |
| D17 | Las decisiones sobre lineas y plazos de pago **reusan las funciones del flujo**, no escriben columnas | Esas funciones ademas comentan el hilo, avisan y recalculan. Escribir directo dejaria todo eso sin pasar. Ver §8.quater |
| D18 | `asSupport` saltea la **pertenencia** y la **banda del aprobador**, nada mas | Sin lo segundo soporte solo podria rechazar. Es un control levantado: riesgo R6 |
| D19 | El **autor** de la decision es soporte; el pedido va en el **motivo**, obligatorio siempre | Decision del solicitante (2026-08-26) |
| D20 | La UI **no ofrece** una decision que el middleware va a rechazar | Desde afuera "no corresponde" y "esta roto" se ven igual (ORD-00005402) |

## 4. El hecho tecnico que gobierna el diseno

**El estado de un documento no se guarda: se calcula.**

`documentStatus.repository.recomputeStatus` deriva el `StatusCode` de la cabecera a partir de
los hechos: las banderas de los items (`AuthorizationRequired`, `AuthorizationStatus`,
`SellerResponse`), el veredicto del motor de credito y la validacion del pago. Su propio
comentario lo dice: *"se RECALCULAN de los hechos tras cada mutacion, no se setean por los
escritores"*.

Consecuencia directa para esta consola: **si soporte estampa un estado sin tocar los hechos que
lo respaldan, el proximo recompute lo revierte**, en silencio y sin error. Cualquier accion
normal sobre el documento dispara ese recalculo.

Por eso la consola expone dos caminos, y la UI empuja hacia el primero:

**Reparacion limpia** (recomendada) — soporte corrige los hechos (destraba un item, marca el
pago, libera el credito) y dispara el recalculo. El estado resultante es consistente y estable
porque los hechos lo respaldan.

**Override duro** — soporte estampa un estado que los hechos no respaldan. Resuelve el caso
urgente pero es fragil: el proximo recompute puede revertirlo. La UI lo advierte
explicitamente; ocultarlo seria peor, porque soporte creeria haber arreglado algo que no quedo
arreglado.

Se descarto una tercera via —"pinnear" el documento para que el recompute lo respete— por ser
un cambio de fondo en el motor de estados con impacto en todo el ecosistema. Si el uso
demuestra que hace falta, se evalua aparte.


## 4.bis Correccion — hay DOS maquinas de estados, y la spec citaba la equivocada

> Detectado 2026-08-25 al verificar contra datos reales. Las versiones 0.1 de este
> documento citaban `src/utils/orderStatusTransition.js`. **Ese es el vocabulario
> LEGACY.** El vigente vive en `src/utils/documentStatus.js`.

| | Legacy (`orderStatusTransition.js`) | Vigente (`documentStatus.js`) |
|---|---|---|
| Anulada | `Cancelled` | **`Annulled`** |
| Rechazada | `AuthorizationRejected` | **`Rejected`** |
| Otros | `AwaitingAuthorization`, `Authorized` | no existen |

Los datos de QATEST usan el vocabulario **vigente**: los estados reales de ordenes son
`Draft`, `ReadyForApprove`, `Processed`, `SentToSAP`, `PendingDispatch`, `Dispatched`,
`Invoiced`, `Rejected`, `Annulled`. Las cotizaciones suman `AutomaticallyAuthorized`,
`ConvertedToOrder` y `Expired`.

`businessOrders.updateStatus` valida contra `ORDER_STATUSES` y lanza `LEGACY_STATUS_CODE`
si le pasan un codigo viejo. El comentario del propio codigo advierte que por el camino
legacy `BusinessQuotes` termino con `Won` y `Approved` adentro.

**Impacto en la fase 2**: el override DEBE validar `toCode` contra
`documentStatus.ORDER_STATUSES` / `QUOTE_STATUSES`, nunca contra el mapa legacy. Validar
con el legacy rechazaria `Annulled` y `Rejected` —los estados que soporte ve en la
pantalla— y aceptaria codigos que ninguna app entiende.

Terminales vigentes: ordenes `Invoiced`, `Rejected`, `Annulled`; cotizaciones
`ConvertedToOrder`, `Rejected`, `Expired`, `Annulled`. La conclusion de §4 no cambia:
**tampoco en el modelo vigente existe una transicion de vuelta a `Draft`**.

---

## 4.ter Como se recalcula el estado — referencia

> Esta informacion vivia solo en los comentarios de `src/utils/documentStatus.js` del
> Middleware. Se documenta aca porque la consola de soporte la necesita para explicar
> por que un documento esta donde esta.
>
> **Si esta logica cambia en el Middleware, hay que actualizar esta seccion.**

### Cuando corre el recalculo

Por **eventos**, nunca por reloj. No hay ningun scheduler que revise documentos. Si
nadie toca el documento, su estado se queda como esta indefinidamente — aunque sea
incorrecto. Eso es lo que hace util el boton "Recalcular estado" de la consola, y
tambien lo que explica que un override forzado sobreviva un tiempo: se revierte en la
proxima accion sobre el documento, que puede ser en minutos o en semanas.

| Actor | Accion | Funcion que dispara |
|---|---|---|
| Vendedor | Crea/edita la orden o la envia a aprobacion | `businessOrders.upsert` |
| Gerente | Decide una linea | `businessOrderAuthorizations.decideItem` |
| Gerente | Decide la forma de pago pedida | `decidePaymentMethod` |
| Gerente | **Cierra su turno** | `resolveOrder` |
| Vendedor | Responde una contraoferta | `respondItem` |
| Vendedor | Responde sobre la forma de pago | `respondPaymentMethod` |
| Creditos | Libera o deniega el credito | `creditApprovals.triggerRecompute` |
| Sistema | Se valida un pago | `orderPayments.triggerRecompute` |
| **Soporte** | Cambia el estado de una linea | `support.setItemStatus` |
| **Soporte** | Aprieta "Recalcular estado" | `support.recomputeDocument` |

El override de cabecera (`setStatusOverride`) es la unica escritura que **NO** dispara
el recalculo, a proposito: recalcular desharia el override en el acto.

### Que mira

**Cabecera**: `CancelledAt`, `SentAt`, la fila de resolucion (turno del gerente),
`OtherPaymentMethod` + `OtherPaymentMethodStatus`, y —solo cotizaciones—
`ConvertedToOrderNumber` y `ValidUntil`.

**Cada linea**: `AuthorizationRequired`, `AuthorizationStatus`, `SellerResponse`.

### La escalera de decision — ORDEN

Se evalua en orden y gana la primera condicion que se cumple.

| # | Condicion | Estado |
|---|---|---|
| 1 | `CancelledAt` tiene valor | `Annulled` |
| 2 | El estado actual esta en el tramo de SAP | **se preserva** (`SentToSAP`, `PendingDispatch`, `Dispatched`, `Invoiced`) |
| 3 | `SentAt` vacio | `Draft` |
| 4 | Ninguna linea escalada **y** sin pedido de otra forma de pago | `Processed` |
| 5 | Alguna linea escalada sin decidir, o cabecera sin contestar | `ReadyForApprove` |
| 6 | El gerente no cerro su turno (`resolvedAt` vacio) | `ReadyForApprove` |
| 7 | Contraoferta esperando al vendedor, o cabecera observada | `Processed` |
| 8 | Ninguna linea vendible | `Rejected` |
| 9 | (resto) | `Processed` |

### La escalera de decision — COTIZACION

| # | Condicion | Estado |
|---|---|---|
| 1 | `CancelledAt` tiene valor | `Annulled` |
| 2 | `ConvertedToOrderNumber` tiene valor | `ConvertedToOrder` |
| 3 | `SentAt` vacio | `Draft` |
| 4 | `ValidUntil` vencido | `Expired` |
| 5 | Ninguna linea escalada **y** sin pedido de otra forma de pago | `AutomaticallyAuthorized` |
| 6–9 | Igual que los pasos 5 a 9 de la orden | `ReadyForApprove` / `Processed` / `Rejected` |

### Definiciones que hacen falta para leer las tablas

**Linea escalada**: `AuthorizationRequired = 1`.

**Linea vendible** (`isSellable`): no requiere autorizacion, **o** esta `approved`,
**o** esta `countered` y el vendedor respondio `accepted`.

**Tramo de SAP**: `SentToSAP`, `PendingDispatch`, `Dispatched`, `Invoiced` los escribe
la integracion con SAP y el recalculo los preserva sin tocarlos. La proyeccion **no
puede producirlos**, y tampoco sacar un documento de ahi: eso solo se logra con el
override de cabecera, que es el caso peligroso de D4 (no se propaga a SAP).

### Casos verificados en QATEST

| Documento | Donde corta la escalera | Estado |
|---|---|---|
| ORD-00005413 | paso 3 (`SentAt` vacio) | `Draft` — por eso el override a `ReadyForApprove` se revirtio |
| ORD-00005414 | paso 4 (0 lineas escaladas) | `Processed` — nunca pasa por el gerente |
| ORD-00005411 | paso 6 (turno abierto) | `ReadyForApprove` pese a tener sus 2 lineas decididas |

## 5. Objetos de datos involucrados

| Documento | Cabecera | Items | FK | Resoluciones |
|---|---|---|---|---|
| Orden | `BusinessOrders` | `BusinessOrderItems` | `GuidBusinessOrders` | `BusinessOrdersResolutions` |
| Cotizacion | `BusinessQuotes` | `BusinessQuoteItems` | `GuidBusinessQuotes` | `BusinessQuotesResolutions` |

**Banderas de cabecera**: `StatusCode`, `ProcessedPrices`, `ProcessedCredit`,
`ProcessedPaymentMethod`, `OtherPaymentMethod`, `OtherPaymentMethodStatus`, `CreditAuthReason`,
`CancelledAt`, `SentAt`.

**Banderas de item**: `AuthorizationRequired`, `AuthorizationStatus`, `SellerResponse`.

BackOffice **no toca ninguna de estas tablas directamente**: las lee y escribe por el
Middleware.

---

## 6. Fase 1 — Rol + linea de tiempo (solo lectura)

**Cambios en MobilityMiddleWare: NINGUNO.** El endpoint necesario ya existe y ya esta montado
sin API key.

### 6.1 Rol en ITManager

Script `apps/api/prisma/sql/006_AddSupportRole.sql`, idempotente y aditivo, siguiendo el patron
del `001`:

- Rol `MOBILITYBO_SUPPORT` (RoleName `Soporte`)
- Permisos `MOBILITYBO_SUPPORT_VIEW` y `MOBILITYBO_SUPPORT_OVERRIDE`
- Mapeo: `SUPPORT` → ambos; `SUPERADMIN` → ambos

### 6.2 Backend

| Archivo | Cambio |
|---|---|
| `auth/backoffice-role.enum.ts` | agregar `Soporte` |
| `auth/role-resolver.service.ts` | mapear `MOBILITYBO_SUPPORT`, prioridad segun D6 |
| `support/support.types.ts` | tipos del modulo |
| `support/support.client.ts` | cliente HTTP al Middleware |
| `support/support.service.ts` | logica + auditoria |
| `support/support.controller.ts` | rutas, `@Roles(Soporte)` |
| `support/support.module.ts` | modulo |
| `app.module.ts` | registrar `SupportModule` |

**Endpoints:**

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/support/documents` | Buscar documentos. Query: `type` (`order`\|`quote`), `search`, `page`, `limit` (max 200) |
| GET | `/api/support/documents/:type/:number` | Cabecera + items del documento |
| GET | `/api/support/documents/:type/:number/timeline` | Bitacora unificada. Query: `includeViews`, `includeMessages` |

El ultimo es un passthrough a `GET /api/mobility/document-timeline` del Middleware, que
devuelve la historia completa: alta, ediciones, envio, decisiones por item, contraofertas,
decision de cabecera, corridas del motor de credito, pagos y su validacion, liberacion o
denegacion de credito, cierre del turno del gerente, envio a SAP y anulacion con motivo.

### 6.3 Frontend

`pages/SoportePage.tsx` + `components/soporte/` (`soporte.api.ts`, `soporte.types.ts`,
`DocumentSearch.tsx`, `DocumentTimeline.tsx`, `soporte.css`), entrada en `config/sections.tsx`
con `roles: ['Soporte']`, ruta en `App.tsx` con `RoleGuard`, icono SVG nuevo en
`layout/icons.tsx`. Sin emojis, tokens `--bo-`, clases `bo-`.

---

## 7. Fase 2 — Listado + override de estados

### 7.0 Listado paginado — COMPLETO (v1.240.0 del Middleware / v2.1.0 de BackOffice)

Router nuevo en el Middleware, montado con `requireApiKey`:

```
GET /api/mobility/support/documents?type=&search=&status=&page=&limit=&sortBy=&sortDir=
GET /api/mobility/support/statuses?type=
```

Archivos: `src/api/routes/support.js`, `src/db/repositories/support.repository.js`,
+2 lineas en `src/app.js`. Paginacion server-side, whitelist de `sortBy`, parametros
por `.input()`, filtro de soft-delete (NULL y 0). Solo lectura.

En BackOffice: `GET /api/support/documents` y `GET /api/support/statuses`, y la UI pasa
a ser **listado -> detalle** (clic en una fila abre su linea de tiempo).

`/statuses` deriva los estados de los datos y no de una lista fija: si el flujo agrega
un estado, el filtro lo muestra sin tocar codigo.
### 7.1 Override de estados — ELIMINADO en la fase 4 (ver §8.quater). Historico: v1.241.0 / v2.2.0
### 7.1 Override de estados — COMPLETO (v1.241.0 / v2.2.0)

### 7.1 Cambios en MobilityMiddleWare

**Archivo nuevo** `src/api/routes/supportOverrides.js`, montado como:

```js
app.use('/api/mobility/support', requireApiKey, supportOverridesRouter);
```

**Repositorio nuevo** `src/db/repositories/supportOverrides.repository.js`, con `setStatusOverride`:

- omite `sellerScope.assertScope` (soporte no es el vendedor)
- omite `canTransition` de `orderStatusTransition.js` (D4)
- valida que `toCode` sea un codigo existente, no un string arbitrario
- exige motivo no vacio
- escribe en las mismas tablas de historia que alimentan la timeline, con el actor real

**Endpoints:**

```
PATCH /api/mobility/support/orders/:guid/status
PATCH /api/mobility/support/quotes/:guid/status
Body: { toCode, reasonCode, reasonNotes, actor: { email } }
```

### 7.2 BackOffice

`PATCH /api/support/documents/:type/:guid/status`, con `@Roles(Soporte)`, motivo obligatorio y
traza `SUPPORT_STATUS_OVERRIDE` en `AuditLogs`.

### 7.3 UI

Modal que muestra estado actual → destino y exige motivo. **Si el origen o el destino es
terminal, segundo paso de confirmacion** con la advertencia de desincronizacion con SAP. Aviso
permanente de que un estado forzado sin respaldo en los hechos puede recalcularse.

---

## 8. Fase 3 — Estado de las lineas — REEMPLAZADO en la fase 4 (ver §8.quater). Historico: v1.242.0 / v2.3.0

### 8.1 Cambios en MobilityMiddleWare

Sobre el mismo router de soporte:

```
PATCH /api/mobility/support/:type/:guid/flags            -- banderas de cabecera
PATCH /api/mobility/support/:type/:guid/items/:itemGuid  -- banderas de item
POST  /api/mobility/support/:type/:guid/recompute        -- dispara recomputeStatus
```

El `recompute` explicito es lo que habilita la **reparacion limpia** de §4.

### 8.2 BackOffice

Espejo de los tres, con `@Roles(Soporte)`, motivo obligatorio y traza `SUPPORT_FLAG_OVERRIDE`.

---


### 8.3 Decisiones de la fase 3

| # | Decision | Razon |
|---|---|---|
| D10 | **`countered` queda afuera** de los estados que soporte puede poner | Una contraoferta viaja con `ProposedPrice`. Estamparla sin precio deja al vendedor viendo una contraoferta vacia, y soporte no toca precios (restriccion del solicitante) |
| D11 | Se escriben (y limpian) los **campos acompañantes**: `DecidedByEmail`, `DecidedAt`, `SellerRespondedByEmail`, `SellerRespondedAt` | No son un extra: sin ellos queda una linea aprobada por nadie, que es la incoherencia que este modulo viene a eliminar |
| D12 | El cambio de linea **SI dispara `recomputeStatus`**; el override de cabecera no | Es la diferencia entre reparacion limpia y override duro (§4). Corregidos los hechos, el estado derivado queda firme |
| D13 | La consola **muestra** si el turno del gerente esta cerrado, pero **no permite cerrarlo** | Sin mostrarlo, la consola miente por omision: con todas las lineas decididas el documento sigue en `ReadyForApprove` y parece que la herramienta fallo. Permitir cerrarlo es otro boton con su propio riesgo; se evalua si el uso lo pide |

### 8.4 Verificado contra QATEST (2026-08-25)

- Cambio de linea y **reversion completa**: estado, `DecidedByEmail` y `DecidedAt` vuelven a null.
- `countered` rechazado con 400 y la lista de valores permitidos.
- Item de otro documento devuelve 404 (la linea se valida contra el documento de la URL).
- `recompute` de ORD-00005413: `ReadyForApprove` a `Draft`.
- ORD-00005411, con sus 2 lineas ya decididas y el turno abierto, sigue en
  `ReadyForApprove`: confirma en vivo la trampa que motiva D13.

---

## 8.bis Acciones con intencion — el rediseno del camino de correccion

> Agregado 2026-08-26, a partir de un problema reportado por la solicitante.

### El problema que lo motivo

Forzar el estado de `ORD-00005406` a `ReadyForApprove` dejaba el documento en un
callejon sin salida: el vendedor lo veia como "pendiente de aprobacion" pero no podia
hacer nada, y el gerente **no lo tenia en su cola**. El filtro de esa cola es:

```sql
AND bo.StatusCode = 'ReadyForApprove'
AND NOT EXISTS (fila de resolucion activa)
```

Con el turno ya cerrado, la segunda condicion falla y el documento no aparece. Nadie
puede disparar el recalculo salvo soporte, con "Recalcular estado".

Peor: el comentario de ese filtro en el Middleware dice que `ReadyForApprove` implica
sus condiciones **por construccion**, porque *"la proyeccion solo lo devuelve cuando hay
algo que el gerente tiene que decidir"*, y documenta un bug pasado —tres ordenes en
`Draft` que igual aparecian en la cola— causado justamente por escribir el estado por
un camino independiente. **El override reintroduce esa clase de error.**

### La causa de fondo

El override escribe un valor **derivado**. Los valores derivados no deberian ser
escribibles: o el proximo recalculo los revierte, o —peor— nadie puede recalcularlos y
quedan mintiendo.

### El rediseno (D14)

La consola deja de preguntar *"¿a que estado querés llevarlo?"* y pasa a preguntar
*"¿que querés que pase?"*. Cada accion escribe **hechos** y deja que el estado se
calcule.

| Accion | Que escribe | Estado esperado |
|---|---|---|
| `return_to_manager` | Lineas escaladas a pendiente + reabre el turno | `ReadyForApprove`, y aparece en la cola |
| `unblock_forward` | Aprueba las lineas pendientes + cierra el turno | `Processed` |
| `annul` | `CancelledAt` + motivo | `Annulled` |
| `recompute` | Nada | El que corresponda |

⚠️ **No alcanza con filtrar las transiciones "validas"** de la maquina de estados.
`Draft -> ReadyForApprove` es una transicion legal, pero en un documento sin lineas
escaladas produce igual el callejon sin salida. **Transicion valida** ("el flujo permite
ir de A a B") y **estado alcanzable** ("los datos de ESTE documento pueden producir B")
son cosas distintas, y el problema nace de la segunda.

### Dos limites que aparecieron al probar, y que estan asumidos

**1. Disponibilidad ≠ "pasa por el gerente".** En `ORD-00005406` (0 lineas escaladas,
solo un pedido de otra forma de pago ya decidido), reabrir el turno proyectaba
`ReadyForApprove` pero `decideStatusChange` lo **asciende** a `Processed` porque las tres
banderas estan en 1. La accion no hacia nada. Por eso `return_to_manager` exige lineas
escaladas, y si no las hay se muestra deshabilitada con el motivo.

**2. La intencion puede no lograrse, y se dice.** En `ORD-00005411`, `unblock_forward`
aprobo las lineas y cerro el turno, y el documento quedo igual en `ReadyForApprove`
porque **el motor de credito lo retiene**. La accion hizo lo correcto: hay compuertas
fuera del alcance de soporte. El resultado devuelve `expected` y `achieved`, y la UI lo
informa en vez de dar por hecho que se cumplio.

**La garantia que SI se sostiene**: una accion nunca produce un estado inalcanzable.
Puede no llegar al estado que su etiqueta sugiere, y en ese caso lo dice.

### El override libre no se elimina (D15)

El ticket pedia explicitamente *"modificar directamente su estado (status) desde la
interfaz visual"*. Se conserva, pero **plegado en una seccion "Avanzado"** al final del
detalle, con la advertencia de que puede dejar el documento en un estado que nadie ve.
Cumple el requisito sin poner la trampa como primera opcion.

### Diagnostico de desfasajes (D16)

Como un estado desfasado es invisible, la consola lo hace visible: cada fila del listado
marca "deberia ser X" cuando el estado guardado no coincide con el calculado, y hay un
filtro que junta a todos.

**Medido en QATEST el 2026-08-26**: 36 de 197 ordenes y 57 de 155 cotizaciones estaban
desfasadas —30 de las cotizaciones por vencimiento (`ValidUntil` pasado) que nadie toco—.
**El desfasaje ya existia antes de esta consola**; el diagnostico solo lo hizo visible.

Ojo al leerlo: la proyeccion no re-evalua el credito (§4.ter), asi que en los pares
`ReadyForApprove <-> Processed` puede haber falsos positivos. Conviene validar una
muestra recomputando antes de sacar conclusiones.

---

## 8.ter Hallazgos del banco de pruebas — para revisar con el equipo del flujo

> Encontrados el 2026-08-26 corriendo 24 escenarios sobre documentos desechables
> (creados y borrados en la misma corrida). **No son bugs de la consola de soporte**:
> estan en la logica de proyeccion del Middleware y afectan por igual a la app del
> vendedor y a la cola del gerente. Se documentan sin tocarlos, porque cambiarlos
> altera el flujo de negocio para todos.

### H1 — La regla de retencion anula el paso 7 de la escalera, en sus dos casos

`projectAuthSegment` paso 7 dice que un documento esperando al VENDEDOR sigue en
`Processed`. Su comentario es explicito: *"La cabecera OBSERVADA pesa igual que una
contraoferta de linea: el gerente ya hablo, falta el vendedor — el documento sigue
'Processed', no muere ni avanza"*.

Pero la regla de retencion (agregada el 2026-08-20 en `decideStatusChange`) baja a
`ReadyForApprove` cualquier `Processed` que tenga una bandera en 0. Y justamente los dos
casos del paso 7 dejan una bandera en 0:

| Caso | Bandera en 0 | Paso 7 dice | Resultado real |
|---|---|---|---|
| Linea contraofertada sin responder | `processedPrices` | `Processed` | `ReadyForApprove` |
| Cabecera con pago `observed` | `processedPaymentMethod` | `Processed` | `ReadyForApprove` |

Medido con los escenarios 7 (banco 1) y P4 (banco 2). El paso 7 nunca se alcanza en la
practica: o el comentario quedo viejo, o la regla de retencion tiene un efecto no
buscado. **Consecuencia visible**: un documento que espera al vendedor aparece en el
estado del gerente.

### H2 — Las cotizaciones ignoran el pedido de otra forma de pago

`computeProcessedFlags` corta antes para cotizaciones:

```js
if (docType === 'quote') {
    return { processedPrices, processedCredit: 1, processedPaymentMethod: 1 };
}
```

`processedPaymentMethod` queda en **1 fijo**, sin mirar si el pedido de otra forma de
pago fue decidido. Pero `projectAuthSegment` **si** evalua `headerPending` para
cotizaciones. Las dos piezas se contradicen, y la regla de ascenso (las tres banderas en
1 suben a `Processed`) hace ganar a las banderas.

Resultado medido, con la MISMA configuracion en los dos tipos:

| Documento | Pago pedido, sin decidir, sin lineas escaladas | Estado proyectado |
|---|---|---|
| Orden (P1) | si | `ReadyForApprove` — correcto, el gerente lo tiene que decidir |
| Cotizacion (P7) | si | **`Processed`** — el gerente nunca lo ve |

**Consecuencia**: una cotizacion con un pedido de plazos sin resolver avanza como si
estuviera aprobado. Es la asimetria mas concreta que encontro el banco.

### Lo que SI quedo verificado de la consola

**24 corridas de acciones, 0 documentos inconsistentes.** La garantia central del
rediseno —una accion nunca deja un estado inalcanzable— se sostiene en cotizaciones,
con "otra forma de pago", en el tramo de SAP, en anuladas y en convertidas a orden.

Tambien quedo verificado que el override libre **si** puede romper la consistencia (se
forzo a proposito), que el diagnostico lo detecta, y que "Recalcular" lo corrige.
---

## 8.quater Fase 4 — Cambio de requerimientos: se saca el salto libre de estados

> **Pedido del solicitante, 2026-08-26.** Reemplaza lo acordado en §7.1 y §8.
> Lo que sigue documenta que cambio, que se elimino y por que.

### Que pidio el equipo

Textual: *"sacar lo de que los estados pueden pasar a cualquier otro estado asi nomas,
porque eso genera muchas inconsistencias"*. En concreto:

1. **Se elimina** el salto arbitrario de estados. Ni el override libre de §7.1 ni el
   PATCH directo de estado de linea de §8 sobreviven.
2. BackOffice solo puede **volver** un documento a un estado **anterior**, nunca a uno
   donde nunca estuvo. **Avanzar tampoco**, aunque sea el siguiente logico.
3. **Anular** sigue siempre disponible, con motivo.
4. Sobre **lineas**: aceptar, rechazar y **contraofertar con un valor**.
5. Sobre **plazos de pago**: verlos si existen, y aceptar / rechazar / contraofertar.
6. Esos cambios de datos hacen que el estado **se recalcule**.
7. Soporte actua **a pedido** de un vendedor (MobilityIA) o un gerente
   (MobilityManager) que no puede hacerlo desde su app.
8. El **boton de recalcular se queda**.

### D17 — Soporte no tiene un camino propio: reusa el del flujo

Las cuatro decisiones (decidir linea, responder linea, decidir plazo, responder plazo)
llaman a las **mismas funciones** que usan el gerente y el vendedor.

La alternativa —escribir las columnas desde el repositorio de soporte— parecia mas
simple y es peor: esas funciones no hacen un UPDATE y listo. Ademas escriben el
comentario de auditoria del hilo, toman el bloqueo de revision, encolan los avisos del
circuito y recalculan el estado. Una escritura directa dejaria la linea cambiada y todo
lo demas sin pasar: exactamente el tipo de incoherencia que esta consola vino a borrar.

Es el mismo razonamiento de D14, un nivel mas abajo.

### D18 — `asSupport`: que saltea y que no

El parametro `asSupport` (default `false`, asi que ningun llamador existente cambia)
saltea **dos** guardas y ninguna mas:

| Guarda | Se saltea | Por que |
|---|---|---|
| Pertenencia (matriz de aprobadores / country manager / vendedor dueno) | **Si** | Soporte no es ninguno de los tres, por definicion |
| Banda del aprobador (`beyond_approver_limit`) | **Si** | El email de soporte no esta en la matriz: `canApproverDecide` devuelve `sin_fila` y bloquea. Sin esta salida, `asSupport` solo podria **rechazar** |
| Motivo obligatorio al rechazar | No | Regla de negocio |
| Precio obligatorio al contraofertar | No | Sin precio, el vendedor ve una propuesta vacia |
| Ronda unica (`already_answered_by_seller`) | No | La cerro MobilityIA en su UI; el MW no puede ser mas permisivo que su cliente |
| Turno cerrado (`already_resolved`) | No | Para volver a decidir hay que reabrir el turno, que es una vuelta atras |
| Bloqueo de otro gerente (`locked_by_another_manager`) | No | Protege contra dos personas escribiendo a la vez, que es justo el riesgo de soporte. Vence solo a los 30 min de inactividad |
| Turno no cerrado para responder (`turn_not_closed`) | No | El vendedor todavia no ve la contraoferta |

El salteo de la **banda** es un control que se levanta. Queda como riesgo **R6**.

### D19 — El autor es soporte; el pedido va en el motivo

Decision del solicitante: *"el que queda registrado como autor de la decision es
soporte, donde en el motivo podra poner sus razones"*. No hay campo `onBehalfOf`
separado.

Por eso el motivo es **obligatorio siempre** en la consola, aunque el flujo solo lo
exija al rechazar: sin el, la decision queda a nombre de soporte y sin rastro de quien
la pidio ni por que.

### D20 — La UI no ofrece lo que va a fallar

Cada linea calcula si se puede decidir, responder, o nada — con las mismas condiciones
que aplica el middleware. Ya paso con las acciones de cabecera que un boton disponible
fallaba al apretarlo (ORD-00005402), y desde afuera *"no corresponde"* y *"esta roto"*
se ven igual.

| Situacion de la linea | Que ofrece |
|---|---|
| Escalada, turno abierto, sin respuesta del vendedor | Decidir por el gerente |
| Contraofertada, turno cerrado, sin respuesta | Responder por el vendedor |
| El vendedor ya respondio | Nada — la ronda es una sola |
| Turno cerrado y sin contraoferta pendiente | Nada — hay que reabrir el turno desde las acciones |
| No requiere autorizacion | Nada |

### Que se elimino

| Se fue | Estaba en | Por que |
|---|---|---|
| `PATCH /support/documents/:type/:guid/status` (override de cabecera) | §7.1 (D15) | Es el salto libre que el equipo pidio sacar |
| `GET /support/vocabulary` | §7.1 | Solo servia para elegir destino en el override |
| `PATCH /support/documents/:type/:guid/items/:itemGuid` | §8 | El gemelo a nivel linea del override: escribia `AuthorizationStatus` a mano, sin comentario en el hilo, sin aviso al vendedor y sin la ronda unica |
| `StatusOverrideModal.tsx`, `ALLOWED_AUTH_STATUS`, `ALLOWED_SELLER_RESPONSE` | BackOffice | Sin uso tras lo anterior |

**D15 queda revertida.** El ticket original pedia el override libre; el equipo lo
retiro despues de ver las inconsistencias que produce. Se deja escrito para que dentro
de seis meses nadie lo reintroduzca creyendo que falta.

### Contrato nuevo

Middleware (`/api/mobility/support`):

| Metodo | Ruta | Que hace |
|---|---|---|
| POST | `/documents/:type/:guid/items/:productCode/decide` | `status` = `approved` / `rejected` / `countered` (+ `proposedPrice`) |
| POST | `/documents/:type/:guid/items/:productCode/respond` | `action` = `accept` / `reject` |
| POST | `/documents/:type/:guid/payment-terms/decide` | `status` = `approved` / `rejected` / `observed` (+ `value`) |
| POST | `/documents/:type/:guid/payment-terms/respond` | `action` = `accept` / `reject` |
| GET | `/item-statuses` | El vocabulario de las cuatro, para que la UI no lo repita |

La linea se identifica por **codigo de producto**, no por Guid: asi la identifica el
flujo, y traducir seria inventar una segunda forma de nombrar la misma cosa.

En el plazo de pago, `observed` **ES** la contraoferta y `value` el plazo que se
contrapropone. No es el mismo vocabulario que el de las lineas, y no se unifico para no
inventar una traduccion que despues haya que mantener en dos lados.

`GET /documents/:type/:guid/items` ahora devuelve tambien el bloque `paymentTerms`.

### Registro de cambios en el Middleware

> Pedido del solicitante: *"ten en cuenta los cambios en el middleware a la hora de que
> terminemos y armemos la documentacion al final"*.

| Version | Que cambio | Afecta al flujo existente |
|---|---|---|
| 1.240.0 | Router `/api/mobility/support` (listado sin scope de vendedor) + `requireApiKey` | No — router nuevo |
| 1.241.0 | Override de estado de cabecera | **Revertido en 1.248.0** |
| 1.242.0 | Estado de lineas por PATCH | **Revertido en 1.248.0** |
| 1.243.0 | `projectCurrentStatus` / `projectStatusBatch` (solo lectura) | No — funciones nuevas |
| 1.244.0 | Acciones con intencion (`describeActions` / `runAction`) | No — router de soporte |
| 1.245.0 | Desempate del mismo segundo en la linea de tiempo (`compareEvents`) | Si, **cosmetico**: ordena mejor eventos con el mismo timestamp |
| 1.246.0 | `managerTurn.relevant` + `TimeStamp` bumpeado en los 5 caminos de escritura de soporte | No — `TimeStamp` no se usa como filtro en ningun consumidor |
| 1.247.0 | `target` en las acciones; se sacan las rutas de override del router | No — router de soporte |
| 1.248.0 | `asSupport` en las 8 funciones de decision; 4 endpoints de decision; `paymentTerms` en `listItems`; se elimina el PATCH de linea | **No, con `asSupport` en `false`** — 704 tests verdes, 9 de ellos fijando la forma de las guardas |

Lo unico que toca codigo **compartido** con MobilityIA y MobilityManager es `asSupport`
(1.248.0) y el desempate de la linea de tiempo (1.245.0). El resto vive en el router de
soporte, que ningun otro consumidor llama.

### D21 — BackOffice NO confirma el envio (decision del equipo, 2026-08-27)

Una cosa es **decidir** (aprobar, rechazar, contraofertar lineas y plazos) y otra es
**confirmar** esas decisiones. Lo segundo es lo que le saca el documento al gerente y se
lo devuelve al vendedor, y **queda en manos del gerente**.

**Ya se cumplia, y ahora esta verificado en el codigo**: las unicas funciones que
insertan en `BusinessOrdersResolutions` / `BusinessQuotesResolutions` son `resolveOrder`
y `resolveQuote`, llamadas solo desde `businessOrderApprovals`, `businessQuoteApprovals`
y `priceApprovalsMobility` — los routers del gerente. El router de soporte solo LEE esa
tabla y, en la vuelta atras a `ReadyForApprove`, marca la fila como eliminada.

| Accion | BackOffice |
|---|---|
| Decidir lineas y plazos de pago | Si |
| Responder por el vendedor | Si |
| **Confirmar el envio (cerrar el turno)** | **No** |
| Reabrir un turno cerrado (vuelta atras) | Si |

### El caso SOLO-CABECERA, que parece una excepcion y no lo es

**ORD-00005419** (reportada el 2026-08-27): sin lineas escaladas, con pedido de plazo de
pago. Soporte rechazo el plazo por el gerente y la orden paso directo a `Processed`, sin
fila de resolucion. Parecia que soporte habia cerrado el turno ademas de decidir.

No lo hizo. Es la **regla 2026-08-17 de `decideStatusChange`**: con las tres banderas de
segmento en 1, el documento asciende a `Processed` sin esperar el cierre del turno. Solo
puede dispararse en documentos solo-cabecera, porque con lineas escaladas
`ProcessedPrices` no llega a 1 sin `resolvedAt`.

La logica es que ahi no habia turno que cerrar: la unica tarea del gerente era decidir el
plazo. **Se comporta igual si la decision la toma el gerente desde su app** — no lo
introduce esta consola.

Contraste verificado el mismo dia — **ORD-00005420**: una linea escalada y aprobada desde
la consola, sin resolucion -> `ProcessedPrices = 0` -> la regla de retencion la sostiene
en `ReadyForApprove`. Correcto, y es lo que el equipo espera.

> **Pendiente de definir con el equipo**: si para un documento solo-cabecera *decidir*
> deba contar como *confirmar*. Hoy cuenta, por la regla de arriba. Cambiarlo implica
> tocar `decideStatusChange`, que es logica compartida con MobilityIA y MobilityManager.

**Bug de la consola corregido en el camino**: el aviso *"El gerente todavia no cerro su
turno"* se mostraba mirando solo la fila de resolucion, asi que aparecia sobre documentos
que ya estaban en `Processed` — afirmando que se iban a quedar en `ReadyForApprove`
cuando ya habian salido de ahi. Ahora se muestra solo mientras el documento sigue en
`ReadyForApprove`, aclara que el cierre no se hace desde la consola, y el caso
solo-cabecera tiene su propia explicacion.

### Como verificar todo esto en la base

Ver **`docs/QUIEN_TIENE_EL_DOCUMENTO.md`**: que columna dice quien tiene el documento,
donde vive la confirmacion de envio, que significan las tres banderas, y las consultas
listas para correr en SSMS (verificadas contra QATEST).

### Verificado contra QATEST (2026-08-26)

**14 escenarios sobre ordenes desechables (`ZZDEC-`), 0 fallos**, borradas al terminar.
Lo que quedo probado, no razonado:

| Escenario | Resultado |
|---|---|
| Contraoferta con precio | La linea queda `countered`, con precio, moneda, autor **soporte**, fecha y motivo. Documento consistente |
| Contraoferta sin precio | Corta con `PROPOSED_PRICE_REQUIRED` y **no escribe nada** |
| Rechazo sin motivo | Corta con 400 |
| Aprobar con el turno abierto | Aprueba **sin banda** (confirma que `asSupport` la saltea) y el documento sigue en `ReadyForApprove`: aprobar una linea no cierra el turno |
| Decidir con el turno cerrado | Corta con `ALREADY_RESOLVED` |
| Respuesta del vendedor a una contraoferta | Queda `accepted`, autor soporte, documento consistente |
| Plazo de pago contraofertado | Queda `observed` con la contrapropuesta y el autor |
| Plazo sin valor / sin pedido / turno abierto | Cortan con `VALUE_REQUIRED`, `NO_REQUEST`, `TURN_NOT_CLOSED` |
| Respuesta al plazo con el turno cerrado | Queda `approved` (el flujo usa ese codigo, no `accepted`) |
| Producto inexistente | Corta con `PRODUCT_NOT_IN_ORDER` |
| PATCH viejo de estado de linea | **404** — la ruta ya no existe |

### H3 — El vendedor puede cambiar su respuesta cuantas veces quiera

> Encontrado por el banco, 2026-08-26. **Preexistente**, no lo introduce esta consola.

La "ronda unica" vive en `decideItem`: el gerente no vuelve a contraofertar despues de
que el vendedor contesto (`already_answered_by_seller`). Pero `respondItem` **no tiene la
guarda simetrica**: mientras el documento siga en un estado negociable y la linea siga
`countered` con precio, una segunda respuesta se acepta y pisa a la primera —
verificado: `accepted` paso a `rejected` y el documento a `Rejected`.

Afecta igual a MobilityIA, que es quien normalmente llama ese endpoint. **No se toca**:
agregar la guarda cambia el flujo para todos.

La consola **no ofrece** responder cuando `sellerResponse` ya tiene valor, asi que es mas
estricta que el middleware. **Queda por decidir con el equipo** si eso esta bien: si un
vendedor contesta por error y pide que se lo corrijan, hoy soporte no puede — tendria que
reabrir el turno del gerente para que vuelva a contraofertar.

## 9. Riesgos

| # | Riesgo | Mitigacion |
|---|---|---|
| R1 | **BLOQUEANTE. `SellerResponse` falta en `BusinessQuoteItems` en PROD** (item 2 del `DEPLOY_SQL_PENDIENTE.md` del Middleware). Sin esa columna el recalculo de cotizaciones falla con "Invalid column name" | Aplicar la columna **antes** de desplegar la fase 3 para cotizaciones |
| R2 | La app resuelve **un solo rol por usuario**. Alguien con `MOBILITYBO_ADMIN` + `MOBILITYBO_SUPPORT` pierde el acceso a Regiones (gana Soporte por D6) | Quien necesite ambos accesos va con SuperAdmin. Documentado en `ROLES_Y_PERMISOS.md` |
| R3 | `MIDDLEWARE_API_KEY` pasa de opcional a **obligatoria** al llegar la fase 2 | Configurarla en ambos lados y actualizar `ENV_VARIABLES.md` en esa fase |
| R4 | Reabrir una orden `Invoiced` o `Cancelled` **no se propaga a SAP**: quedan desincronizados | Habilitado por D4, con doble confirmacion y motivo obligatorio. El riesgo es aceptado, no eliminado |
| R5 | ~~Un override duro puede revertirse solo en el proximo recompute (§4)~~ | **Cerrado en la fase 4**: no queda ningun camino que escriba el estado a mano |
| R6 | **`asSupport` saltea la banda del aprobador** (D18). Un usuario de soporte puede aprobar un descuento que ningun gerente podria firmar por si mismo | El motivo es obligatorio y queda en `AuditLogs` con el autor. **Es un control levantado, no eliminado por accidente**: si el equipo lo quiere de vuelta, la alternativa es que soporte declare a que gerente representa y se valide la banda de ESE gerente — cambia el contrato y la UI |
| R7 | Soporte puede responder **por el vendedor**. La respuesta queda a nombre de soporte, no del vendedor | Decision del solicitante (D19). El motivo obliga a decir quien lo pidio |

## 10. Auditoria

| Action | Category | Entity | Que registra |
|---|---|---|---|
| `SUPPORT_ACTION` | `support` | `BusinessOrders` / `BusinessQuotes` | Vuelta atras, anulacion, reversion de anulacion |
| `SUPPORT_RECOMPUTE` | `support` | `BusinessOrders` / `BusinessQuotes` | Recalculo, **solo si el estado cambio** |
| `SUPPORT_ITEM_DECISION` | `support` | `BusinessOrderItems` / `BusinessQuoteItems` | Decision del gerente sobre una linea |
| `SUPPORT_ITEM_RESPONSE` | `support` | `BusinessOrderItems` / `BusinessQuoteItems` | Respuesta del vendedor a una contraoferta |
| `SUPPORT_PAYMENT_DECISION` | `support` | `BusinessOrders` / `BusinessQuotes` | Decision del gerente sobre el plazo de pago |
| `SUPPORT_PAYMENT_RESPONSE` | `support` | `BusinessOrders` / `BusinessQuotes` | Respuesta del vendedor al plazo de pago |

`SUPPORT_STATUS_OVERRIDE` y `SUPPORT_FLAG_OVERRIDE` **ya no se emiten**: las acciones que
los producian se eliminaron en la fase 4. Las filas historicas quedan.

Todas registran el estado **antes y despues**, incluso cuando no cambio. Que una decision
no mueva el documento es informacion, no ruido: es lo que responde el *"¿por que sigue
igual?"* del dia siguiente.

Las **lecturas** no se auditan en `AuditLogs`: ya quedan en los `ApiLogs` del Middleware
por el header `x-source-app`, y duplicarlas no agregaria nada.

Del lado del Middleware, cada decision deja ademas su fila en `Auditories` y su comentario
en el hilo del documento — los mismos que deja el gerente o el vendedor, porque es la misma
funcion (D17).
