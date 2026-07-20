# Mobility BackOffice — reglas del proyecto

Complementa los estandares globales del equipo. Ante conflicto, mandan las reglas de este archivo
porque reflejan decisiones ya tomadas y documentadas en `docs/SPEC_BACKOFFICE_REGIONES.md`.

---

## Que es esta app

Back-office de administracion y marketing. No es un portal gerencial de consulta (ese es
MobilityManager). Aloja herramientas de mantenimiento de datos maestros y de marketing:
Regiones comerciales, templates de WhatsApp, carga de documentacion del RAG.

## Stack real

Monorepo npm workspaces: `apps/api` (NestJS 11 + Prisma) y `apps/web` (React 18 + Vite 6).
Despliegue single-port: el API sirve el build de Vite. **No es Express + Bootstrap.**

Patron backend: `controller -> service -> repository`. El repository concentra todo el SQL.

Patron por feature en el front: `components/<feature>/<feature>.api.ts` + `<feature>.types.ts`
+ componentes + `<feature>.css`, y `pages/<X>Page.tsx` que solo compone.

## Base de datos — restricciones duras

- La base es **compartida** con MobilityManager (`Mobility_QATEST` / `Mobility-PROD`).
  BackOffice **no la posee**.
- **Prohibido** `prisma migrate` y `prisma db push`. Prisma es solo cliente.
- Los cambios de esquema son scripts numerados e idempotentes en `apps/api/prisma/sql/`,
  aplicados a mano por SSMS/sqlcmd y registrados en `docs/DEPLOY_SQL_PENDIENTE.md`.
- Los scripts **no llevan `USE`** — dependen de la conexion.
- Indices unicos filtrados exigen `SET QUOTED_IDENTIFIER ON`; con sqlcmd hay que pasar `-I`
  o falla con Msg 1934.
- `Continents` es **solo lectura**: la comparten DuwyDashy y el Middleware.

### Collations — el error mas facil de cometer

El default de la base es `Latin1_General_100_CI_AS_SC` (accent-**sensitive**), no el `_AI_`
del estandar global del equipo.

- `GuidContinents` y cualquier FK a Guids legacy: `Latin1_General_100_CI_AS_SC`, o la FK falla.
- Joins cross-database (`[SAPServices]`) y el resto de columnas de texto:
  `COLLATE Latin1_General_100_CI_AI_SC` **explicito**.
- Nunca `COLLATE DATABASE_DEFAULT` — es ambiguo e impide usar indices.

Un desajuste aca no tira error obvio: devuelve cero filas en silencio.

## Auth

El rol **no se deriva del email ni de SAP**. Lo decide ITManager via `accessMatrix` filtrado
por `appId`. Sin rol asignado -> **403**.

- `AppId` = `MobilityBackOffice`, `Prefix` = `MOBILITYBO`
- Roles: `MOBILITYBO_SUPERADMIN`, `MOBILITYBO_ADMIN`, `MOBILITYBO_MARKETING`
- Prioridad: SUPERADMIN > Administrador > Marketing
- La app **no emite JWT propio**: reusa el de ManageIT y lo verifica localmente (HS256,
  `JWT_SECRET` compartido).

## Frontend

- **Sin emojis** en la UI. Enfoque corporativo.
- Iconos: SVG inline en `components/layout/icons.tsx`. Sin libreria de iconos.
- Tokens CSS en `src/theme/tokens.css`, prefijo `--bo-`. Clases con prefijo `bo-`.
- `VITE_API_URL` debe quedar **vacia** en dev y en prod: el front usa rutas relativas contra
  el mismo origen. Setearla hornea la URL en el build y rompe el login desde otra maquina.

## Versionado

Semantic Versioning en **tres** archivos que deben coincidir siempre:
`package.json` (raiz y de cada app), `apps/api/src/version.ts`, `apps/web/src/version.ts`.
`GET /api/health` expone la version y la TopBar la muestra. Incrementar en cada cambio funcional.

## Trazabilidad

Endpoints, vistas y funciones SQL se documentan en `docs/`, nunca en la UI del usuario.

## Git

Una branch por feature (`feature/*`, `fix/*`). Nunca commit directo a `main`.
Commit + push cierra la tarea. **No crear PRs** salvo pedido explicito del usuario.
