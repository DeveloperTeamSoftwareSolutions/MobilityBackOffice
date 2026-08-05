# Mobility BackOffice

Back-office de administracion y marketing. Login federado contra ITManager (ManageIT).

## Stack

Monorepo npm workspaces.

| App | Path | Stack |
|---|---|---|
| `@mobility-backoffice/api` | `apps/api` | NestJS 11 (gateway HTTP: ITManager + MobilityMiddleWare) |
| `@mobility-backoffice/web` | `apps/web` | React 18 + Vite 6 (SPA) |

**Despliegue single-port**: en produccion el API sirve el build de Vite desde `apps/web/dist`
y sigue atendiendo `/api`. Un solo proceso en `:3010`. En desarrollo el build no existe y se
usa el dev server de Vite en `:5183`, que proxyea `/api` al backend.

## Modulos

| Modulo | Estado | Roles |
|---|---|---|
| Regiones comerciales | **completo** (v1.0.0) | SUPERADMIN, Administrador |
| Documentacion del RAG (embebido) | **completo** (v1.1.0) | SUPERADMIN, Marketing |
| Templates de WhatsApp (Marketing) | pendiente | SUPERADMIN, Marketing |

## Puesta en marcha

```bash
npm install
cp apps/api/.env.example apps/api/.env    # completar DATABASE_URL y BACKOFFICE_JWT_SECRET
npm run dev:api                            # :3010
npm run dev:web                            # :5183
npm test                                   # backend (jest) + frontend (vitest)
```

Verificacion: `GET http://localhost:3010/api/health` devuelve nombre, version y estado.

En produccion se sirve todo desde un solo puerto: `npm run build` genera el build de Vite y el
backend lo sirve. No hace falta el dev server de Vite.

## Datos — via MobilityMiddleWare (sin SQL directo)

Desde v2.0.0 BackOffice **no se conecta a SQL Server**. Toda la data —regiones, CEBEs,
sociedades y la auditoria central— se consume por HTTP contra el **MobilityMiddleWare**, que es
el unico componente del ecosistema que toca la base (misma regla que MobilityManager). Ya no hay
Prisma ni `DATABASE_URL`: se configura `MIDDLEWARE_URL` (dev `http://localhost:6002/api`; prod =
el mismo Middleware que MobilityManager). Ver `docs/EXTERNAL_APIS.md`.

Los cambios de esquema que el Middleware necesita siguen siendo scripts idempotentes en
`apps/api/prisma/sql/`, aplicados a mano a la base compartida. Ver `docs/DEPLOY_SQL_PENDIENTE.md`
para el estado por entorno (v2.0.0 requiere el script `005` en PROD).

## Documentacion

- `docs/MIGRACION_MIDDLEWARE_V2.md` — **v2.0.0**: migracion a MobilityMiddleWare (sin SQL directo), mapa de datos, migracion PROD y checklist de deploy
- `docs/SPEC_BACKOFFICE_REGIONES.md` — spec (fundacion + Regiones)
- `docs/AUTENTICACION.md` — login, token propio y guards; por que no se reusa el JWT de ManageIT
- `docs/ROLES_Y_PERMISOS.md` — roles, permisos y mapeo para aplicar en ITManager
- `docs/API_ENDPOINTS.md` — contrato de la API
- `docs/JERARQUIA_Y_VISIBILIDAD.md` — que ve cada rol; Regiones no tiene eje jerarquico
- `docs/AUDITORIA.md` — catalogo de acciones auditadas
- `docs/ENV_VARIABLES.md` — variables de entorno
- `docs/EXTERNAL_APIS.md` — integraciones externas
- `docs/DEPLOY_SQL_PENDIENTE.md` — checklist de scripts SQL por entorno
- `docs/AUDITORIA_BD_QATEST.md` — traza de las acciones sobre la base ejecutadas en desarrollo
- `docs/DEUDA_AUTH_ECOSISTEMA.md` — deuda de autorizacion detectada en otras apps (pendiente)
