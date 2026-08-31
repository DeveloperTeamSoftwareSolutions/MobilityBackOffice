# APIs y Endpoints Externos — Mobility BackOffice

> Ultima actualizacion: 2026-08-31
> Version: 2.18.0

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

BackOffice **NO se conecta a SQL Server**. Toda la data (regiones, CEBEs, sociedades y la
auditoria central) se consume por HTTP contra el MobilityMiddleWare, que es el unico
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
  | GET | `/mobility/regions/resolve?codes=` | Pares (CEBE, sociedad) efectivos | `dbo.ContinentProfitCenters` | idem |
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
- **Cross-database y collations**: el join a `[SAPServices].[dbo].[Companies]` y el manejo de
  collations ocurren **dentro del Middleware** (via `VIEW_V2_CompaniesMobility`). BackOffice ya
  no depende de eso: es una preocupacion del Middleware, no de esta app.
- **Nota de paths**: los path constants del cliente son relativos a `MIDDLEWARE_URL` (que ya
  trae `/api`). Verificado contra el Middleware en vivo.

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
