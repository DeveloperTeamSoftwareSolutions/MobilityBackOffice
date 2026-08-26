# API — Mobility BackOffice

> Ultima actualizacion: 2026-08-25
> Version: 2.4.0

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
| GET | `/api/regions/groups` | Agrupaciones virtuales (CAYCAR = CA + CB) con su conteo de CEBEs efectivos |
| GET | `/api/regions/cebes/available` | Typeahead de CEBEs. Query: `q`, `limit` (max 50) |
| GET | `/api/regions/companies` | Typeahead de sociedades. Query: `q`, `limit` (max 50) |
| GET | `/api/regions/diagnostics/unmapped` | CEBEs del maestro sin ninguna region |
| GET | `/api/regions/diagnostics/multi` | CEBEs vinculados a mas de una region |
| GET | `/api/regions/:code/resolve` | Pares (CEBE, sociedad) efectivos. `CAYCAR` → union sin duplicados de CA y CB |
| GET | `/api/regions/:guid` | Region + sus vinculos. 404 si no existe |
| POST | `/api/regions/:guid/cebes` | Vincular. Body `{ cebes: [{ code, companyCode, name? }] }` → `{ success, linked }`. 400 si la lista viene vacia o si algun item no trae `companyCode`; 404 si la region no existe |
| DELETE | `/api/regions/:guid/cebes/:code/:companyCode` | Desvincular (soft delete). 404 si el vinculo no existia |

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

## Auditoria

Las escrituras dejan traza en `AuditLogs` con `AppId='MobilityBackOffice'`:

| Action | Category | Entity | EntityId |
|---|---|---|---|
| `LOGIN` / `LOGIN_FAILED` | `auth` | `Auth` | — |
| `REGION_CEBE_LINK` | `regions` | `ContinentProfitCenter` | codigo del CEBE |
| `REGION_CEBE_UNLINK` | `regions` | `ContinentProfitCenter` | codigo del CEBE |
| `REGION_SYNC` | `regions` | `ContinentProfitCenter` | — |
| `SUPPORT_STATUS_OVERRIDE` | `support` | `BusinessOrders` / `BusinessQuotes` | numero del documento |
| `SUPPORT_ITEM_OVERRIDE` | `support` | `BusinessOrderItems` / `BusinessQuoteItems` | numero del documento |
| `SUPPORT_RECOMPUTE` | `support` | `BusinessOrders` / `BusinessQuotes` | numero del documento (solo si el estado cambio) |
