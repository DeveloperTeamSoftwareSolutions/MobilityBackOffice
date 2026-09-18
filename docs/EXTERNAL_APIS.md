# APIs y Endpoints Externos — Mobility BackOffice

> Ultima actualizacion: 2026-09-18
> Version: 2.36.0

## Integraciones activas

### ITManager (ManageIT) — autoridad de identidad y rol

- **Base URL**: `ITMANAGER_AUTH_URL` (ej. `http://100.66.245.49:61100/api`)
- **Autenticacion**: se le pasan las credenciales del usuario; devuelve identidad + accessMatrix
- **Endpoints usados**:
  | Metodo | Endpoint | Descripcion | Archivo |
  |---|---|---|---|
  | POST | `/auth/login` | Valida credenciales, devuelve `{ user, session.token, accessMatrix }` | `src/auth/itmanager.client.ts` |
- **Nota**: BackOffice NO reusa el `session.token`. Con la identidad y los roleKeys del
  accessMatrix firma su **propio** JWT. Ver `docs/AUTENTICACION.md`.

### MobilityMiddleWare — acceso a datos (unico componente que toca SQL)

BackOffice **NO se conecta a SQL Server**. Toda la data (regiones, CEBEs, sociedades, almacenes, el
alcance por sociedad del usuario y la auditoria central) se consume por HTTP contra el
MobilityMiddleWare, que es el unico
componente del ecosistema que conecta a la base. Regla del ecosistema, igual que
MobilityManager. Ya no hay Prisma ni `DATABASE_URL`.

- **Base URL**: `MIDDLEWARE_URL` (dev `http://localhost:6002/api`; prod = mismo Middleware
  que MobilityManager). La URL **incluye** el prefijo `/api`.
- **Autenticacion**: header `x-api-key` contra `MIDDLEWARE_API_KEY`.
  ⚠️ **Requisito de deploy**: el router `/mobility/support` va montado con `requireApiKey`,
  que es **no-op si el Middleware no tiene `MIDDLEWARE_API_KEY` seteada** (verificado
  2026-08-25: `/api/sellers` responde 200 sin key). Sin esa variable esas rutas quedan
  abiertas. Ver `docs/SPEC_CONSOLA_SOPORTE.md`. Ademas se manda **siempre** `x-source-app:
  MobilityBackOffice` para que la auditoria automatica del Middleware (`ApiLogs`) atribuya
  cada llamada.
- **Endpoints consumidos** (relativos a `MIDDLEWARE_URL`):
  | Metodo | Endpoint | Descripcion | Objeto SQL detras | Archivo |
  |---|---|---|---|---|
  | GET | `/mobility/regions` | Listado de regiones + conteo de CEBEs | `dbo.Continents` | `src/regions/regions.client.ts` |
  | GET | `/mobility/regions/:guid` | Region por Guid | `dbo.Continents` | idem |
  | GET | `/mobility/regions/by-code/:code` | Region por Code | `dbo.Continents` | idem |
  | GET | `/mobility/regions/:guid/cebes` | Vinculos de la region | `dbo.ContinentProfitCenters` | idem |
  | POST | `/mobility/regions/:guid/cebes` | Vincular CEBE-region-sociedad (upsert) | `dbo.ContinentProfitCenters` | idem |
  | DELETE | `/mobility/regions/:guid/cebes/:code?companyCode=` | Desvincular (soft delete) | `dbo.ContinentProfitCenters` | idem |
  | GET | `/mobility/regions/groups` | **Agrupaciones de regiones** (CAYCAR): `[{ code, name, members, pairs }]`. **Requiere MW ≥ 1.331.0** | `dbo.VIEW_RegionGroupProfitCenters` | idem |
  | GET | `/mobility/regions/resolve?codes=` | Pares (CEBE, sociedad) efectivos. Acepta codigos de region atomica **y de agrupacion** (`codes=CAYCAR`, MW ≥ 1.331.0): para una agrupacion devuelve sus pares segun la vista, no la union de sus miembros | `dbo.ContinentProfitCenters` + `dbo.VIEW_RegionGroupProfitCenters` | idem |
  | GET | `/mobility/regions/links/codes` | CEBEs con link activo | `dbo.ContinentProfitCenters` | idem |
  | GET | `/mobility/regions/links/multi-region` | CEBEs en varias regiones | `dbo.ContinentProfitCenters` | idem |
  | GET | `/v2/mobility/profit-centers` | Maestro de CEBEs (typeahead, diagnosticos) | `dbo.VIEW_V2_ProfitCentersMobility` | idem |
  | GET | `/v2/mobility/companies` | Maestro de sociedades (typeahead) | `dbo.VIEW_V2_CompaniesMobility` sobre `[SAPServices].[dbo].[Companies]` | idem |
  | POST | `/audit-logs` | Traza central (append) | `dbo.AuditLogs` | `src/audit/audit.client.ts` |
  | GET | `/mobility/document-timeline` | Bitacora unificada de una orden/cotizacion (consola de soporte) | `BusinessOrders`/`BusinessQuotes` + `Auditories`, pagos, credito y resoluciones | `src/support/support.client.ts` |
  | GET | `/mobility/support/documents` | Listado de documentos SIN scope de vendedor (consola de soporte) | `BusinessOrders` / `BusinessQuotes` | idem |
  | GET | `/mobility/support/statuses` | Estados presentes con su conteo, para el filtro | idem | idem |
  | GET | `/v2/mobility/authorizer-limits-profit-centers` | **La matriz de autorizadores** de una sociedad (banda + CEBEs). `companyCode` obligatorio | `dbo.VIEW_V2_AuthorizerLimitsProfitCentersMobility` sobre `[SAPServices].[dbo].[AuthorizerLimits]` + `[AuthorizerProfitCenters]` | `src/authorizers/authorizers.client.ts` |
  | GET | `/mobility/commercial-team-hierarchy/country-manager` | Country Managers de la sociedad — autorizan "otra forma de pago", que NO pasa por la matriz. Filtra por `cth.Name LIKE 'COUNTRY MANAGER%'` y por `Users.SapCompanyCode` | `dbo.CommercialTeamHierarchies` + `dbo.CommercialTeamMembers` + `dbo.Users` | idem |
  | GET | `/v2/mobility/profit-centers` | Nombre del CEBE para la matriz (la vista solo trae el codigo) | `dbo.VIEW_V2_ProfitCentersMobility` | idem |
  | GET | `/mobility/backoffice-review/orders` | **Bandeja de ordenes rechazadas por SAP** (`ProcessedBackoffice = 0`). **Requiere MW ≥ 1.348.0** | `dbo.BusinessOrders` + conteos de `dbo.SAPOrders` / `dbo.BusinessOrderItems` | `src/revision-sap/revision-sap.client.ts` |
  | GET | `/mobility/backoffice-review/orders/:guid` | Detalle SIN precios: cabecera, items con centro y destino, intentos de SAP | `dbo.BusinessOrders`, `dbo.BusinessOrderItems`, `dbo.SAPOrders` | idem |
  | GET | `/mobility/backoffice-review/orders/:guid/options?includeStock=` | Centros permitidos del cliente, destinos del area de la orden y stock de SAP por centro | `[SAPServices].[dbo].[Warehouses]` + `WarehouseCustomers`, `VIEW_V2_CustomerDeliveryDestinationsMobility`, SAP `catalogs/stock` | idem |
  | PUT | `/mobility/backoffice-review/orders/:guid/items/:itemGuid/destination` | Cambia el destino de una linea; el MW valida area y revision, audita y comenta en el hilo | `dbo.BusinessOrderItems`, `dbo.BusinessOrders` | idem |
  | PUT | `/mobility/backoffice-review/orders/:guid/items/:itemGuid/center` | Cambia el centro de una linea; el MW exige un centro permitido para el cliente, audita y comenta en el hilo | `dbo.BusinessOrderItems`, `dbo.BusinessOrders`, `[SAPServices].[dbo].[Warehouses]` | idem |
  | GET | `/mobility/backoffice-review/orders/:guid/sap-orders` | Ordenes SAP de la orden con su estado y sus items, sin precios | `dbo.SAPOrders`, `dbo.SAPOrdersItems` | idem |
  | GET | `/mobility/user-scope` | **El alcance por sociedad** del usuario logueado: `{ isAdmin, userGuids, companyCodes }`. Query: `guidUsers` (el `Users.Guid` del token de BackOffice), `includeSelf`. Lo consume Centros y Almacenes, la unica seccion que recorta filas por usuario | `dbo.fn_SubordinatesByUser` + `dbo.Users` | `src/scope/scope.client.ts` |
  | GET | `/mobility/warehouse-customers/centers` | Centros de distribucion del alcance, con su conteo de almacenes y de restringidos | `[SAPServices].[dbo].[Warehouses]` + `RestrictedCenters` | `src/warehouses/warehouses.client.ts` |
  | GET | `/mobility/warehouse-customers/warehouses` | Almacenes de un centro con `customerCount` y `groupCount` | `[SAPServices].[dbo].[Warehouses]` + `WarehouseCustomers` + `WarehouseCustomerGroups` | idem |
  | GET | `/mobility/warehouse-customers/reserved` | Clientes reservados a un almacen | `dbo.WarehouseCustomers` | idem |
  | GET | `/mobility/warehouse-customers/customer-search` | Buscador de clientes por codigo o nombre | `dbo.CustomerDetails` | idem |
  | POST · DELETE | `/mobility/warehouse-customers` | Reserva y quita un cliente. El MW marca el almacen restringido con la primera reserva y lo libera **solo cuando no le queda ninguna** | `dbo.WarehouseCustomers` + `[SAPServices].[dbo].[Warehouses]` | idem |
  | GET | `/mobility/warehouse-customers/groups` | Grupos de clientes de SAP reservados al almacen. **Requiere MW ≥ 1.357.0** | `dbo.WarehouseCustomerGroups` | idem |
  | GET | `/mobility/warehouse-customers/group-search` | Buscador de grupos con clientes en la sociedad. El 37 vuelve con `assignable: false`. **MW ≥ 1.357.0** | `dbo.CustomerDetails` | idem |
  | GET | `/mobility/warehouse-customers/groups/customers` | Clientes de un grupo en una sociedad, paginado. **MW ≥ 1.357.0** | `dbo.CustomerDetails` | idem |
  | POST · DELETE | `/mobility/warehouse-customers/groups` | Reserva y quita un grupo. Se guarda el **codigo** del grupo, nunca la lista de clientes. **MW ≥ 1.357.0** | `dbo.WarehouseCustomerGroups` | idem |
  | PUT | `/mobility/warehouse-customers/availability` | Libera un almacen (borra sus reservas) | `[SAPServices].[dbo].[Warehouses]` | idem |
  | PUT | `/mobility/warehouse-customers/center-restriction` | Restringe o libera un CENTRO entero, con motivo | `dbo.RestrictedCenters` | idem |
- **Cross-database y collations**: el join a `[SAPServices].[dbo].[Companies]` y el manejo de
  collations ocurren **dentro del Middleware** (via `VIEW_V2_CompaniesMobility`). BackOffice ya
  no depende de eso: es una preocupacion del Middleware, no de esta app.
- **Nota de paths**: los path constants del cliente son relativos a `MIDDLEWARE_URL` (que ya
  trae `/api`). Verificado contra el Middleware en vivo.
- **Piso de version — agrupaciones de regiones (desde BackOffice 2.16.0)**: la seccion Regiones
  pide `/mobility/regions/groups`, que existe desde **MW 1.331.0**. Un middleware anterior
  responde 404 — sin cuerpo (< 1.176.0, sin router de regiones) o con `Region not found`
  (1.176.0 – 1.330.x, donde `/groups` cae en `GET /:guid`). **Todo 404 de ese endpoint** se
  traduce a **503 "requiere MW ≥ 1.331.0"**: nunca a "no hay agrupaciones" ni a una union
  calculada localmente. Contra un MW asi la lista de la seccion falla entera (la web pide
  regiones y agrupaciones juntas).
  **Orden de deploy**: vista `dbo.VIEW_RegionGroupProfitCenters` → MW 1.331.0 → BackOffice 2.16.0.
- **Piso de version — ordenes rechazadas por SAP (desde BackOffice 2.27.0)**: la seccion pide
  `/mobility/backoffice-review/*`, que existe desde **MW 1.348.0** (PR #646). Con un Middleware
  anterior la bandeja responde **503 "no está disponible"**. El stock sale de SAP: el timeout
  del cliente es 150 s con `includeStock=1` y 20 s en el resto.
  **Orden de deploy**: MW 1.348.0 → SQL 008 + rol en ITManager → BackOffice 2.27.0.
- **Piso de version — reserva de almacen por grupo de clientes (desde BackOffice 2.36.0)**: la
  seccion Centros y Almacenes pide `/mobility/warehouse-customers/groups`, `/group-search` y
  `/groups/customers`, que existen desde **MW 1.357.0**. El resto de la seccion (centros, almacenes,
  reservas **por cliente**, restriccion de centro) funciona con un Middleware anterior: **solo avisa
  la reserva por grupo**.
  Los errores se traducen por `code`, nunca por el texto, porque hay dos fallas que se parecen y
  piden deploys distintos: `503 customer_groups_not_deployed` es el MW nuevo **sin la tabla**
  `WarehouseCustomerGroups` (falta SQL), y un `404` **sin cuerpo** es un MW anterior al piso (falta
  desplegar el MW). El unico 404 real de esos endpoints trae `code: warehouse_not_found`.
  **Orden de deploy**: tabla `WarehouseCustomerGroups` → MW 1.357.0 → BackOffice 2.36.0.
  **No hay SQL propio de BackOffice**: las tablas son del Middleware y ya existen.

### WhatsApp WABA Admin — plantillas de WhatsApp

Las plantillas viven en la base `WhatsAppWABA`, que el middleware **no expone**. Se
consumen directo de la API REST del panel, con el criterio de MobilityManager: se traen
los DATOS y BackOffice arma su propia pantalla. Ver `docs/SPEC_PLANTILLAS_WHATSAPP.md`.

- **Base URL**: `WABA_API_URL` (dev `http://localhost:3020`)
- **Autenticacion**: header `x-api-key` (`WABA_API_KEY`) + `x-source-app:
  MobilityBackOffice`. **La cuenta WABA es implicita en la key**: una key = una cuenta.
- **Endpoints usados** (todos desde `src/templates/templates.client.ts`):

  | Metodo | Endpoint | Descripcion |
  |---|---|---|
  | GET | `/api/templates?status=all&limit=200` | Plantillas de la cuenta, **todos los estados** |
  | GET | `/api/templates/:id` | Detalle + politica de edicion de META |
  | POST | `/api/templates` | Crear y enviar a aprobacion |
  | PUT | `/api/templates/:id` | Editar y reenviar a revision |
  | DELETE | `/api/templates/:id` | Borrar (META y local; un borrador, solo local) |
  | POST | `/api/templates/sync` | Traer de META lo que cambio alla |
  | POST | `/api/templates/validate` | El payload que recibiria META. **No escribe nada** |
  | POST | `/api/templates/upload-sample` | Ejemplo del encabezado multimedia → `handle` |
  | POST | `/api/templates/drafts` | Guardar el avance sin mandar nada a META |
  | GET | `/api/templates/drafts/:id` | Recuperar un borrador |
  | POST | `/api/templates/drafts/:id/submit` | Recien aca el borrador se manda a META |

- **Compatibilidad**: `GET /api/templates` **sin query params** conserva el contrato
  viejo (array plano de aprobadas). Es lo que consume el selector de plantillas del
  propio panel al enviar un mensaje; cambiarlo rompia el envio.
- **Errores**: WABA responde `{ success, message }` con el mensaje de META ya extraido y
  **con el access token enmascarado** (`friendlyError`). El client conserva ese texto
  tanto en 4xx como en 5xx: sin el, un token invalido llega como un 503 sin motivo.
- **Requiere del lado de WABA**: para `upload-sample`, la cuenta necesita **App ID y un
  access token valido** — la subida va a la Resumable Upload API de META, contra el App
  ID y no contra el `phone_number_id`.

## Integraciones consumidas por terceros

### Web service de sync de Regiones

BackOffice **expone** un endpoint para que un sistema externo (pensado para SAP) reconcilie los
vinculos de forma idempotente.

- **Endpoint**: `POST /api/regions/sync`
- **Autenticacion**: header `x-api-key` contra `REGIONS_SYNC_API_KEY`
- **Contrato**: ver `docs/API_ENDPOINTS.md`

### DuwyEngineRAG — cargador de documentacion (embebido)

- **Base URL**: `RAG_URL` (ej. `http://100.89.65.72:3800`)
- **Como se consume**: **reverse-proxy same-origin** en `/rag`. El RAG manda
  `X-Frame-Options: SAMEORIGIN`, asi que no se puede iframe directo desde otro origen; el
  backend proxya `/rag/*` → RAG y reescribe sus rutas absolutas (`/css/`, `/js/`, `/api/`).
- **Auth**: el proxy exige sesion de BackOffice (cookie httpOnly `bo_rag_token`, scopeada a
  `/rag`, seteada en el login) y rol Marketing o SuperAdmin. El RAG no tiene auth propia.
- **Tenant**: manual — el usuario escribe el CompanyCode en la topbar del RAG.
- **Archivos**: `src/rag/rag.proxy.ts`, `src/rag/rag-rewrite.ts`. Spec: `docs/SPEC_RAG_EMBED.md`.
