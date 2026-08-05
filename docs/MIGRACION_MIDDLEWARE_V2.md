# Migración a MobilityMiddleWare — Mobility BackOffice v2.0.0

> Última actualización: 2026-08-05
> Versión: 2.0.0
> Branch: `feature/fundacion-backoffice` · Commit: `8be7500`

Documento consolidado del cambio de arquitectura: BackOffice deja de conectarse a SQL Server y
pasa a consumir toda su data por HTTP contra el **MobilityMiddleWare** (el único componente del
ecosistema que toca la base). Incluye el mapa de acceso a datos, la migración de BD a correr, los
cambios de entorno, la validación realizada y el checklist de deploy.

---

## 1. Resumen ejecutivo

| Antes (v1.2.0) | Ahora (v2.0.0) |
|---|---|
| BackOffice le pegaba **directo a SQL** via Prisma (`$queryRaw`) + cross-DB a `[SAPServices]` | BackOffice **no toca SQL**; todo va por HTTP al Middleware |
| Auditoría por `prisma.auditLogs.create()` | Auditoría por `POST /audit-logs` al Middleware |
| Env `DATABASE_URL` (requerida) | Env `MIDDLEWARE_URL` (+ `MIDDLEWARE_API_KEY` opcional). Sin Prisma ni `DATABASE_URL` |

La API pública de BackOffice y el frontend **no cambiaron**: la UI de vincular/desvincular CEBE es
idéntica. El cambio es de capa de datos.

---

## 2. Mapa de acceso a datos — qué pasa por el Middleware y qué NO

Relevado sobre `apps/api/src` (grep de `HttpService`/`http.*`/`mssql`/Prisma). **Cero accesos
directos a SQL** en toda la app.

### 2.1 Pasa por el Middleware (`MIDDLEWARE_URL`, HTTP)

| Cliente | Archivo | Endpoints del MW | Objeto SQL detrás (lo maneja el MW) |
|---|---|---|---|
| Regiones/CEBEs/sociedades | `src/regions/regions.client.ts` | `/mobility/regions` (+ `/:guid`, `/by-code/:code`, `/:guid/cebes` GET/POST/DELETE, `/resolve`, `/links/codes`, `/links/multi-region`), `/mobility/profit-centers`, `/v2/mobility/companies` | `Continents`, `ContinentProfitCenters`, `VIEW_ProfitCentersMobility`, `VIEW_V2_CompaniesMobility` (→ `[SAPServices].[dbo].[Companies]`) |
| Auditoría | `src/audit/audit.client.ts` | `POST /audit-logs` | `AuditLogs` (central, compartida) |

Headers en toda llamada: `x-source-app: MobilityBackOffice` (siempre, para atribución en los
`ApiLogs` del MW) y `x-api-key` (solo si `MIDDLEWARE_API_KEY` está seteada). Helper único:
`src/common/middleware-request.ts`.

### 2.2 NO pasa por el Middleware (otras integraciones)

Esto es lo importante de tener claro: hay tráfico externo que **no** va por el MW y **es correcto
que así sea**. Ninguno toca SQL.

| Integración | Archivo | Qué hace | Auth | Por qué no va por el MW |
|---|---|---|---|---|
| **ITManager (ManageIT)** | `src/auth/itmanager.client.ts` | `POST {ITMANAGER_AUTH_URL}/auth/login`: valida credenciales, devuelve identidad + accessMatrix (roles) | credenciales del usuario | ITManager es la autoridad de identidad/roles del ecosistema; es un servicio propio, no datos de negocio del MW |
| **DuwyEngineRAG** | `src/rag/rag.proxy.ts`, `src/rag/rag-rewrite.ts` | Reverse-proxy same-origin `/rag/*` → `RAG_URL` para embeber el cargador de documentación en un iframe | cookie httpOnly `bo_rag_token` (sesión BackOffice) + rol Marketing/SuperAdmin | Es proxy de una app web completa (HTML/CSS/JS), no una fuente de datos SQL |
| **JWT propio** | `src/auth/token.service.ts` | Firma/verifica el token propio de BackOffice (HS256, `BACKOFFICE_JWT_SECRET`) | — (local, sin red) | Es criptografía local; no hay servicio externo |

### 2.3 Endpoint que BackOffice EXPONE (no es salida, es entrada)

| Endpoint | Archivo | Auth | Nota |
|---|---|---|---|
| `POST /api/regions/sync` | `src/regions/regions-sync.controller.ts`, `src/regions/api-key.guard.ts` | header `x-api-key` contra `REGIONS_SYNC_API_KEY` | Web service máquina-a-máquina (pensado para SAP) que reconcilia vínculos de forma idempotente. Internamente **escribe los links a través del MW** (no a SQL). Si `REGIONS_SYNC_API_KEY` está vacía/ausente, el endpoint queda deshabilitado (403). |

---

## 3. Cambios en la base de datos / migraciones a correr

> Regla del proyecto: la base es **compartida**; Prisma migrate/db push **prohibidos**. Los
> cambios son scripts idempotentes numerados en `apps/api/prisma/sql/`, aplicados a mano.

### 3.1 Migración a correr en PROD — `005_ViewV2CompaniesMobility.sql`

**Es el único cambio de BD que requiere el deploy v2.0.0.**

- **Qué**: crea `dbo.VIEW_V2_CompaniesMobility` en `Mobility-PROD` (wrapper cross-DB sobre
  `[SAPServices].[dbo].[Companies]`, con re-collation al estándar Mobility).
- **Por qué**: la vista existe en `Mobility_QATEST` pero **NO en `Mobility-PROD`** (verificado
  contra el dump de esquema PROD 2026-08-05). La consume el endpoint del Middleware
  `GET /v2/mobility/companies`, que alimenta el **typeahead de sociedades del alta de CEBE**. Sin
  ella, ese selector falla en producción.
- **Prerequisito**: la base `[SAPServices]` debe existir en la instancia (existe en ambos entornos).
- **Idempotente**: `CREATE OR ALTER VIEW`. Re-ejecutar es seguro.
- **Rollback**: `DROP VIEW dbo.VIEW_V2_CompaniesMobility;`
- **Cómo correrlo**:
  ```bash
  cd apps/api/prisma/sql
  sqlcmd -S <host-prod>,1433 -U <user> -d "Mobility-PROD" -C -I -b -i 005_ViewV2CompaniesMobility.sql
  ```
  (`-I` = `SET QUOTED_IDENTIFIER ON`, necesario en esa instancia.)

### 3.2 Objetos que YA existen en PROD (no requieren migración)

Verificado contra `Mobility-PROD-03-08.sql` y `SAPServices-PROD-03-08.sql` (2026-08-05):

| Objeto | Mobility-PROD | SAPServices-PROD |
|---|---|---|
| `Continents` | ✅ | — |
| `ContinentProfitCenters` (+ índices, unique triple) | ✅ | — |
| `VIEW_ProfitCentersMobility` | ✅ | ✅ |
| `Companies` | ✅ | ✅ |
| **`VIEW_V2_CompaniesMobility`** | ❌ (falta → script 005) | — |

Detalle de collation en PROD: `ContinentProfitCenters` usa `SQL_Latin1_General_CP1_CI_AS` (vs.
`Latin1_General_100_CI_*` en QATEST). **No afecta a BackOffice** —el Middleware resuelve el SQL y
las collations— pero queda documentado por si se toca ese objeto.

### 3.3 Estado por entorno

Ver el checklist vivo en [`docs/DEPLOY_SQL_PENDIENTE.md`](./DEPLOY_SQL_PENDIENTE.md). Las acciones
de BD ejecutadas durante el desarrollo (READS de inspección + fila de prueba E2E creada y borrada)
están registradas en [`docs/AUDITORIA_BD_QATEST.md`](./AUDITORIA_BD_QATEST.md).

---

## 4. Cambios de entorno (`.env`)

Fuente de verdad: `apps/api/src/config/env.validation.ts` (Joi) + `configuration.ts`. Detalle en
[`docs/ENV_VARIABLES.md`](./ENV_VARIABLES.md).

| Variable | Cambio | Valor |
|---|---|---|
| `DATABASE_URL` | **ELIMINADA** | — (ya no se usa; su presencia es inofensiva pero es ruido) |
| `MIDDLEWARE_URL` | **NUEVA** | dev: `http://localhost:6002/api` (default, no hace falta setear). Prod: el mismo Middleware que MobilityManager. **Incluye `/api`.** |
| `MIDDLEWARE_API_KEY` | **NUEVA** (opcional) | solo si el Middleware exige key |

> Los archivos `.env` / `.env.example` no se pudieron editar automáticamente (están protegidos).
> En **dev no hace falta tocar nada** (el default de `MIDDLEWARE_URL` ya sirve). En **prod** hay que
> setear `MIDDLEWARE_URL` y se puede quitar `DATABASE_URL`.

---

## 5. Código modificado (inventario)

**Nuevos**
- `src/common/middleware-request.ts` (+ `.spec`) — base URL + headers del MW.
- `src/regions/regions.client.ts` (+ `.spec`) — cliente HTTP de regiones/CEBEs/sociedades.
- `src/audit/audit.client.ts` — cliente HTTP de auditoría.
- `src/audit/audit.service.spec.ts` — spec del servicio (ahora sobre el cliente HTTP).
- `apps/api/prisma/sql/005_ViewV2CompaniesMobility.sql` — migración PROD.
- `docs/AUDITORIA_BD_QATEST.md`, `docs/MIGRACION_MIDDLEWARE_V2.md` (este doc).

**Modificados**
- `src/regions/regions.repository.ts` (+ `.spec`) — delega en `RegionsClient` (antes Prisma).
- `src/regions/regions.module.ts` — importa `HttpModule` + `RegionsClient`.
- `src/audit/audit.service.ts`, `audit.module.ts` — usan `AuditClient` (antes Prisma).
- `src/app.module.ts` — sin `PrismaModule`.
- `src/config/configuration.ts`, `env.validation.ts` — bloque `middleware.*`; sin `DATABASE_URL`.
- `src/auth/auth.module.ts` — comentario (sin PrismaService).
- `apps/api/package.json` — sin `@prisma/client`/`prisma`/`prisma:generate`. Versión 2.0.0.
- Docs: `EXTERNAL_APIS.md`, `ENV_VARIABLES.md`, `DEPLOY_SQL_PENDIENTE.md`, `AUDITORIA.md`, `README.md`.
- Versión 2.0.0 en `package.json` (raíz/api/web) y `version.ts` (api/web).

**Eliminados**
- `src/prisma/prisma.service.ts`, `src/prisma/prisma.module.ts`, `apps/api/prisma/schema.prisma`.

---

## 6. Validación realizada

- **Tests**: 160/160 (`jest`). **Build**: OK (`nest build`).
- **Smoke E2E real** contra el Middleware en vivo (`:6002`), a través de la API de BackOffice con un
  token propio válido:
  - Lectura: listar regiones, detalle con CEBEs, `resolve`, typeahead de sociedades
    (`VIEW_V2_CompaniesMobility`) y de CEBEs, diagnósticos (unmapped/multi). Todos 200 con data real.
  - Escritura: `POST` vincular CEBE → aparece en el detalle (con actor auditado) → `DELETE`
    desvincular → soft-delete. Datos de prueba **borrados** (0 residuo).
- `lint` falla por un problema **preexistente** (el repo no tiene `eslint.config.js` para ESLint v9);
  no lo introdujo este cambio.

---

## 7. Checklist de deploy

- [ ] Correr `apps/api/prisma/sql/005_ViewV2CompaniesMobility.sql` en `Mobility-PROD` (sqlcmd `-I`).
- [ ] Marcar el script 005 como aplicado en `docs/DEPLOY_SQL_PENDIENTE.md`.
- [ ] `.env` de prod: setear `MIDDLEWARE_URL` (mismo Middleware que MobilityManager); quitar `DATABASE_URL`.
- [ ] `MIDDLEWARE_API_KEY` solo si el Middleware de prod exige key.
- [ ] Verificar que el Middleware de prod tenga montados `/mobility/regions`, `/mobility/profit-centers`,
      `/v2/mobility/companies` y `/audit-logs` (MobilityManager ya los usa en prod).
- [ ] `npm run build` (genera el build de Vite que sirve el API) y desplegar el proceso único.
- [ ] Smoke post-deploy: login + listar regiones + typeahead de sociedades + una vinculación de prueba.

---

## 8. Notas y hallazgos

- **Sin acceso a PROD desde la VM**: la instancia `100.66.245.49` es QA/DEV/TEST (no hay
  `Mobility-PROD` ahí). La revisión de PROD se hizo sobre los dumps de esquema del 2026-08-05
  (`Mobility-PROD-03-08.sql`, `SAPServices-PROD-03-08.sql`) + QATEST en vivo, no contra PROD real.
- **Bug latente en MobilityManager** (fuera de alcance): sus path constants del cliente del MW para
  regiones/companies/audit llevan un `/api` de más que, con su `MIDDLEWARE_URL` (que ya trae `/api`),
  resuelven a `/api/api/...` → 404 contra el Middleware real. BackOffice quedó con los paths
  **correctos** (relativos a la base con `/api`), verificados en vivo. Si MM falla en regiones vía
  Middleware, es por esto.
