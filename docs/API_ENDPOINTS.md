# API — Mobility BackOffice

> Ultima actualizacion: 2026-09-15
> Version: 2.27.0

Toda respuesta incluye `success`. Los errores siguen el formato de Nest:
`{ message, error, statusCode }`.

## Autenticacion

| Metodo | Ruta | Guard | Descripcion |
|---|---|---|---|
| POST | `/api/auth/login` | — | `{ email, password }` → `{ success, token, user, role, permissions }`. Ademas setea la cookie httpOnly `bo_rag_token` (scopeada a `/rag`) para el iframe del RAG. 401 credenciales invalidas, 403 sin rol en la app, 400 email mal formado |
| POST | `/api/auth/logout` | — | Limpia la cookie `bo_rag_token`. `{ success: true }` |
| GET | `/api/auth/me` | Jwt | Claims del token propio, incluido `role` |

## Salud

| Metodo | Ruta | Guard | Descripcion |
|---|---|---|---|
| GET | `/api/health` | — | `{ success, name, version, status }` |

## Regiones comerciales

**Todo el modulo exige rol `Administrador`** (`SuperAdmin` pasa siempre por el `RolesGuard`).

> **Diferencia con MobilityManager**: alli las lecturas estaban abiertas a cualquier
> autenticado porque las consumian reportes externos. Aca no hay mas consumidor que esta UI,
> y dejar el mapa region↔CEBE legible para Marketing contradiria que la seccion no se le
> muestre. Si en el futuro un reporte necesita `/resolve`, la via es el sync por API key o
> agregar el rol correspondiente al decorador.

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/regions` | Listado paginado. Query: `page`, `limit` (max 200), `search`, `sortBy` (`code`\|`name`\|`sortOrder`\|`serverTimestamp`\|`cebeCount`), `sortDir` |
| GET | `/api/regions/groups` | Agrupaciones de la base (CAYCAR = CEBEs comunes a CA y CB, ver abajo). `cebeCount` = pares que les asigna la vista. 503 "requiere MW ≥ 1.331.0" si el middleware es anterior |
| GET | `/api/regions/cebes/available` | Typeahead de CEBEs. Query: `q`, `limit` (max 50) |
| GET | `/api/regions/companies` | Typeahead de sociedades. Query: `q`, `limit` (max 50) |
| GET | `/api/regions/diagnostics/unmapped` | CEBEs del maestro sin ninguna region |
| GET | `/api/regions/diagnostics/multi` | CEBEs vinculados a mas de una region |
| GET | `/api/regions/:code/resolve` | Pares (CEBE, sociedad) efectivos. Region atomica → sus vinculos; `CAYCAR` → los pares que le asigna la vista (una sola llamada al middleware) |
| GET | `/api/regions/:guid` | Region + sus vinculos. 404 si no existe |
| POST | `/api/regions/:guid/cebes` | Vincular. Body `{ cebes: [{ code, companyCode, name? }] }` → `{ success, linked }`. 400 si la lista viene vacia o si algun item no trae `companyCode`; 404 si la region no existe |
| DELETE | `/api/regions/:guid/cebes/:code/:companyCode` | Desvincular (soft delete). 404 si el vinculo no existia |

### Agrupaciones (CAYCAR) — se leen de la base

Desde 2.16.0 BackOffice **no calcula** agrupaciones. La unica definicion es la vista
`dbo.VIEW_RegionGroupProfitCenters` (repo MobilityMiddleWare), que el middleware sirve desde
1.331.0. `GET /api/regions/groups` y `GET /api/regions/CAYCAR/resolve` leen esa misma vista:
el conteo del listado y las filas del detalle no pueden divergir.

Regla (decision del negocio, 2026-09-10): CAYCAR = **interseccion de CA y CB por codigo de
CEBE**. Hasta 2.15.0 era la union (QATEST: 11 codigos / 38 pares); ahora son 2 codigos / 18
pares. Detalle en `docs/SPEC_BACKOFFICE_REGIONES.md` §3.4.

### Orden de rutas — load-bearing

Las rutas literales (`groups`, `cebes/available`, `companies`, `diagnostics/*`) y `:code/resolve`
se declaran **antes** que `:guid`. Invertir ese orden hace que `/groups` se interprete como un
guid. Esta anotado en el propio controller.

### Sync maquina-a-maquina

| Metodo | Ruta | Guard | Descripcion |
|---|---|---|---|
| POST | `/api/regions/sync` | `x-api-key` | Reconcilia el estado deseado de vinculos |

- Body: `{ regions: [{ code, cebes: [{ code, companyCode, name? }] }], source? }` (default `sap`).
- Header opcional `x-actor` (default `sap-sync`) para la traza.
- Respuesta: `{ success, regions, added, removed, skipped }`.
- **Nunca crea regiones**: los codigos ausentes del catalogo `Continents` vuelven en `skipped`.
- **Idempotente**: reenviar el mismo estado devuelve `added: 0, removed: 0`.
- Sin `REGIONS_SYNC_API_KEY` configurada el endpoint responde **403** (deshabilitado); con key
  incorrecta, **401**.

## Documentacion del RAG (proxy)

Reverse-proxy same-origin hacia DuwyEngineRAG. No es una API REST propia: reenvia todo `/rag/*`
al RAG externo.

| Ruta | Guard | Descripcion |
|---|---|---|
| `/rag/*` | cookie `bo_rag_token` + rol Marketing/SuperAdmin | Proxya al RAG (`RAG_URL`). Reescribe assets a `/rag`. Sin cookie → 401; rol insuficiente → 403; sin `RAG_URL` → 404 (no montado) |

Detalle en `docs/SPEC_RAG_EMBED.md` y `docs/EXTERNAL_APIS.md`.

## Consola de soporte

**Todo el modulo exige rol `Soporte`** (`SuperAdmin` pasa siempre por el `RolesGuard`).
Es el rol exclusivo del DevelopersTeam: da trazabilidad de cualquier documento **sin** el
scope de vendedor que limita al resto del ecosistema.

> **Escritura**: solo el override de estado. Las banderas de control (items, pago,
> credito) llegan en la fase 3. Ver `docs/SPEC_CONSOLA_SOPORTE.md`.
>
> **El override puede revertirse solo.** El estado es un valor DERIVADO: si los hechos no
> respaldan el estado forzado, el proximo recompute lo vuelve a cambiar. La UI lo advierte.

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/support/documents` | Listado paginado. Cada fila trae `projectedStatus` y `statusConsistent`. Query: `type` (`order` \| `quote`), `search`, `status`, `page`, `limit` (max 200), `sortBy`, `sortDir` |
| GET | `/api/support/statuses` | Estados presentes en los datos con su conteo, para el filtro. Query: `type` |
| GET | `/api/support/diagnostics/inconsistent` | Documentos cuyo estado guardado **no coincide** con el calculado. Query: `type`, `limit` (max 2000). Devuelve `scanned`, `total` y `truncated` |
| GET | `/api/support/documents/:type/:number` | Cabecera del documento. 400 si el tipo es invalido o el numero viene vacio; 404 si no existe |
| GET | `/api/support/documents/:type/:number/timeline` | Bitacora unificada. Query: `includeViews`, `includeMessages` (`1`/`true`) |
| GET | `/api/support/vocabulary` | Estados VALIDOS del tipo (para elegir destino del override), con su marca de terminal |
| PATCH | `/api/support/documents/:type/:guid/status` | **Override de estado.** Body `{ toCode, reasonNotes, reasonCode? }`. 400 si falta `toCode`, si el motivo viene vacio o si `toCode` no pertenece al vocabulario; 404 si el documento no existe |
| GET | `/api/support/documents/:type/:guid/actions` | **Acciones con intencion** disponibles, con el motivo de las que no |
| POST | `/api/support/documents/:type/:guid/actions/:action` | Ejecuta una accion (`return_to_manager`, `unblock_forward`, `annul`). Body `{ reasonNotes }`. Escribe HECHOS y recalcula: nunca el estado. Devuelve `expected` y `achieved` |
| GET | `/api/support/documents/:type/:guid/items` | Lineas del documento + `managerTurn` (si el gerente cerro su turno) |
| PATCH | `/api/support/documents/:type/:guid/items/:itemGuid` | **Estado de una linea.** Body `{ authorizationStatus?, sellerResponse?, authorizationRequired?, reasonNotes }`. Solo estados: precio, cantidad, descuento y producto NO se leen. `countered` es rechazado |
| POST | `/api/support/documents/:type/:guid/recompute` | Recalcula el estado del documento a partir de los hechos |
| GET | `/api/support/documents/:type/:guid/projected-status` | Que estado daria el recalculo HOY, **sin escribir**. `{ current, projected, matches, estimated }`. Es una estimacion: no re-evalua el credito |

### Orden de rutas

`documents` y `statuses` (literales) se declaran **antes** que `documents/:type/:number`.
Hoy no compiten (distinta cantidad de segmentos), pero es la convencion del repo.

### Por que el listado no sale de los endpoints existentes

Todos los listados de documentos del Middleware estan scopeados por vendedor o cliente
(`resolveEmail` + `sellerScope`) y a soporte le devuelven vacio o 404 — soporte no es el
vendedor de ningun documento. Por eso el Middleware suma un router propio
(`/api/mobility/support`, v1.240.0) que expone la misma data **sin** ese scope, protegido
con `requireApiKey`.

**Orden de los hitos**: cronologico, con un desempate dentro del mismo segundo — el
alta va primero. Las marcas de las distintas tablas difieren por milisegundos segun el
orden de escritura, no por cronologia real (ver v1.242.2 del Middleware).

La bitacora es un passthrough a `GET /mobility/document-timeline` del Middleware: alta,
ediciones, envio, decisiones por item, contraofertas, decision de cabecera, corridas del motor
de credito, pagos y su validacion, liberacion o denegacion de credito, cierre del turno del
gerente, envio a SAP y anulacion con motivo. `includeViews=1` suma quien MIRO el documento.

## Ordenes rechazadas por SAP

**Todo el modulo exige rol `RevisionSap`** (`SuperAdmin` pasa siempre). `Usuario` no entra.
Passthrough a `/api/mobility/backoffice-review` del Middleware (≥ 1.348.0). Ninguna respuesta
trae precios. Ver `docs/SPEC_REVISION_ORDENES_SAP.md`.

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/revision-sap/orders` | Bandeja, en dos vistas. Query: `view` (`pending` = `ProcessedBackoffice 0`, default \| `resolved` = `1`), `search`, `page`, `limit` (max 200), `sortBy` (`sapLastAttemptAt` \| `orderNumber` \| `customerName` \| `sellerEmail` \| `orderDate` \| `decidedAt`), `sortDir`. Cada fila trae `decidedBy`/`decidedAt` (quien cerro la revision y cuando) y `sapOrderNumber`/`sapDispatchNumber`, que dicen COMO se resolvio. ⚠️ Si `view` no viaja, el middleware devuelve pendientes y las dos pestañas muestran lo mismo **sin fallar** |
| GET | `/api/revision-sap/orders/:guid` | Detalle sin precios: cabecera, items con centro y destino, `sapAttempts`, `backoffice.inReview`. 400 si el guid es invalido; 404 si no existe |
| GET | `/api/revision-sap/orders/:guid/options` | Centros permitidos del cliente, destinos del area de la orden y, con `includeStock=1`, el stock de SAP por producto y centro. Las fuentes que fallan vienen en `errors` |
| PUT | `/api/revision-sap/orders/:guid/items/:itemGuid/destination` | Body `{ destinationCode, reasonNotes? }`. Quien hace el cambio sale del token. 400 destino invalido o fuera del area; 404 orden o linea inexistente; 409 la orden ya no esta en revision |
| PUT | `/api/revision-sap/orders/:guid/items/:itemGuid/center` | Body `{ centerCode, reasonNotes? }`. 400 centro invalido o no permitido para el cliente; 404 orden o linea inexistente; 409 la orden ya no esta en revision. Un centro sin stock se acepta |
| PUT | `/api/revision-sap/orders/:guid/group-invoice` | Body `{ groupInvoice: boolean, reasonNotes? }` — agrupa factura es de CABECERA: decide si la orden puede salir parcial. `groupInvoice` debe ser booleano (`"si"` o `1` dan 400). 404 orden inexistente; 409 la orden ya no esta en revision |
| POST | `/api/revision-sap/orders/:guid/resend` | Reenvia la orden COMPLETA a SAP. **Sin body**: que se manda lo decide el servidor y quien lo manda sale del token. Llama al envio del middleware (`businessorders2sap` con `asBackoffice: true`), que crea el pedido, estampa el resultado y cierra la revision si SAP acepta. Devuelve `{ accepted, skipped, sapOrderNumber, sapDispatchNumber, error, filteredItemsCount, stillInReview }`. 409 si el pedido ya existe en SAP; 503 si SAP no confirmo (⚠️ el pedido pudo haberse creado). Audita `REVISION_SAP_RESEND` siempre |
| GET | `/api/revision-sap/orders/:guid/sap-orders` | Ordenes SAP de la orden con su centro, su estado (`accepted` \| `accepted_no_dispatch` \| `rejected` \| `no_response`) y sus items, sin precios. Cada item trae la linea original (`itemGuid`, centro, destino) para poder corregirla |
| GET | `/api/revision-sap/orders/:guid/stock/:productCode` | Stock de un producto de la orden por centro y almacen, marcando los habilitados para el cliente. 404 si el producto no es de esa orden |

**Auditoria**: los cambios registran `REVISION_SAP_DESTINATION_CHANGE` y
`REVISION_SAP_CENTER_CHANGE` (categoria `SapReview`) solo si el valor realmente cambio. Las
lecturas no se auditan: quedan en los `ApiLogs` del Middleware.

**Lo que no esta**: el reenvio a SAP. Espera a que el Middleware parta la orden en una orden SAP
por centro, avise los items sin stock antes de enviar y no pueda duplicar pedidos.

## Matriz de autorizadores

**Todo el modulo exige rol `SuperAdmin`.** Expone los correos de todos los gerentes con
su banda de firma: es informacion de control interno. `Usuario` **no** entra — ver
`docs/ROLES_Y_PERMISOS.md`.

> **Solo lectura.** La matriz se replica de SAP (`[SAPServices].[dbo].[AuthorizerLimits]`
> + `[AuthorizerProfitCenters]`): una fila cargada a mano la pisa la proxima
> sincronizacion. Si hay que cambiarla, es un pedido a SAP. Ver
> `docs/SPEC_MATRIZ_AUTORIZADORES.md`.

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/authorizers/companies` | Typeahead de sociedades. Query: `q`, `limit` (max 50). Va primero porque sin sociedad no hay matriz que pedir |
| GET | `/api/authorizers/country-managers` | Country Managers de la sociedad — **el otro permiso**, el que no sale de la matriz. Query: `companyCode` (obligatorio). Devuelve `available` y `diagnosis` (ver abajo) |
| GET | `/api/authorizers` | La matriz, **una fila por autorizador**. Query: `companyCode` (obligatorio, max 8), `page`, `limit` (max 200, default 25), `search`, `sortBy`, `sortDir`, `filter`, `activeOnly`. Devuelve `data`, `pagination` y `summary` |

`sortBy` acepta: `userEmail`, `userId`, `minimumPercentage`, `maximumPercentage`,
`profitCenterCount`. Fuera de la whitelist cae a `userEmail`.
`filter` acepta: `all`, `blocked`, `whole-company`, `inactive-cebes`.

### Por que `companyCode` es obligatorio

Porque lo exige el endpoint del Middleware: no hay forma de pedir la matriz completa de
un saque. Por eso la pantalla arranca con un selector de sociedad y no con una tabla.

### Por que la respuesta no tiene el grano del Middleware

La vista devuelve 1 fila por (sociedad, correo, CEBE) — un gerente con 12 CEBEs son 12
filas. La pregunta es "quien esta en la matriz", asi que el grano de la respuesta es la
PERSONA. BackOffice agrupa, y por eso **pagina despues de agrupar**: paginar en el
Middleware partiria a un gerente entre dos paginas.

### `diagnosis`: por que vino vacia la lista de Country Managers

El endpoint del middleware responde **200 con lista vacia por tres causas distintas** y
solo una es un hecho del negocio. Presentar las otras dos como "nadie autoriza otra
forma de pago" seria afirmar algo falso, asi que se separan:

| `diagnosis` | Significa |
|---|---|
| `ok` | Hay resultados |
| `unavailable` | No se pudo consultar (tambien `available: false`) |
| `sin_nodo` | No existe ningun nodo `COUNTRY MANAGER%` en la jerarquia. **Los identifica por el NOMBRE del nodo**, asi que un renombre los esconde a todos |
| `sin_miembros` | Existe el nodo, pero ninguno de sus integrantes resuelve a esta sociedad (o le falta la fila en `Users` con su `SapCompanyCode`) |

Para distinguir los dos ultimos, BackOffice consulta
`/mobility/commercial-team-hierarchy/tree` — **solo cuando la lista vino vacia**. En el
caso normal esa llamada no se hace.

### La banda viene interpretada, y los crudos tambien

Cada autorizador trae `band: { min, max, blocked, reason }` **y** los
`minimumPercentage`/`maximumPercentage` crudos. Los crudos mienten leidos literal
(`0/0` = no puede firmar, `200/200` = sin limite), asi que la UI muestra `band`; los
crudos quedan para poder auditar contra SAP. Ver `SPEC_MATRIZ_AUTORIZADORES.md` §5.

`coversWholeCompany: true` sale de una fila con CEBE nulo: es el alcance **maximo**
(el Middleware lo resuelve como `ProfitCenter = @Pc OR ProfitCenter IS NULL`), no una
ausencia.

## Auditoria

Las escrituras dejan traza en `AuditLogs` con `AppId='MobilityBackOffice'`:

| Action | Category | Entity | EntityId |
|---|---|---|---|
| `LOGIN` / `LOGIN_FAILED` | `auth` | `Auth` | — |
| `REGION_CEBE_LINK` | `regions` | `ContinentProfitCenter` | codigo del CEBE |
| `REGION_CEBE_UNLINK` | `regions` | `ContinentProfitCenter` | codigo del CEBE |
| `REGION_SYNC` | `regions` | `ContinentProfitCenter` | — |
| `SUPPORT_ACTION` | `support` | `BusinessOrders` / `BusinessQuotes` | numero del documento |
| `SUPPORT_STATUS_OVERRIDE` | `support` | `BusinessOrders` / `BusinessQuotes` | numero del documento (camino avanzado) |
| `SUPPORT_ITEM_OVERRIDE` | `support` | `BusinessOrderItems` / `BusinessQuoteItems` | numero del documento |
| `SUPPORT_RECOMPUTE` | `support` | `BusinessOrders` / `BusinessQuotes` | numero del documento (solo si el estado cambio) |
