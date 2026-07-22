# APIs y Endpoints Externos — Mobility BackOffice

> Ultima actualizacion: 2026-07-21
> Version: 1.1.0

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

### SQL Server — base Mobility (compartida)

No es una API HTTP, pero es la dependencia externa mas fuerte. Se accede via Prisma como
**cliente** (`DATABASE_URL`). BackOffice **no posee** la base: la comparte con MobilityManager.

- **Tablas/vistas propias del dominio Regiones**:
  | Objeto | Uso | Escritura |
  |---|---|---|
  | `dbo.Continents` | Catalogo de regiones | **Solo lectura** (compartida con DuwyDashy, Middleware) |
  | `dbo.ContinentProfitCenters` | Vinculos CEBE-region-sociedad | Lectura y escritura (soft delete) |
  | `dbo.VIEW_ProfitCentersMobility` | Maestro de CEBEs (typeahead, diagnosticos) | Solo lectura |
  | `dbo.AuditLogs` | Traza central | Escritura (append) |
- **Join cross-database**: las queries de vinculos joinean a `[SAPServices].[dbo].[Companies]`
  para traer el nombre de la sociedad. Requiere que la conexion tenga acceso a esa base y las
  collations correctas (ver `CLAUDE.md`).

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
