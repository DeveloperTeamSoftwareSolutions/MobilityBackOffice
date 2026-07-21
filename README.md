# Mobility BackOffice

Back-office de administracion y marketing. Login federado contra ITManager (ManageIT).

## Stack

Monorepo npm workspaces.

| App | Path | Stack |
|---|---|---|
| `@mobility-backoffice/api` | `apps/api` | NestJS 11 + Prisma (cliente SQL Server) |
| `@mobility-backoffice/web` | `apps/web` | React 18 + Vite 6 (SPA) |

**Despliegue single-port**: en produccion el API sirve el build de Vite desde `apps/web/dist`
y sigue atendiendo `/api`. Un solo proceso en `:3000`. En desarrollo el build no existe y se
usa el dev server de Vite en `:5173`, que proxyea `/api` al backend.

## Modulos

| Modulo | Estado | Roles |
|---|---|---|
| Regiones comerciales | **completo** (v1.0.0) | SUPERADMIN, Administrador |
| Templates de WhatsApp (Marketing) | pendiente | SUPERADMIN, Marketing |
| Carga de documentacion del RAG | pendiente | SUPERADMIN, Marketing |

## Puesta en marcha

```bash
npm install
cp apps/api/.env.example apps/api/.env    # completar DATABASE_URL y BACKOFFICE_JWT_SECRET
npm run dev:api                            # :3000
npm run dev:web                            # :5173
npm test                                   # backend (jest) + frontend (vitest)
```

Verificacion: `GET http://localhost:3000/api/health` devuelve nombre, version y estado.

En produccion se sirve todo desde un solo puerto: `npm run build` genera el build de Vite y el
backend lo sirve. No hace falta el dev server de Vite.

## Base de datos

BackOffice **no posee la base**: comparte `Mobility_QATEST` / `Mobility-PROD` con MobilityManager.
Prisma se usa **solo como cliente**. `prisma migrate` y `prisma db push` estan **prohibidos**.
Los cambios de esquema son scripts idempotentes en `apps/api/prisma/sql/`, aplicados a mano.

Ver `docs/DEPLOY_SQL_PENDIENTE.md` para el estado por entorno.

## Documentacion

- `docs/SPEC_BACKOFFICE_REGIONES.md` — spec (fundacion + Regiones)
- `docs/AUTENTICACION.md` — login, token propio y guards; por que no se reusa el JWT de ManageIT
- `docs/API_ENDPOINTS.md` — contrato de la API
- `docs/JERARQUIA_Y_VISIBILIDAD.md` — que ve cada rol; Regiones no tiene eje jerarquico
- `docs/AUDITORIA.md` — catalogo de acciones auditadas
- `docs/ENV_VARIABLES.md` — variables de entorno
- `docs/EXTERNAL_APIS.md` — integraciones externas
- `docs/DEPLOY_SQL_PENDIENTE.md` — checklist de scripts SQL por entorno
- `docs/DEUDA_AUTH_ECOSISTEMA.md` — deuda de autorizacion detectada en otras apps (pendiente)
