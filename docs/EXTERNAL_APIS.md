# APIs y Endpoints Externos — Mobility BackOffice

> Ultima actualizacion: 2026-08-25
> Version: 2.3.0

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
  | GET | `/mobility/profit-centers` | Maestro de CEBEs (typeahead, diagnosticos) | `dbo.VIEW_ProfitCentersMobility` | idem |
  | GET | `/v2/mobility/companies` | Maestro de sociedades (typeahead) | `dbo.VIEW_V2_CompaniesMobility` sobre `[SAPServices].[dbo].[Companies]` | idem |
  | POST | `/audit-logs` | Traza central (append) | `dbo.AuditLogs` | `src/audit/audit.client.ts` |
  | GET | `/mobility/document-timeline` | Bitacora unificada de una orden/cotizacion (consola de soporte) | `BusinessOrders`/`BusinessQuotes` + `Auditories`, pagos, credito y resoluciones | `src/support/support.client.ts` |
  | GET | `/mobility/support/documents` | Listado de documentos SIN scope de vendedor (consola de soporte) | `BusinessOrders` / `BusinessQuotes` | idem |
  | GET | `/mobility/support/statuses` | Estados presentes con su conteo, para el filtro | idem | idem |
- **Cross-database y collations**: el join a `[SAPServices].[dbo].[Companies]` y el manejo de
  collations ocurren **dentro del Middleware** (via `VIEW_V2_CompaniesMobility`). BackOffice ya
  no depende de eso: es una preocupacion del Middleware, no de esta app.
- **Nota de paths**: los path constants del cliente son relativos a `MIDDLEWARE_URL` (que ya
  trae `/api`). Verificado contra el Middleware en vivo.

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

## Pendientes (fases futuras)

- **WhatsApp Business (templates)**: el panel de marketing gestionara templates. Se documentara
  el servicio que los persiste/envia cuando se implemente.
