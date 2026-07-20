# Spec (SDD) — Mobility BackOffice, Fase 1: Regiones comerciales

> Fecha: 2026-07-20
> Estado: propuesta, pendiente de aprobación
> Alcance de este documento: fundación de la aplicación + traslado del módulo de Regiones comerciales.
> Marketing (templates WhatsApp) y carga del RAG quedan **fuera de esta fase**; se especifican por separado.

---

## 1. Problema

Hoy la vinculación de regiones comerciales con CEBEs (centros de beneficio) vive en **MobilityManager**, un portal
gerencial de consulta. Es una herramienta de administración, no de gerencia: la usa un administrador para mantener
un mapa maestro que después consumen los reportes. Está en el lugar equivocado.

Además hay dos funcionalidades más que necesitan un hogar y que tampoco son gerenciales: la gestión de templates de
WhatsApp para marketing, y el cargador de documentación del RAG (ya construido, solo hay que consumirlo).

Falta la aplicación que las contenga: **Mobility BackOffice**.

## 2. Decisiones tomadas

| # | Decisión | Razón |
|---|---|---|
| D1 | El módulo de Regiones **aterriza directamente en BackOffice**; `feature/regiones-cebe` **no se mergea a `main` de MobilityManager** | El módulo nunca llegó a main de MM (PR #45 se mergeó hacia `feature/geo-trackable`, no a main). Aprovechamos esa ventana: cero código duplicado, cero deuda de borrado posterior, y el SQL pendiente en PROD se aplica una sola vez desde el repo nuevo |
| D2 | Repo propio: `DeveloperTeamSoftwareSolutions/MobilityBackOffice` | Ciclo de release independiente de MM |
| D3 | **Misma base de datos** que MM (`Mobility_QATEST` / `Mobility-PROD`) | El módulo hace joins cross-database a `[SAPServices]` y lee `Continents`. Separar la base rompería los joins. Además mantiene la traza de `AuditLogs` unificada |
| D4 | Tres roles en ITManager: **SUPERADMIN, ADMIN, MARKETING** | Mínimo que cubre las tres funcionalidades del brief sin roles muertos |
| D5 | Misma arquitectura que MM: monorepo npm workspaces, NestJS 11 + Prisma (`apps/api`), React 18 + Vite 6 (`apps/web`), despliegue **single-port** | Requisito explícito del brief; el equipo ya opera este stack |
| D6 | `Continents` sigue siendo **solo lectura** | Tabla compartida con DuwyDashy y el Middleware. El módulo nunca la escribe |
| D7 | **BackOffice emite su propio JWT** con el rol adentro, en vez de reusar el de ManageIT (revisa la decisión implícita de §3.1 en la versión 0.1.0 de esta spec) | El JWT de ManageIT no incluye los roleKeys: viajan solo en el body del login. Un guard que verifique ese token solo puede autorizar por `isAdmin`, que es global (`IsAdmin` OR cualquier `*_SUPERADMIN` de **cualquier** app). Sin este cambio, `MOBILITYBO_ADMIN` no podría escribir y un superadmin de otro sistema sí. Ver `docs/AUTENTICACION.md` |

## 3. Qué se construye

### 3.1 Fundación de la aplicación

Clon estructural de MobilityManager, **sin** sus módulos de negocio (Geo, Waba, Warehouses, Authorizations, Duwy,
DuwyChat). Se conserva:

- Monorepo con `apps/api` y `apps/web`, versión sincronizada en `package.json` raíz, `apps/api/src/version.ts`
  y `apps/web/src/version.ts` (las tres, siempre iguales — en MM derivaron y es un defecto a no heredar).
- **Login por gateway a ITManager**: `POST /api/auth/login` → cliente ITManager → resolución de rol desde
  `accessMatrix` filtrado por `appId` → **BackOffice firma su propio JWT** (HS256, secret propio) con
  el rol como claim. Ver D7 y `docs/AUTENTICACION.md`.
- Guards: `JwtGuard` (verifica el token propio y popula `req.user`), `RolesGuard` + decorador
  `@Roles(...)` (autoriza por el claim `role`; `SuperAdmin` pasa siempre), `RoleGuard` en el front.
- Shell de navegación: `AppLayout` (TopBar + Sidebar colapsable + `<Outlet>`), tokens CSS, Inter self-hosted,
  iconos SVG inline, `ComingSoon` para secciones aún vacías.
- `GET /api/health` → `{success, name, version, status}`.
- `AuditService` escribiendo en la tabla central `AuditLogs` con `AppId='MobilityBackOffice'`.

**No se clonan** (defectos identificados en MM):
- El proxy circular de `apps/web/vite.config.ts` (apunta a `:5173`, su propio dev server, en vez de `:3000`).
- El `CLAUDE.md` sin personalizar (contiene `[NOMBRE_PROYECTO]` y un stack Express+Bootstrap que no corresponde).

**No aplica**: `ScopeService`. Ningún módulo de esta fase filtra por jerarquía de usuarios. No se porta.

### 3.2 Registro en ITManager

| Campo | Valor |
|---|---|
| `AppId` | `MobilityBackOffice` |
| `DisplayName` | `Mobility BackOffice` |
| `Description` | `Back-office de administración y marketing` |
| `Prefix` | `MOBILITYBO` |
| `AppType` | `user` |
| `GuidApiLoginClients` | `00000000-0000-0000-0000-000000000001` (Default Organization) |

Roles (idempotentes por `RoleKey` global):

| RoleKey | Nombre | Alcance previsto |
|---|---|---|
| `MOBILITYBO_SUPERADMIN` | SUPERADMIN | Todo el back-office |
| `MOBILITYBO_ADMIN` | Administrador | Regiones, configuración |
| `MOBILITYBO_MARKETING` | Marketing | Templates WhatsApp, carga RAG |

Resolución de rol por prioridad: `SUPERADMIN > Administrador > Marketing`. `isAdmin` o cualquier `*_SUPERADMIN`
resuelve a SUPERADMIN. Sin rol asignado → **403** (mismo contrato que MM).

Sandbox y Producción **no tienen registro separado**: la distinción es de base de datos y URLs. El mismo script
se corre en ambas bases.

### 3.3 Módulo de Regiones comerciales

Se traslada tal cual, preservando el contrato de API completo. Es un módulo autocontenido: backend íntegro en
`apps/api/src/regions/`, frontend en `apps/web/src/components/regiones/`.

**Modelo de datos** (sin cambios):
- `Continents` — catálogo de regiones. **Solo lectura.**
- `ContinentProfitCenters` — mapa M:N región ↔ CEBE, con **clave triple** `(GuidContinents, ProfitCenterCode, CompanyCode)`.
  La sociedad es obligatoria porque hay CEBEs transversales que aparecen en más de una sociedad.
- `CAYCAR` es una **región virtual** sintetizada en código (`region-groups.ts`: `{CAYCAR: ['CA','CB']}`), no una fila.

**Contrato de API** — 10 endpoints bajo `/api/regions`, respuestas siempre `{success: true, ...}`:

```
GET    /api/regions                                  [Jwt]        listado paginado (page, limit≤200, search, sortBy, sortDir)
GET    /api/regions/groups                           [Jwt]        regiones virtuales (CAYCAR)
GET    /api/regions/cebes/available                  [Jwt]        typeahead de CEBEs (q, limit≤50)
GET    /api/regions/companies                        [Jwt]        typeahead de sociedades (q, limit≤50)
GET    /api/regions/diagnostics/unmapped             [Jwt]        CEBEs sin región
GET    /api/regions/diagnostics/multi                [Jwt]        CEBEs en más de una región
GET    /api/regions/:code/resolve                    [Jwt]        expande código (incl. grupos) → CEBEs
GET    /api/regions/:guid                            [Jwt]        detalle + vínculos
POST   /api/regions/:guid/cebes                      [Jwt+Admin]  vincular  → {success, linked}
DELETE /api/regions/:guid/cebes/:code/:companyCode   [Jwt+Admin]  desvincular (soft delete)
POST   /api/regions/sync                             [ApiKey]     reconciliación máquina-a-máquina
```

**Invariantes que no se pueden perder en el traslado:**

1. **Orden de rutas.** Las literales (`groups`, `cebes/available`, `companies`, `diagnostics/*`) y `:code/resolve`
   se declaran **antes** que `:guid`. Es load-bearing: invertirlo hace que `/groups` matchee como guid.
2. **`companyCode` es obligatorio** en toda operación de vínculo. Sin él → 400.
3. **`sync` nunca crea regiones.** Los códigos ausentes se devuelven en `skipped`.
4. **Soft delete** en todo desvínculo (`DeletedTimestamp`), nunca `DELETE FROM`.
5. **Whitelist de `sortBy`** — el `ORDER BY` se construye con `Prisma.raw`; sin whitelist es inyección SQL.
6. **Collations mixtas.** `GuidContinents` debe ser `Latin1_General_100_CI_AS_SC` (accent-**sensitive**, el default
   de la base) o la FK falla; el resto de columnas y todos los joins cross-database usan
   `COLLATE Latin1_General_100_CI_AI_SC` explícito. Este es el error más fácil de cometer y falla en silencio.
7. **`ApiKeyGuard`**: sin `REGIONS_SYNC_API_KEY` seteada el endpoint responde 403 (deshabilitado), no 500.

**Frontend**: sección "Regiones comerciales" en el sidebar, ruta `/regiones-comerciales`, restringida por
`RoleGuard` a SUPERADMIN y Administrador. Dos tabs: gestión (listado → detalle → alta de vínculo en dos pasos con
typeahead de CEBE + sociedad) y diagnóstico (CEBEs sin región / en varias regiones). Sin emojis.

**Auditoría**: `REGION_CEBE_LINK`, `REGION_CEBE_UNLINK`, `REGION_SYNC`, todas con `category='regions'`,
`entity='ContinentProfitCenter'`, registrando `GuidUsers` del actor.

## 4. Deuda heredada que se corrige en el traslado

| Hallazgo | Corrección |
|---|---|
| El modelo Prisma `ContinentProfitCenters` **no declara `companyCode`**, pese a que el script `006` lo agregó `NOT NULL` y todo el código lo usa. No rompe hoy solo porque el repository usa exclusivamente `$queryRaw` | Agregar el campo al schema del repo nuevo |
| `dbo.VIEW_ProfitCentersMobility` se consume pero **no está versionada en ningún script** de MM | Versionarla en `apps/api/prisma/sql/` del repo nuevo antes de depender de ella |
| Typo en el comentario doc del modelo Prisma (`\` en vez de `///`) | Corregir al portar |
| `docs/JERARQUIA_Y_VISIBILIDAD.md` de MM nunca documentó este módulo | Documentar en el doc equivalente de BackOffice que Regiones **no** tiene eje jerárquico |

## 5. SQL — estado y plan

Los scripts se renumeran en el repo nuevo:

| Nuevo | Origen en MM | Contenido | QATEST | PROD |
|---|---|---|---|---|
| `001_RegisterMobilityBackOfficeApp.sql` | adaptado de `002_Register...` | App + 3 roles en ITManager | pendiente | pendiente |
| `002_ContinentProfitCenters.sql` | `004_...` | tabla M:N + 2 índices | **ya aplicado** (verificar) | pendiente |
| `003_ContinentProfitCentersCompanyCode.sql` | `006_...` | `CompanyCode` + clave triple | **ya aplicado** (verificar) | pendiente |
| `004_ViewProfitCentersMobility.sql` | — (nuevo) | versiona la vista faltante | verificar | verificar |

Reglas de aplicación heredadas, no negociables:
- Aplicación **manual** (SSMS / sqlcmd). **Prohibido** `prisma migrate` y `prisma db push`: la base es compartida
  y la app no la posee. Prisma se usa solo como cliente.
- Todos los scripts idempotentes (`IF NOT EXISTS` / `CREATE OR ALTER`); re-ejecutar es seguro.
- Scripts sin `USE` — dependen de la conexión.
- Índices únicos filtrados exigen `SET QUOTED_IDENTIFIER ON`; con sqlcmd hay que pasar **`-I`** o falla con Msg 1934.
- Checklist vivo en `docs/DEPLOY_SQL_PENDIENTE.md`: casilla + fecha al aplicar.

**Riesgo abierto (heredado de MM):** la región `SA` (Sudamérica) se renombró a `AN` (Andina) en QATEST. Antes de
tocar PROD hay que verificar que ningún otro sistema (DuwyDashy, Middleware) filtre por el `'SA'` viejo.

## 6. Variables de entorno

Requeridas (Joi falla el arranque si faltan): `DATABASE_URL`, `ITMANAGER_AUTH_URL`, `JWT_SECRET`.

Con default: `PORT` (3000), `NODE_ENV`, `CORS_ORIGIN`, `APP_ID` (`MobilityBackOffice`),
`PERM_PREFIX` (`MOBILITYBO_`), `REGIONS_SYNC_API_KEY` (sin ella el sync queda deshabilitado con 403).

Frontend: `VITE_API_URL` **debe quedar vacía** en dev y prod — el front usa rutas relativas contra el mismo origen.
Setearla hornea la URL en el build y rompe el login desde otra máquina.

No se heredan las variables de Geo, Azure OpenAI, DuwyDashy, DuwyChat ni Middleware. Se incorporarán cuando lleguen
las fases de Marketing y RAG.

## 7. Fuera de alcance de esta fase

- Templates de WhatsApp (Marketing) — fase siguiente.
- Cargador de documentación del RAG — fase siguiente, se consume lo ya construido.
- Eliminar el módulo de Regiones de MobilityManager: **no aplica**, nunca llegó a main.
- Filtrado de regiones por jerarquía de usuario.
- Escritura sobre `Continents`.

## 8. Plan de ejecución

Una branch por fase, commit + push, sin PR salvo pedido explícito.

| Fase | Entregable | Depende de |
|---|---|---|
| **0** | Repo `MobilityBackOffice` creado e inicializado; monorepo, `CLAUDE.md` real, `.env.example`, docs base | — |
| **1** | SQL `001` (registro ITManager) + `004` (vista) escritos y aplicados en QATEST | 0 |
| **2** | Backend fundación: config, Prisma, Audit, Health, Auth completo (login gateway + guards + resolver de 3 roles) | 1 |
| **3** | Frontend fundación: login, AuthProvider, shell de navegación, tokens, ProtectedRoute/RoleGuard | 2 (contrato de auth) |
| **4** | Backend Regiones: types, repository, service, controllers, guards, tests unitarios de mappers y reconcile | 2 |
| **5** | Frontend Regiones: panel, listado, detalle, pickers, diagnóstico | 3 y 4 |
| **6** | Docs vivas (`ENV_VARIABLES`, `API_ENDPOINTS`, `AUDITORIA`, `DEPLOY_SQL_PENDIENTE`, `REGIONES_CEBE`), smoke test, versión 1.0.0 | 5 |

Paralelizable: fase 3 y 4 corren en simultáneo una vez cerrada la 2. Fases 1 y 2 también, salvo el registro de app
que la 2 necesita para que el login funcione end-to-end.

Metodología por fase: spec → test → implementación (TDD). Los mappers puros del repository y el reconcile de `sync`
son los candidatos naturales a test unitario; ya existen tests de referencia en MM.

## 9. Criterios de aceptación

1. Un usuario con `MOBILITYBO_ADMIN` asignado en ITManager entra al BackOffice y ve "Regiones comerciales".
2. Un usuario sin rol de BackOffice recibe 403 en el login.
3. Un usuario con `MOBILITYBO_MARKETING` entra pero **no** ve la sección Regiones.
4. Se puede vincular un CEBE a una región indicando sociedad, y el vínculo aparece en el detalle.
5. Vincular sin sociedad devuelve 400.
6. Desvincular deja la fila con `DeletedTimestamp` seteado, no la borra.
7. `GET /api/regions/CAYCAR/resolve` devuelve la unión sin duplicados de los CEBEs de `CA` y `CB`.
8. Los diagnósticos listan CEBEs sin región y en varias regiones.
9. Cada vínculo/desvínculo deja registro en `AuditLogs` con el `GuidUsers` del actor y `AppId='MobilityBackOffice'`.
10. `POST /api/regions/sync` sin `REGIONS_SYNC_API_KEY` configurada responde 403.
11. `GET /api/health` devuelve la versión, y coincide con la mostrada en la TopBar.
