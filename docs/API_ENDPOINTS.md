# API — Mobility BackOffice

> Ultima actualizacion: 2026-09-25
> Version: 2.44.0

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
| POST | `/api/revision-sap/orders/:guid/resend` | Reenvia la orden a SAP, **partida en una orden SAP POR CENTRO**. **Sin body**: que se manda lo decide el servidor y quien lo manda sale del token. Llama al envio PROPIO de BackOffice del middleware (`businessorders2sap-from-backoffice` con `asBackoffice: true`), que agrupa los items por `CenterCode` y hace una llamada a SAP por cada centro distinto. Devuelve `{ accepted, partial, skipped, buckets[], totalBuckets, acceptedBuckets, failedBuckets, error, filteredItemsCount, itemsSent, stillInReview }`, con un `bucket` por centro (`{ centerCode, itemsCount, status, sapOrderNumber, sapDispatchNumber, error, sapMessages }`). 409 si el pedido ya existe en SAP; 503 si SAP no confirmo (⚠️ los pedidos pudieron haberse creado). Audita `REVISION_SAP_RESEND` siempre, con el desenlace POR CENTRO en el detalle. **Requiere Middleware ≥ 1.361.1** (antes de esa version el envio por centro rebotaba todo con 422) |
| POST | `/api/revision-sap/orders/:guid/reject` | **Rechaza la orden. Es TERMINAL y no se deshace.** Body `{ reasonNotes }` — el motivo es **obligatorio** (vacio da 400): el estado que le llega al vendedor solo dice "Rechazada", asi que el comentario del hilo es lo unico que va a poder leer. La orden pasa a `Rejected`, sale de la bandeja y el vendedor solo puede copiarla. 404 orden inexistente; 409 si ya no esta en revision o ya fue rechazada. Audita `REVISION_SAP_REJECT` siempre |
| GET | `/api/revision-sap/orders/:guid/sap-orders` | Ordenes SAP de la orden con su centro, su estado (`accepted` \| `accepted_no_dispatch` \| `rejected` \| `no_response`) y sus items, sin precios. Cada item trae la linea original (`itemGuid`, centro, destino) para poder corregirla |
| GET | `/api/revision-sap/orders/:guid/stock/:productCode` | Stock de un producto de la orden por centro y almacen, marcando los habilitados para el cliente. 404 si el producto no es de esa orden |

**Auditoria**: los cambios registran `REVISION_SAP_DESTINATION_CHANGE` y
`REVISION_SAP_CENTER_CHANGE` (categoria `SapReview`) solo si el valor realmente cambio. Las
lecturas no se auditan: quedan en los `ApiLogs` del Middleware. El rechazo
(`REVISION_SAP_REJECT`) se audita **siempre** y sin condicion de "cambio": no hay rechazo que
no cambie nada, y es la accion que cierra el documento.

**Que significa cada fallo del reenvio (v2.39.1)**: el mensaje distingue si la operacion se ejecuto o no.
Antes cualquier fallo no contemplado caia en *"SAP no confirmo el envio, verifica en SAP"* — y un 401 por API key
equivocada mandaba a buscar en SAP un pedido que nunca se intento crear.

| Fallo | Que se le dice al operador | Se ejecuto algo? |
|---|---|---|
| `401` / `403` | Falta `MIDDLEWARE_API_KEY` o no coincide con la del Middleware | **No.** Ni se intento |
| `422` | El motivo del Middleware (faltan centros, sin stock) + "no se creo ningun pedido" | **No.** Corto antes de SAP |
| `409` | El pedido ya existe: reenviarlo lo duplicaria | No (lo frena) |
| `404` | Orden inexistente | No |
| `ECONNREFUSED` | No se pudo contactar al Middleware | **No.** No salio |
| **timeout** / `5xx` | *"Verifica en SAP si se crearon pedidos antes de reintentar"* | **INCIERTO** — puede haber salido una parte |

La ultima fila es la unica que manda a mirar SAP, y es la unica que lo amerita: con la orden partida por centro,
un corte a mitad de camino puede dejar algunos pedidos creados y otros no.

**Rechazar (v2.38.0)**: se eligio `Rejected` y no `Annulled` porque el estado dice la verdad de
lo que paso —alguien que evaluo la orden dijo que no— y se ve en rojo. **Del lado del vendedor no
hubo que tocar nada**: MobilityIA ya trata el estado legacy `AuthorizationRejected` como
documento cerrado (no admite pagos ni anulacion) y Copiar sigue disponible siempre. ⚠️ Requiere
`MIGRATION_BusinessOrders_BackofficeRejected.sql` (repo MobilityMiddleWare) aplicado en la base.

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

## Centros y Almacenes

**Todo el modulo exige rol `Administrador` o `Usuario`** (`SuperAdmin` pasa siempre por el
`RolesGuard`). **Los dos roles estan en el decorador a proposito.** La visibilidad del front se
resuelve por exclusion: una seccion nueva le queda visible a `Usuario` sola. Si aca se declarara
solo `Administrador`, la seccion le apareceria en el menu y la API le responderia 403 — la
pantalla visible y rota. Un test del controller lo fija (`warehouses.controller.spec.ts`).

Passthrough a `/api/mobility/warehouse-customers` del Middleware, que es el dueño de las tablas y
de la regla: **no hay SQL ni tablas propias de esta seccion**. La reserva por grupo requiere
**MW ≥ 1.357.0**. Ver `docs/SPEC_BACKOFFICE_ALMACENES.md`.

> **Alcance por sociedad** — es la unica seccion de BackOffice que lo lleva. Las **lecturas** fuera
> del alcance devuelven **vacio** (mirar no es una accion prohibida); las **escrituras** fuera del
> alcance devuelven **403**, antes de llamar al Middleware y antes de auditar. Ver
> `docs/JERARQUIA_Y_VISIBILIDAD.md`.

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/warehouses/centers` | Centros del alcance, paginado. Query: `page`, `limit` (max 200), `search`, `sortBy` (`companyCode`\|`centerCode`\|`centerName`\|`warehouseCount`\|`restrictedCount`\|`restricted`), `sortDir`. Un `sortBy` fuera de la whitelist cae al default y **no viaja** al Middleware |
| GET | `/api/warehouses` | Almacenes de un centro, con `customerCount` y `groupCount`. Query: `companyCode` y `centerCode` (obligatorios), `onlyRestricted` (`1`/`true`), `search`, `page`, `limit` (max 200). 400 si falta la sociedad o el centro |
| GET | `/api/warehouses/customers` | Clientes reservados a un almacen. Query: `companyCode`, `centerCode`, `warehouseCode` (los tres obligatorios) |
| GET | `/api/warehouses/customer-search` | Buscador de clientes por codigo o nombre. Query: `q`. Sin termino devuelve vacio. **No se recorta por sociedad**: el maestro de clientes es global y el alcance corta al reservar |
| POST | `/api/warehouses/customers` | Reserva el almacen a un cliente (lo restringe). Body `{ companyCode, centerCode, warehouseCode, customerCode }`. 403 fuera del alcance |
| DELETE | `/api/warehouses/customers` | Quita un cliente. Misma clave, por query o por body. 403 fuera del alcance |
| GET | `/api/warehouses/groups` | Grupos de clientes de SAP reservados al almacen, con su conteo de clientes en la sociedad |
| GET | `/api/warehouses/group-search` | Buscador de grupos. Query: `companyCode` (obligatorio), `q`, `limit` (default 20, max 50). **El 37 viene con `assignable: false`**: se muestra deshabilitado, no se oculta |
| GET | `/api/warehouses/groups/customers` | Clientes de un grupo en una sociedad, paginado. Query: `companyCode`, `customerGroupCode`, `search`, `page`, `limit` (max 200). Para **leer** no se rechaza el 37 |
| POST | `/api/warehouses/groups` | Reserva el almacen a un grupo. Body `{ companyCode, centerCode, warehouseCode, customerGroupCode }`. **400 si es el 37** (se corta aca, sin viajar al Middleware), si el codigo tiene mas de 2 caracteres o si el grupo no tiene clientes en esa sociedad. 403 fuera del alcance |
| DELETE | `/api/warehouses/groups` | Quita un grupo. **El 37 SI se puede quitar**: si alguna vez quedo reservado por fuera, hay que poder sacarlo. Devuelve `stillRestricted` |
| PUT | `/api/warehouses/availability` | Restringe o libera un almacen. Body `{ companyCode, centerCode, warehouseCode, restricted }`. `restricted` debe ser booleano |
| PUT | `/api/warehouses/center-restriction` | Restringe o libera un CENTRO entero, para todos. Body `{ companyCode, centerCode, centerName?, restricted, reason? }`. La clave es (sociedad, centro) — **sin almacen**. El motivo se recorta a 512 caracteres antes de salir |

### Los errores del Middleware se traducen por `code`, no por texto

El `error` del Middleware viene en ingles y cambia con cualquier reescritura; el `code` es el
contrato estable. Dos casos que parecen iguales y no lo son, y que para quien mira la pantalla
terminan en el mismo lugar ("no esta disponible en este entorno"):

| Respuesta del Middleware | Que significa | Que responde BackOffice |
|---|---|---|
| `503 customer_groups_not_deployed` | El MW es nuevo pero falta la tabla `WarehouseCustomerGroups` | 503, nombrando la tabla (falta deploy de **SQL**) |
| `404` **sin** `code` | El MW es anterior a 1.357.0 y la ruta no existe | 503 "requiere MW ≥ 1.357.0" (falta deploy del **MW**) |
| `404 warehouse_not_found` | El unico 404 real de estos endpoints | 404 "Almacen no encontrado" |

Con un Middleware anterior al piso, **las reservas por cliente siguen funcionando**: solo avisa la
reserva por grupo.

## Consistencia de datos

**Todo el modulo exige rol `SuperAdmin`.** Detecta inconsistencias entre jerarquia comercial,
carteras, usuarios y SAP, y corrige las que son dato comercial. Las reglas y las escrituras son
del Middleware (`/mobility/backoffice-consistency`, **MW ≥ 1.378.0**); BackOffice agrega el actor
del token y la auditoria central. Ver `docs/SPEC_CONSISTENCIA_DE_DATOS.md`.

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/consistency/summary` | Conteo por grupo y por categoria (`JERARQUIA`, `CARTERA`, `USUARIOS_SAP`), `sapAccountsAvailable`, `generatedAt`. Query: `refresh=1` |
| GET | `/api/consistency/findings` | Hallazgos paginados. Query: `page`, `limit` (max 200; 50.000 con `export=1`), `group`, `category`, `resolution`, `companyCode`, `search`, `sortBy`, `sortDir`, `refresh`. Devuelve `data`, `companies`, `generatedAt`, `pagination` |
| GET | `/api/consistency/nodes` | Nodos de la jerarquia y roles validos de miembro, para el alta |
| GET | `/api/consistency/customer-gaps` | Clientes de cartera vs SAP, **solo lectura**. Query: `gapType`, `companyCode`, `search`, `page`, `limit`, `sortBy`, `sortDir`, `export`. Devuelve `available` (ver abajo), `data`, `summary`, `pagination` |
| POST | `/api/consistency/members` | Alta de un miembro. Body: `guidCommercialTeamHierarchies`, `memberSapUserId`, `memberName`, `role`, `memberGuidUsers?`, `reason`, `findingGroup?`. 201 |
| PUT | `/api/consistency/members/:guid/sap-user-id` | Corrige el SapUserId. Body: `memberSapUserId`, `expectedSapUserId` (obligatorio, `null` si no tenia), `reason`, `findingGroup?` |
| POST | `/api/consistency/members/:guid/remove` | Baja (soft delete). Body: `reason`, `findingGroup?` |
| POST | `/api/consistency/portfolios/:guid/owner` | Dueno comercial de una cartera sin dueno. Body: `ownerSapUserId`, `ownerName`, `ownerGuidUsers?`, `ownerEmail?`, `reason`, `findingGroup?`. 201 |

`sortBy` de hallazgos acepta `severity` (default), `companyCode`, `personName`, `sapUserId`,
`group`. Filtros fuera de su lista son **400**, no se ignoran: un filtro ignorado en silencio
devuelve "todo" y se lee como "esto es lo que hay".

**Correcciones.** El actor sale del token (un `actorEmail` en el body se descarta). `reason` es
obligatorio (5 a 500). Errores:

| Status | Cuando | Se aplico? |
|---|---|---|
| 400 | Datos invalidos (aca o en el Middleware) | No |
| 404 | El nodo, miembro o cartera ya no existe | No |
| 409 | Ya esta en ese nodo · el miembro cambio desde que se listo · la cartera ya tiene dueno | No |
| 503 "No se aplicó ningún cambio" | El Middleware respondio con error (su transaccion se deshace) o rechazo la credencial | No |
| 503 "no se sabe si la corrección se aplicó" | Sin respuesta del Middleware (red, tiempo) | **No se sabe**: actualizar antes de reintentar |

**`customer-gaps` y `available`.** Sale de `/v2/mobility/portfolio-gaps` (PR #727 del
Middleware). Si el Middleware del ambiente no lo tiene (404), responde `available: false` con
lista vacia: la pantalla dice "todavia no esta disponible" en vez de "no hay brechas".

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
| `WAREHOUSE_CUSTOMER_ADD` / `WAREHOUSE_CUSTOMER_REMOVE` | `Warehouses` | `Warehouse` | codigo del almacen (la sociedad, el centro y el cliente van en `Detail`) |
| `WAREHOUSE_CUSTOMER_GROUP_ADD` / `WAREHOUSE_CUSTOMER_GROUP_REMOVE` | `Warehouses` | `Warehouse` | codigo del almacen (el grupo y el estado resultante van en `Detail`) |
| `WAREHOUSE_RESTRICT` / `WAREHOUSE_ENABLE` | `Warehouses` | `Warehouse` | codigo del almacen |
| `CENTER_RESTRICT` / `CENTER_ENABLE` | `Warehouses` | `DistributionCenter` | `sociedad/centro` (el motivo va en `Detail`) |
| `CONSISTENCY_MEMBER_CREATED` | `Consistency` | `CommercialTeamMembers` | guid del miembro nuevo (SapUserId, nombre, rol, nodo, hallazgo y motivo en `Detail`) |
| `CONSISTENCY_MEMBER_SAPUSERID_CHANGED` | `Consistency` | `CommercialTeamMembers` | guid del miembro (antes, despues, hallazgo y motivo en `Detail`) |
| `CONSISTENCY_MEMBER_REMOVED` | `Consistency` | `CommercialTeamMembers` | guid del miembro |
| `CONSISTENCY_PORTFOLIO_OWNER_ASSIGNED` | `Consistency` | `Portfolios` | guid de la cartera |

Las de Almacenes son **best-effort** (`safeRecord`): el CRUD ya ocurrio del lado del Middleware y un
fallo del audit central no revierte nada ni rompe la respuesta. Lo que **no** es best-effort es
`guidApiLoginClients`: sin el, la fila se guarda pero ITManager no la muestra.

Mientras la seccion conviva con la de MobilityManager (paso 5 del traspaso), en ITManager van a
verse **dos categorias que se leen igual**: `Warehouses` (esta app) y `warehouses` (MobilityManager,
en minuscula). Se distinguen por `AppId`, y la segunda desaparece con la baja alla.
